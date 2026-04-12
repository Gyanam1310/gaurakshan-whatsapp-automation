function readTextField(value) {
  if (Array.isArray(value)) {
    return readTextField(value[0]);
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return "";
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDonationDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function isValidGroupId(value) {
  return /^\d{5,}-\d+@g\.us$/.test(value);
}

function validateSendMessageRequest(req, res, next) {
  const incomingBody = req.body || {};
  const message = readTextField(incomingBody.message || incomingBody.formattedMessage);

  const payload = {
    id: readTextField(incomingBody.id),
    message,
    imageUrl: readTextField(incomingBody.imageUrl),
    groupId: readTextField(incomingBody.groupId),
    donationDate: readTextField(incomingBody.donationDate),
  };

  const errors = [];

  if (!payload.message) {
    errors.push("message is required (message or formattedMessage)");
  }

  if (!payload.groupId) {
    errors.push("groupId is required");
  } else if (!isValidGroupId(payload.groupId)) {
    errors.push("groupId must match format like 1234567890-123456789@g.us");
  }

  if (payload.donationDate && !isValidDonationDate(payload.donationDate)) {
    errors.push("donationDate must be a valid date value");
  }

  if (payload.imageUrl && !isValidHttpUrl(payload.imageUrl)) {
    errors.push("imageUrl must be a valid http/https URL");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      ...incomingBody,
      id: payload.id || null,
      error: "Validation failed",
      details: errors,
    });
  }

  req.validatedSendMessage = payload;
  return next();
}

module.exports = {
  validateSendMessageRequest,
  readTextField,
};
