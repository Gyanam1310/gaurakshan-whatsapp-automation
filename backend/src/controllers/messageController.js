const { saveToSheet } = require("../utils/sheetService");
const fs = require("fs/promises");
const axios = require("axios");
const { uploadImageToDrive } = require("../utils/driveUploadService");
const { connectWhatsApp, getSocket } = require("../config/whatsapp");
const {
  isWhatsAppConnected,
  getWhatsAppState,
  sendMessageToWhatsApp,
} = require("../services/whatsappService");
const { logger } = require("../config/logger");

const messageLogger = logger.child({ component: "message-controller" });

const sentMessageCache = new Map();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function readTextField(value) {
  if (Array.isArray(value)) {
    return readTextField(value[0]);
  }

  return typeof value === "string" ? value.trim() : "";
}

function readOptionalId(value) {
  if (Array.isArray(value)) {
    return readOptionalId(value[0]);
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return "";
}

function normalizeImage(body) {
  const directImageUrl = readTextField(body?.imageUrl);
  if (directImageUrl) {
    return directImageUrl;
  }

  if (Array.isArray(body?.images)) {
    const firstArrayImage = readTextField(body.images[0]);
    if (firstArrayImage) {
      return firstArrayImage;
    }
  }

  const imagesValue = readTextField(body?.images);
  if (!imagesValue) {
    return "";
  }

  try {
    const parsedImages = JSON.parse(imagesValue);
    if (Array.isArray(parsedImages)) {
      const firstParsedImage = readTextField(parsedImages[0]);
      return firstParsedImage || "";
    }
  } catch {
    // Keep the raw value when it is not JSON.
  }

  return imagesValue;
}

function assertRequired(value, fieldName) {
  if (value) {
    return;
  }

  const error = new Error(fieldName + " is required");
  error.statusCode = 400;
  throw error;
}

async function cleanupUploadedFile(file) {
  if (!file?.path) {
    return;
  }

  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      messageLogger.warn("uploaded_file_cleanup_failed", {
        message: error.message,
        filePath: file.path,
      });
    }
  }
}

function purgeExpiredSentCache() {
  const now = Date.now();

  for (const [id, entry] of sentMessageCache.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      sentMessageCache.delete(id);
    }
  }
}

function buildPayloadSignature(payload) {
  return JSON.stringify({
    groupId: payload.groupId,
    message: payload.message,
    imageUrl: payload.imageUrl,
    donationDate: payload.donationDate,
  });
}

async function assertImageUrlAccessible(imageUrl) {
  if (!imageUrl) {
    return;
  }

  const requestConfig = {
    timeout: 10000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  };

  try {
    await axios.head(imageUrl, requestConfig);
    return;
  } catch (headError) {
    try {
      const response = await axios.get(imageUrl, {
        ...requestConfig,
        responseType: "stream",
      });

      if (response?.data && typeof response.data.destroy === "function") {
        response.data.destroy();
      }

      return;
    } catch (getError) {
      const error = new Error("imageUrl is not accessible");
      error.statusCode = 400;
      error.code = "IMAGE_URL_UNREACHABLE";
      error.details = {
        imageUrl,
        headError: headError.message,
        getError: getError.message,
      };
      throw error;
    }
  }
}

