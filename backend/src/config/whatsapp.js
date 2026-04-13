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
let isInitializing = false;
const GLOBAL_INIT_STATE_KEY = "__whatsapp_init_state__";

const globalInitState = globalThis[GLOBAL_INIT_STATE_KEY] || {
  initialized: false,
  initializationPromise: null,
};

globalThis[GLOBAL_INIT_STATE_KEY] = globalInitState;

const CONNECT_READY_TIMEOUT_MS = Number.parseInt(process.env.WHATSAPP_CONNECT_TIMEOUT_MS, 10) || 45000;
const RECONNECT_DELAY_MS = Number.parseInt(process.env.WHATSAPP_RECONNECT_DELAY_MS, 10) || 5000;

const whatsappLogger = logger.child({ component: "whatsapp" });

async function loadBaileys() {
  if (makeWASocket && useMultiFileAuthState && fetchLatestBaileysVersion) {
    return;
  }

  if (baileysImportPromise) {
    return baileysImportPromise;
  }

  // Baileys v7+ is ESM-only, so CommonJS code must import it dynamically.
  baileysImportPromise = import("baileys")
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
  isConnected: false,
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

function getDisconnectStatusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode
    || lastDisconnect?.error?.output?.payload?.statusCode
    || lastDisconnect?.error?.data?.statusCode
    || null;
}

function updateConnectionState(update = {}) {
  const nextConnection = typeof update.connection === "string" ? update.connection : null;

  if (nextConnection) {
    connectionState.status = nextConnection;
    connectionState.isConnected = nextConnection === "open";
    connectionState.connected = nextConnection === "open";
  }

  if (socket?.user?.id) {
    connectionState.jid = socket.user.id;
  }

  const statusCode = getDisconnectStatusCode(update?.lastDisconnect);
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
  return Boolean(socket) && connectionState.isConnected;
}

function getSocket() {
  return socket;
}

function getConnectionState() {
  return {
    isConnected: connectionState.isConnected,
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

function scheduleReconnect() {
  if (reconnectTimer || connectPromise || connectionState.loggedOut) {
    return;
  }

  reconnectAttempts += 1;

  log("warn", "Reconnecting...", {
    attempt: reconnectAttempts,
    delayMs: RECONNECT_DELAY_MS,
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
  }, RECONNECT_DELAY_MS);
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
        const statusCode = getDisconnectStatusCode(update?.lastDisconnect);
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
      log("info", "WhatsApp Connected", {
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

    const statusCode = getDisconnectStatusCode(lastDisconnect);
    const reason = lastDisconnect?.error?.message || "connection closed";

    log("warn", "disconnected", {
      statusCode,
      reason,
    });

    socket = null;
    connectionState.isConnected = false;
    connectionState.connected = false;
    connectionState.status = "close";
    connectionState.updatedAt = new Date().toISOString();

    if (statusCode === DisconnectReason.loggedOut) {
      connectionState.loggedOut = true;
      clearReconnectTimer();
      log("warn", "QR required", {
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
  if (socket && connectionState.connected) {
    log("info", "already_connected_skip");
    return socket;
  }

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

function initializeWhatsAppOnce() {
  if (isSocketConnected()) {
    return Promise.resolve(socket);
  }

  if (isInitializing || globalInitState.initializationPromise) {
    log("info", "whatsapp_initialization_in_progress");
    return globalInitState.initializationPromise || connectPromise;
  }

  isInitializing = true;
  log("info", "whatsapp_initialization_started");

  globalInitState.initializationPromise = connectWhatsApp()
    .then((connectedSocket) => {
      globalInitState.initialized = true;
      return connectedSocket;
    })
    .finally(() => {
      isInitializing = false;
      globalInitState.initializationPromise = null;
    });

  return globalInitState.initializationPromise;
}

module.exports = {
  initializeWhatsAppOnce,
  connectWhatsApp,
  getSocket,
  getConnectionState,
  isSocketConnected,
};
