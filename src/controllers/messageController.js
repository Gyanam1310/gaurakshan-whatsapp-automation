const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { uploadImageToDrive } = require("../utils/driveUploadService");
const {
  initializeWhatsApp,
  isWhatsAppConnected,
  getWhatsAppState,
  getAvailableGroups,
  sendMessageToWhatsApp,
} = require("../services/whatsappService");

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
      console.warn("⚠️ Failed to cleanup uploaded file:", error.message);
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
    folderId: payload.folderId,
    donationDate: payload.donationDate,
  });
}

function resolveGoogleKeyFilePath() {
  const keyFileFromEnv = readTextField(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  if (!keyFileFromEnv) {
    const error = new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing");
    error.statusCode = 500;
    error.code = "GOOGLE_KEY_MISSING";
    throw error;
  }

  return path.isAbsolute(keyFileFromEnv)
    ? keyFileFromEnv
    : path.resolve(process.cwd(), keyFileFromEnv);
}

async function fetchDriveImageBufferByFolderId(folderId) {
  const normalizedFolderId = readTextField(folderId);
  if (!normalizedFolderId) {
    const error = new Error("folderId is required");
    error.statusCode = 400;
    error.code = "FOLDER_ID_MISSING";
    throw error;
  }

  try {
    console.log("Folder ID:", normalizedFolderId);

    const keyFilePath = resolveGoogleKeyFilePath();
    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.list({
      q: `'${normalizedFolderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    console.log("Drive response:", response.data);
    console.log("Files:", response.data.files);

    const files = response.data.files;

    if (!files || files.length === 0) {
      throw new Error("No images found in selected folder");
    }

    const file = files[0];
    console.log("Selected file:", file);

    if (!file || !file.id) {
      throw new Error("Invalid file object from Drive");
    }

    const fileData = await drive.files.get({
      fileId: file.id,
      alt: "media",
    }, { responseType: "arraybuffer" });

    const buffer = Buffer.from(fileData.data);

    return {
      folderId: normalizedFolderId,
      filesFetched: files.length,
      fileId: file.id,
      fileName: file.name || null,
      buffer,
    };
  } catch (error) {
    console.error("Google Drive error:", error.response?.data || error.message);

    if (!error.statusCode) {
      error.statusCode = error.response?.status || 500;
    }
    if (!error.code) {
      error.code = "GOOGLE_DRIVE_FETCH_FAILED";
    }
    error.details = {
      folderId: normalizedFolderId,
      googleError: error.response?.data || null,
      message: error.message,
      ...(error.details || {}),
    };

    throw error;
  }
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

  const normalizedFolderId = readTextField(payload.folderId);
  let driveImage = null;

  const signature = buildPayloadSignature(payload);
  const hasIdempotencyKey = Boolean(payload.id);
  const idempotencyKey = hasIdempotencyKey ? payload.id : null;

  if (hasIdempotencyKey) {
    const cachedEntry = sentMessageCache.get(idempotencyKey);

    if (cachedEntry) {
      if (cachedEntry.signature === signature) {
        console.warn(logPrefix, "Duplicate id detected; returning cached success response");
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

  if (!isWhatsAppConnected()) {
    console.warn(logPrefix, "WhatsApp is disconnected; attempting initialization");
    await initializeWhatsApp();
  }

  if (!isWhatsAppConnected()) {
    const unavailableError = new Error("WhatsApp session is not connected");
    unavailableError.statusCode = 503;
    unavailableError.code = "WHATSAPP_NOT_CONNECTED";
    unavailableError.details = getWhatsAppState();
    throw unavailableError;
  }

  if (normalizedFolderId) {
    driveImage = await fetchDriveImageBufferByFolderId(normalizedFolderId);
    console.log(logPrefix, "Drive image selected", {
      folderId: driveImage.folderId,
      filesFetched: driveImage.filesFetched,
      selectedFileId: driveImage.fileId,
      selectedFileName: driveImage.fileName,
    });
  } else {
    await assertImageUrlAccessible(payload.imageUrl);
  }

  console.log(logPrefix, "WhatsApp send attempt", {
    id: payload.id,
    groupId: payload.groupId,
    folderId: normalizedFolderId || null,
    donationDate: payload.donationDate,
    hasImage: Boolean(payload.imageUrl || driveImage?.buffer),
    messageLength: payload.message.length,
  });
  console.log("Sending to group:", payload.groupId);

  const sendResult = await sendMessageToWhatsApp({
    groupId: payload.groupId,
    message: payload.message,
    imageUrl: payload.imageUrl,
    imageBuffer: driveImage?.buffer || null,
    imageMimeType: null,
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

  console.log(logPrefix, "WhatsApp send success", {
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
    console.log("==== INCOMING SAVE REQUEST ====");
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const id = readOptionalId(req.body?.id);
    const donationDate = readTextField(req.body?.donationDate);
    const formattedMessage = readTextField(req.body?.formattedMessage);
    const folderId = readTextField(req.body?.folderId);
    const groupId = readTextField(req.body?.groupId) || readTextField(process.env.GROUP_ID);

    assertRequired(formattedMessage, "formattedMessage");
    assertRequired(groupId, "groupId");

    let imageUrl = normalizeImage(req.body);

    if (req.file) {
      try {
        imageUrl = await uploadImageToDrive(req.file);
      } catch (uploadError) {
        console.error("⚠️ Google Drive upload failed:", uploadError.message);
        imageUrl = "";
      }
    }

    const payload = {
      id,
      message: formattedMessage,
      imageUrl,
      folderId,
      groupId,
      donationDate,
    };

    const logPrefix = `[save-donation][id=${id || "missing"}]`;
    const sendMeta = await executeSendMessage({
      payload,
      incomingBody: req.body || {},
      logPrefix,
    });

    return res.json({
      success: true,
      ...(id ? { id } : {}),
      ...(sendMeta.messageId ? { messageId: sendMeta.messageId } : {}),
    });
  } catch (error) {
    console.error("Send error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
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
  const folderId = readTextField(incomingBody.folderId);
  const imageUrl = readTextField(incomingBody.imageUrl);
  const donationDate = readTextField(incomingBody.donationDate);

  console.log("Incoming body:", incomingBody);
  console.log("Parsed message:", message);

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
    folderId,
    groupId,
    donationDate,
  };
  const logPrefix = `[send-message][id=${id || "missing"}]`;
  console.log("Sending message to group:", payload.groupId);
  console.log("Message:", payload.message);
  console.log("Folder ID:", payload.folderId || "");

  try {
    const sendMeta = await executeSendMessage({ payload, incomingBody, logPrefix });

    return res.json({
      success: true,
      ...(id ? { id } : {}),
      ...(sendMeta.messageId ? { messageId: sendMeta.messageId } : {}),
    });
  } catch (err) {
    console.error("Send error:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

async function testGroup(req, res) {
  try {
    const groups = await getAvailableGroups();
    return res.json(groups);
  } catch (err) {
    console.error("WhatsApp send error:", err);
    return res.status(500).json({
      error: err.message,
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
    folderId: readTextField(incomingBody.folderId),
    groupId: readTextField(incomingBody.groupId) || readTextField(process.env.GROUP_ID),
    donationDate: readTextField(incomingBody.donationDate) || new Date().toISOString().slice(0, 10),
  };

  const logPrefix = `[test-whatsapp][id=${payload.id}]`;
  console.log(logPrefix, "Incoming request body:", incomingBody);

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
    console.error(logPrefix, "WhatsApp test send failed:", error.message);
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
  testGroup,
  testWhatsApp,
};
