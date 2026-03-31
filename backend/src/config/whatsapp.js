const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

let socket = null;
let connectPromise = null;
let authStatePromise = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const CONNECT_READY_TIMEOUT_MS = Number.parseInt(process.env.WHATSAPP_CONNECT_TIMEOUT_MS, 10) || 45000;
const MAX_RECONNECT_ATTEMPTS = Number.parseInt(process.env.WHATSAPP_MAX_RECONNECT_ATTEMPTS, 10) || 12;
const RECONNECT_BASE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS, 10) || 2000;
const RECONNECT_MAX_DELAY_MS = Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS, 10) || 60000;

const connectionState = {
  connected: false,
  status: "not_initialized",
  jid: null,
  updatedAt: null,
  lastDisconnectCode: null,
  lastDisconnectReason: null,
  loggedOut: false,
};

function log(level, event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    component: "whatsapp",
    event,
    ...details,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function updateConnectionState(update = {}) {
  const nextConnection = typeof update.connection === "string" ? update.connection : null;

  if (nextConnection) {
    connectionState.status = nextConnection;
    connectionState.connected = nextConnection === "open";
  }

  if (socket?.user?.id) {
    connectionState.jid = socket.user.id;
  }

  const statusCode = update?.lastDisconnect?.error?.output?.statusCode;
  if (statusCode) {
    connectionState.lastDisconnectCode = statusCode;
    connectionState.lastDisconnectReason = update?.lastDisconnect?.error?.message || null;
    connectionState.loggedOut = statusCode === DisconnectReason.loggedOut;
  }

  connectionState.updatedAt = new Date().toISOString();
}

function getSessionDir() {
  return process.env.WHATSAPP_SESSION_DIR || "/app/session";
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function ensureAuthState() {
  if (authStatePromise) {
    return authStatePromise;
  }

  const sessionDir = getSessionDir();
  fs.mkdirSync(sessionDir, { recursive: true });
  log("info", "auth_state_ready", {
    sessionDir: path.resolve(sessionDir),
  });

  authStatePromise = useMultiFileAuthState(sessionDir);
  return authStatePromise;
}

function isSocketConnected() {
  return Boolean(socket) && connectionState.connected;
}

function getSocket() {
  return socket;
}

function getConnectionState() {
  return {
    connected: connectionState.connected,
    status: connectionState.status,
    jid: connectionState.jid,
    updatedAt: connectionState.updatedAt,
    lastDisconnectCode: connectionState.lastDisconnectCode,
    lastDisconnectReason: connectionState.lastDisconnectReason,
    loggedOut: connectionState.loggedOut,
    reconnectAttempts,
  };
}

function calculateReconnectDelay(attempt) {
  const cappedAttempt = Math.max(0, attempt - 1);
  const baseDelay = RECONNECT_BASE_DELAY_MS * (2 ** cappedAttempt);
  return Math.min(baseDelay, RECONNECT_MAX_DELAY_MS);
}

function scheduleReconnect() {
  if (reconnectTimer || connectPromise || connectionState.loggedOut) {
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log("error", "reconnect_limit_reached", {
      attempts: reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
    });
    return;
  }

  reconnectAttempts += 1;
  const delayMs = calculateReconnectDelay(reconnectAttempts);

  log("warn", "reconnect_scheduled", {
    attempt: reconnectAttempts,
    delayMs,
  });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    connectWhatsApp().catch((error) => {
      log("error", "reconnect_failed", {
        message: error.message,
        code: error.code || null,
      });
      scheduleReconnect();
    });
  }, delayMs);
}

function waitForSocketReady(targetSocket, timeoutMs) {
  if (isSocketConnected() && socket === targetSocket) {
    return Promise.resolve(targetSocket);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      targetSocket?.ev?.off("connection.update", onUpdate);
      const error = new Error("Timed out while waiting for WhatsApp connection");
      error.code = "WHATSAPP_CONNECT_TIMEOUT";
      reject(error);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      targetSocket?.ev?.off("connection.update", onUpdate);
    }

    function onUpdate(update) {
      if (settled || targetSocket !== socket) {
        return;
      }

      if (update?.connection === "open") {
        settled = true;
        cleanup();
        resolve(targetSocket);
        return;
      }

      if (update?.connection === "close") {
        const statusCode = update?.lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          settled = true;
          cleanup();
          const error = new Error("WhatsApp logged out. QR scan required.");
          error.code = "WHATSAPP_LOGGED_OUT";
          reject(error);
        }
      }
    }

    targetSocket?.ev?.on("connection.update", onUpdate);
  });
}

function bindSocketEvents(targetSocket) {
  targetSocket.ev.on("connection.update", (update) => {
    if (targetSocket !== socket) {
      return;
    }

    updateConnectionState(update);
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log("info", "qr_generated", {
        hint: "Scan QR to authenticate WhatsApp session",
      });
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      clearReconnectTimer();
      log("info", "connected", {
        jid: targetSocket?.user?.id || null,
      });
      return;
    }

    if (connection !== "close") {
      if (connection) {
        log("info", "connection_state", {
          status: connection,
        });
      }
      return;
    }

    const statusCode = lastDisconnect?.error?.output?.statusCode || null;
    const reason = lastDisconnect?.error?.message || "connection closed";

    log("warn", "disconnected", {
      statusCode,
      reason,
    });

    socket = null;
    connectionState.connected = false;
    connectionState.status = "close";
    connectionState.updatedAt = new Date().toISOString();

    if (statusCode === DisconnectReason.loggedOut) {
      connectionState.loggedOut = true;
      clearReconnectTimer();
      log("warn", "logged_out_qr_required", {
        statusCode,
      });
      return;
    }

    scheduleReconnect();
  });
}

async function createSocket() {
  const { state, saveCreds } = await ensureAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const nextSocket = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Docker", "Chrome", "stable"],
    markOnlineOnConnect: false,
  });

  nextSocket.ev.on("creds.update", saveCreds);
  socket = nextSocket;
  connectionState.loggedOut = false;
  updateConnectionState({ connection: "connecting" });
  bindSocketEvents(nextSocket);

  return nextSocket;
}

async function connectWhatsApp() {
  if (isSocketConnected()) {
    return socket;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    clearReconnectTimer();

    if (socket && connectionState.status === "connecting") {
      return waitForSocketReady(socket, CONNECT_READY_TIMEOUT_MS);
    }

    const createdSocket = await createSocket();
    return waitForSocketReady(createdSocket, CONNECT_READY_TIMEOUT_MS);
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

module.exports = {
  connectWhatsApp,
  getSocket,
  getConnectionState,
  isSocketConnected,
};
