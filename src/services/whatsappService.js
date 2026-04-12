const { connectWhatsApp } = require("../config/whatsapp");

let sock = null;
let initializationPromise = null;

const connectionState = {
  connected: false,
  status: "not_initialized",
  lastDisconnectCode: null,
  lastDisconnectReason: null,
  updatedAt: null,
};

const boundSockets = new WeakSet();

function createError(message, statusCode = 500, code = "WHATSAPP_ERROR", details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function extractErrorDetails(error) {
  return {
    message: error?.message || "Unknown error",
    code: error?.code || null,
    name: error?.name || null,
  };
}

function updateConnectionState(update = {}) {
  const connection = typeof update.connection === "string" ? update.connection : null;

  if (connection) {
    connectionState.status = connection;
    connectionState.connected = connection === "open";
  }

  const statusCode = update?.lastDisconnect?.error?.output?.statusCode;
  if (statusCode) {
    connectionState.lastDisconnectCode = statusCode;
    connectionState.lastDisconnectReason = update?.lastDisconnect?.error?.message || null;
  }

  connectionState.updatedAt = new Date().toISOString();
}

function bindSocketEvents(socketInstance) {
  if (!socketInstance || boundSockets.has(socketInstance) || !socketInstance.ev) {
    return;
  }

  boundSockets.add(socketInstance);

  socketInstance.ev.on("connection.update", (update) => {
    updateConnectionState(update);
    console.log("[whatsapp] connection update:", {
      status: connectionState.status,
      connected: connectionState.connected,
      lastDisconnectCode: connectionState.lastDisconnectCode,
    });
  });
}

function setSocket(newSocket) {
  sock = newSocket;
  bindSocketEvents(sock);
}

async function initializeWhatsApp() {
  if (sock) {
    return sock;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = connectWhatsApp(setSocket)
    .then((createdSocket) => {
      if (!sock) {
        setSocket(createdSocket);
      }

      if (sock && sock.user) {
        sock.groupFetchAllParticipating()
          .then((groups) => {
            console.log("==== AVAILABLE GROUPS ====");
            for (const id in groups) {
              console.log(id, "=>", groups[id]?.subject || "<unknown>");
            }
          })
          .catch((error) => {
            console.error("[whatsapp] failed to fetch groups after connect:", error.message);
          });
      }

      return sock;
    })
    .finally(() => {
      initializationPromise = null;
    });

  return initializationPromise;
}

function isWhatsAppConnected() {
  return Boolean(sock) && connectionState.connected;
}

function getWhatsAppState() {
  return {
    library: "baileys",
    connected: isWhatsAppConnected(),
    hasSocket: Boolean(sock),
    status: connectionState.status,
    jid: sock?.user?.id || null,
    lastDisconnectCode: connectionState.lastDisconnectCode,
    lastDisconnectReason: connectionState.lastDisconnectReason,
    updatedAt: connectionState.updatedAt,
  };
}

async function ensureWhatsAppConnected() {
  if (!sock) {
    await initializeWhatsApp();
  }

  if (!isWhatsAppConnected()) {
    throw createError(
      "WhatsApp is not connected. Scan QR or restore valid session first.",
      503,
      "WHATSAPP_NOT_CONNECTED",
      getWhatsAppState()
    );
  }

  return sock;
}

async function getAvailableGroups() {
  const activeSocket = await ensureWhatsAppConnected();

  if (!activeSocket || !activeSocket.user) {
    throw createError("WhatsApp socket not initialized", 500, "SOCKET_NOT_INITIALIZED");
  }

  const groups = await activeSocket.groupFetchAllParticipating();

  console.log("==== AVAILABLE GROUPS ====");
  for (const id in groups) {
    console.log(id, "=>", groups[id]?.subject || "<unknown>");
  }

  return groups;
}

function validateGroupId(groupId) {
  const normalizedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  if (!normalizedGroupId || !normalizedGroupId.endsWith("@g.us")) {
    throw createError("Invalid group ID format", 400, "INVALID_GROUP_ID");
  }

  return normalizedGroupId;
}

async function assertGroupAccessible(groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    return metadata;
  } catch (error) {
    throw createError(
      "Invalid groupId or bot is not a member of this group",
      400,
      "GROUP_NOT_ACCESSIBLE",
      extractErrorDetails(error)
    );
  }
}

async function sendMessageToWhatsApp({ groupId, message, imageUrl, imageBuffer, imageMimeType }) {
  const activeSocket = await ensureWhatsAppConnected();

  if (!activeSocket || !activeSocket.user) {
    throw createError("WhatsApp socket not initialized", 500, "SOCKET_NOT_INITIALIZED");
  }

  const normalizedGroupId = validateGroupId(groupId);
  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  const normalizedImageUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
  const hasImageBuffer = Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0;

  if (!normalizedMessage && !normalizedImageUrl && !hasImageBuffer) {
    throw createError("Either formattedMessage or imageUrl is required", 400, "EMPTY_MESSAGE");
  }

  const groups = await getAvailableGroups();
  if (!groups[normalizedGroupId]) {
    throw createError("Bot is not a member of this group", 400, "GROUP_NOT_ACCESSIBLE");
  }

  const metadata = await assertGroupAccessible(normalizedGroupId);

  const payload = hasImageBuffer
    ? {
      image: imageBuffer,
      ...(imageMimeType ? { mimetype: imageMimeType } : {}),
      caption: normalizedMessage,
    }
    : normalizedImageUrl
    ? {
      image: { url: normalizedImageUrl },
      caption: normalizedMessage,
    }
    : {
      text: normalizedMessage,
    };

  console.log("[whatsapp] send attempt:", {
    groupId: normalizedGroupId,
    groupSubject: metadata?.subject || null,
    hasImage: Boolean(normalizedImageUrl || hasImageBuffer),
    imageSource: hasImageBuffer ? "buffer" : normalizedImageUrl ? "url" : "none",
    messageLength: normalizedMessage.length,
  });

  try {
    const result = await activeSocket.sendMessage(normalizedGroupId, payload);
    const messageId = result?.key?.id || null;

    console.log("[whatsapp] send success:", {
      groupId: normalizedGroupId,
      messageId,
    });

    return {
      groupId: normalizedGroupId,
      groupSubject: metadata?.subject || null,
      hasImage: Boolean(normalizedImageUrl || hasImageBuffer),
      messageId,
      rawKey: result?.key || null,
    };
  } catch (error) {
    const details = extractErrorDetails(error);
    const lowered = String(error?.message || "").toLowerCase();

    if (lowered.includes("rate")) {
      throw createError("WhatsApp rate limited the request", 429, "RATE_LIMITED", details);
    }

    throw createError("Failed to send WhatsApp message", 500, "SEND_FAILED", details);
  }
}

module.exports = {
  initializeWhatsApp,
  isWhatsAppConnected,
  getWhatsAppState,
  getAvailableGroups,
  sendMessageToWhatsApp,
};
