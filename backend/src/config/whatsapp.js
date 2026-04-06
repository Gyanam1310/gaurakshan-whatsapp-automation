let makeWASocket = null;
let useMultiFileAuthState = null;
let fetchLatestBaileysVersion = null;
const FALLBACK_DISCONNECT_REASON = Object.freeze({ loggedOut: 401 });
let DisconnectReason = FALLBACK_DISCONNECT_REASON;
let baileysImportPromise = null;

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { logger } = require("./logger");

let socket = null;
let connectPromise = null;
let authStatePromise = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const CONNECT_READY_TIMEOUT_MS = Number.parseInt(process.env.WHATSAPP_CONNECT_TIMEOUT_MS, 10) || 45000;
const MAX_RECONNECT_ATTEMPTS = Number.parseInt(process.env.WHATSAPP_MAX_RECONNECT_ATTEMPTS, 10) || 12;
const RECONNECT_BASE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_RECONNECT_BASE_DELAY_MS, 10) || 2000;
const RECONNECT_MAX_DELAY_MS = Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS, 10) || 60000;
const RECONNECT_JITTER_RATIO = Number.parseFloat(process.env.WHATSAPP_RECONNECT_JITTER_RATIO || "0.2");

const whatsappLogger = logger.child({ component: "whatsapp" });

async function loadBaileys() {
  if (makeWASocket && useMultiFileAuthState && fetchLatestBaileysVersion) {
    return;
  }

  if (baileysImportPromise) {
    return baileysImportPromise;
  }

  // Baileys v7+ is ESM-only, so CommonJS code must import it dynamically.
  baileysImportPromise = import("@whiskeysockets/baileys")
    .then((baileysModule) => {
      makeWASocket = baileysModule.default;
      useMultiFileAuthState = baileysModule.useMultiFileAuthState;
      fetchLatestBaileysVersion = baileysModule.fetchLatestBaileysVersion;
      DisconnectReason = baileysModule.DisconnectReason || FALLBACK_DISCONNECT_REASON;

      if (
        typeof makeWASocket !== "function"
        || typeof useMultiFileAuthState !== "function"
        || typeof fetchLatestBaileysVersion !== "function"
      ) {
        throw new Error("Invalid Baileys module exports");
      }
    })
    .catch((error) => {
      baileysImportPromise = null;
      throw error;
    });

  return baileysImportPromise;
}

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
  whatsappLogger.log({
    level,
    message: event,
    event,
    ...details,
  });
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

async function ensureAuthState() {
  if (authStatePromise) {
    return authStatePromise;
  }

  await loadBaileys();

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
  const boundedDelay = Math.min(baseDelay, RECONNECT_MAX_DELAY_MS);
  const jitterRatio = Number.isFinite(RECONNECT_JITTER_RATIO)
    ? Math.max(0, Math.min(RECONNECT_JITTER_RATIO, 0.8))
    : 0;
  const jitterRange = boundedDelay * jitterRatio;
  const jitteredDelay = boundedDelay + ((Math.random() * 2 * jitterRange) - jitterRange);
  return Math.max(250, Math.round(jitteredDelay));
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
  await loadBaileys();

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