async function executeSendMessage({ payload, incomingBody, logPrefix }) {
  purgeExpiredSentCache();

  const signature = buildPayloadSignature(payload);
  const hasIdempotencyKey = Boolean(payload.id);
  const idempotencyKey = hasIdempotencyKey ? payload.id : null;

  if (hasIdempotencyKey) {
    const cachedEntry = sentMessageCache.get(idempotencyKey);

    if (cachedEntry) {
      if (cachedEntry.signature === signature) {
        messageLogger.warn("duplicate_idempotency_key", {
          logPrefix,
          idempotencyKey,
        });
        return {
          duplicate: true,
          skipped: true,
          messageId: cachedEntry.messageId,
          sentAt: cachedEntry.sentAt,
        };
      }

      const conflictError = new Error("Duplicate id with different payload");
      conflictError.statusCode = 409;
      conflictError.code = "IDEMPOTENCY_CONFLICT";
      conflictError.details = {
        existingSentAt: cachedEntry.sentAt,
      };
      throw conflictError;
    }
  }

  let socket = getSocket();
  if (!socket || !isWhatsAppConnected()) {
    messageLogger.warn("whatsapp_disconnected_attempt_init", {
      logPrefix,
    });
    await connectWhatsApp();
    socket = getSocket();
  }

  if (!socket || !isWhatsAppConnected()) {
    const unavailableError = new Error("WhatsApp session is not connected");
    unavailableError.statusCode = 503;
    unavailableError.code = "WHATSAPP_NOT_CONNECTED";
    unavailableError.details = getWhatsAppState();
    throw unavailableError;
  }

  await assertImageUrlAccessible(payload.imageUrl);

  messageLogger.info("whatsapp_send_attempt", {
    logPrefix,
    id: payload.id,
    groupId: payload.groupId,
    donationDate: payload.donationDate,
    hasImage: Boolean(payload.imageUrl),
    messageLength: payload.message.length,
  });

  const sendResult = await sendMessageToWhatsApp({
    groupId: payload.groupId,
    message: payload.message,
    imageUrl: payload.imageUrl,
  });

  const sentAt = new Date().toISOString();
  if (hasIdempotencyKey) {
    sentMessageCache.set(idempotencyKey, {
      signature,
      messageId: sendResult.messageId || null,
      sentAt,
      timestamp: Date.now(),
    });
  }

  messageLogger.info("whatsapp_send_success", {
    logPrefix,
    messageId: sendResult.messageId || null,
    groupId: sendResult.groupId,
  });

  return {
    duplicate: false,
    skipped: false,
    messageId: sendResult.messageId || null,
    groupId: sendResult.groupId,
    groupSubject: sendResult.groupSubject || null,
    sentAt,
    requestBodyEcho: incomingBody,
  };
}

async function saveDonation(req, res) {
  try {
    messageLogger.info("save_donation_request", {
      hasFile: Boolean(req.file),
      bodyKeys: Object.keys(req.body || {}),
    });

    const id = readOptionalId(req.body?.id);
    const donationDate = readTextField(req.body?.donationDate);
    const formattedMessage = readTextField(req.body?.formattedMessage);

    assertRequired(donationDate, "donationDate");
    assertRequired(formattedMessage, "formattedMessage");

    let imageUrl = normalizeImage(req.body);

    if (req.file) {
      try {
        imageUrl = await uploadImageToDrive(req.file);
      } catch (uploadError) {
        messageLogger.error("drive_upload_failed", {
          message: uploadError.message,
        });
        imageUrl = "";
      }
    }

    const sheetResult = await saveToSheet({
      id,
      donationDate,
      formattedMessage,
      imageUrl,
      status: "pending",
      retryCount: 0,
    });

    return res.json({
      success: true,
      data: sheetResult?.sheetData || null,
    });
  } catch (error) {
    messageLogger.error("save_donation_failed", {
      message: error.message,
      stack: error.stack || null,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Failed to save donation",
    });
  } finally {
    await cleanupUploadedFile(req.file);
  }
}

