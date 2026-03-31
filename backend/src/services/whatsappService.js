const {
  connectWhatsApp,
  getSocket,
  getConnectionState,
  isSocketConnected,
} = require("../config/whatsapp");

const SEND_TIMEOUT_MS = Number.parseInt(process.env.WHATSAPP_SEND_TIMEOUT_MS, 10) || 25000;
const SEND_RETRY_ATTEMPTS = Number.parseInt(process.env.WHATSAPP_SEND_RETRY_ATTEMPTS, 10) || 2;
const SEND_RETRY_BASE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_SEND_RETRY_BASE_DELAY_MS, 10) || 1500;

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

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = createError(timeoutMessage, 504, "WHATSAPP_TIMEOUT");
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isRetryableSendError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (
    code === "WHATSAPP_TIMEOUT" ||
    code === "SEND_FAILED" ||
    code === "CONNECTION_CLOSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  ) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("connection closed") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("stream errored")
  );
}

async function runWithRetry(task, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  const baseDelayMs = Math.max(250, options.baseDelayMs || 1000);

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableSendError(error)) {
        break;
      }

      const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), 8000);
      console.warn("[whatsapp] transient send failure, retrying", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error: error.message,
        code: error.code || null,
      });
      await wait(delayMs);
    }
  }

  throw lastError;
}

function isWhatsAppConnected() {
  return isSocketConnected();
}

function getWhatsAppState() {
  const state = getConnectionState();
  const socket = getSocket();

  return {
    library: "baileys",
    connected: state.connected,
    hasSocket: Boolean(socket),
    status: state.status,
    jid: socket?.user?.id || state.jid || null,
    lastDisconnectCode: state.lastDisconnectCode,
    lastDisconnectReason: state.lastDisconnectReason,
    updatedAt: state.updatedAt,
    reconnectAttempts: state.reconnectAttempts,
    loggedOut: state.loggedOut,
  };
}

async function ensureWhatsAppConnected() {
  let socket = getSocket();

  if (!socket || !isSocketConnected()) {
    await connectWhatsApp();
  }

  socket = getSocket();

  if (!socket || !isSocketConnected()) {
    throw createError(
      "WhatsApp is not connected. Scan QR or restore valid session first.",
      503,
      "WHATSAPP_NOT_CONNECTED",
      getWhatsAppState()
    );
  }

  return socket;
}

function validateGroupId(groupId) {
  const normalizedGroupId = typeof groupId === "string" ? groupId.trim() : "";
  if (!normalizedGroupId || !normalizedGroupId.endsWith("@g.us")) {
    throw createError("Invalid groupId. Expected WhatsApp group id ending with @g.us", 400, "INVALID_GROUP_ID");
  }

  return normalizedGroupId;
}

async function assertGroupAccessible(socket, groupId) {
  try {
    const metadata = await withTimeout(
      socket.groupMetadata(groupId),
      SEND_TIMEOUT_MS,
      "Timed out while validating WhatsApp group"
    );
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

async function sendMessageToWhatsApp({ groupId, message, imageUrl }) {
  let socket = await ensureWhatsAppConnected();

  const normalizedGroupId = validateGroupId(groupId);
  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  const normalizedImageUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";

  if (!normalizedMessage && !normalizedImageUrl) {
    throw createError("Either formattedMessage or imageUrl is required", 400, "EMPTY_MESSAGE");
  }

  const metadata = await assertGroupAccessible(socket, normalizedGroupId);

  const payload = normalizedImageUrl
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
    hasImage: Boolean(normalizedImageUrl),
    messageLength: normalizedMessage.length,
  });

  try {
    const result = await runWithRetry(
      async (attempt) => {
        socket = await ensureWhatsAppConnected();

        return withTimeout(
          socket.sendMessage(normalizedGroupId, payload),
          SEND_TIMEOUT_MS,
          `Timed out while sending WhatsApp message (attempt ${attempt})`
        );
      },
      {
        attempts: SEND_RETRY_ATTEMPTS,
        baseDelayMs: SEND_RETRY_BASE_DELAY_MS,
      }
    );

    const messageId = result?.key?.id || null;

    console.log("[whatsapp] send success:", {
      groupId: normalizedGroupId,
      messageId,
    });

    return {
      groupId: normalizedGroupId,
      groupSubject: metadata?.subject || null,
      hasImage: Boolean(normalizedImageUrl),
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
  initializeWhatsApp: connectWhatsApp,
  isWhatsAppConnected,
  getWhatsAppState,
  sendMessageToWhatsApp,
};