async function sendMessage(req, res) {
  const incomingBody = req.body || {};

  const rawMessage = incomingBody.message || incomingBody.formattedMessage;
  const message = readTextField(rawMessage);
  const id = readOptionalId(incomingBody.id) || null;
  const groupId = readTextField(incomingBody.groupId);
  const imageUrl = readTextField(incomingBody.imageUrl);
  const donationDate = readTextField(incomingBody.donationDate);

  messageLogger.info("send_message_request", {
    id,
    groupId,
    hasImageUrl: Boolean(imageUrl),
    messageLength: message.length,
  });

  const validationErrors = [];

  if (!groupId) {
    validationErrors.push("groupId is required");
  } else if (!groupId.endsWith("@g.us")) {
    validationErrors.push("groupId must end with @g.us");
  }

  if (!message) {
    validationErrors.push("message is required (message or formattedMessage)");
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      ...(id ? { id } : {}),
      error: "Validation failed",
      details: validationErrors,
    });
  }

  const payload = req.validatedSendMessage || {
    id,
    message,
    imageUrl,
    groupId,
    donationDate,
  };
  const logPrefix = `[send-message][id=${id || "missing"}]`;

  try {
    let sendMeta;

    if (payload.imageUrl) {
      try {
        sendMeta = await executeSendMessage({ payload, incomingBody, logPrefix });
      } catch (error) {
        const isImageFailure =
          error?.code === "IMAGE_URL_UNREACHABLE" ||
          (error?.code === "SEND_FAILED" && /image|media|url|download|fetch/i.test(String(error?.message || "")));

        if (!isImageFailure) {
          throw error;
        }

        messageLogger.warn("image_send_failed_retry_text_only", {
          logPrefix,
          error: error.message,
        });

        sendMeta = await executeSendMessage({
          payload: {
            ...payload,
            imageUrl: "",
          },
          incomingBody,
          logPrefix: `${logPrefix}[text-fallback]`,
        });
      }
    } else {
      sendMeta = await executeSendMessage({ payload, incomingBody, logPrefix });
    }

    return res.json({
      success: true,
      ...(id ? { id } : {}),
      ...(sendMeta.messageId ? { messageId: sendMeta.messageId } : {}),
    });
  } catch (error) {
    messageLogger.error("whatsapp_send_failed", {
      logPrefix,
      message: error.message,
      code: error.code || null,
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      ...(id ? { id } : {}),
      error: error.message || "Failed to send WhatsApp message",
      details: Array.isArray(error.details)
        ? error.details
        : error.details
          ? [error.details]
          : [],
    });
  }
}

function healthCheck(req, res) {
  return res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
    whatsapp: getWhatsAppState(),
  });
}

async function testWhatsApp(req, res) {
  const incomingBody = req.body || {};
  const id = readOptionalId(incomingBody.id) || `test-${Date.now()}`;
  const rawMessage = incomingBody.message || incomingBody.formattedMessage;
  const payload = {
    id,
    message: readTextField(rawMessage) || "Test message from /test-whatsapp",
    imageUrl: readTextField(incomingBody.imageUrl),
    groupId: readTextField(incomingBody.groupId) || readTextField(process.env.GROUP_ID),
    donationDate: readTextField(incomingBody.donationDate) || new Date().toISOString().slice(0, 10),
  };

  const logPrefix = `[test-whatsapp][id=${payload.id}]`;
  messageLogger.info("test_whatsapp_request", {
    logPrefix,
    groupId: payload.groupId,
    hasImageUrl: Boolean(payload.imageUrl),
  });

  if (!payload.groupId) {
    return res.status(400).json({
      success: false,
      ...incomingBody,
      id: payload.id,
      error: "groupId is required (or set GROUP_ID in .env)",
    });
  }

  if (!payload.groupId.endsWith("@g.us")) {
    return res.status(400).json({
      success: false,
      ...incomingBody,
      id: payload.id,
      error: "groupId must end with @g.us",
    });
  }

  if (!payload.message.trim()) {
    return res.status(400).json({
      success: false,
      ...incomingBody,
      id: payload.id,
      error: "message cannot be empty",
    });
  }

  try {
    const sendMeta = await executeSendMessage({ payload, incomingBody, logPrefix });

    return res.json({
      success: true,
      ...incomingBody,
      id: payload.id,
      details: {
        testRoute: true,
        duplicate: sendMeta.duplicate,
        skipped: sendMeta.skipped,
        sentAt: sendMeta.sentAt,
        messageId: sendMeta.messageId || null,
        groupId: sendMeta.groupId || payload.groupId,
        groupSubject: sendMeta.groupSubject || null,
      },
    });
  } catch (error) {
    messageLogger.error("test_whatsapp_failed", {
      logPrefix,
      message: error.message,
      code: error.code || null,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      ...incomingBody,
      id: payload.id,
      error: error.message || "Failed to send test WhatsApp message",
      details: error.details || {
        code: error.code || "SEND_FAILED",
      },
    });
  }
}

module.exports = {
  saveDonation,
  sendMessage,
  healthCheck,
  testWhatsApp,
};
