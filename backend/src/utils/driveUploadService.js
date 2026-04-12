const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

async function uploadImageToDrive(file) {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.DRIVE_FOLDER_ID;

  if (!keyFile) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing");
  }

  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID is missing");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  const drive = google.drive({ version: "v3", auth });
  const requestBody = {
    name: file.originalname || path.basename(file.path),
    parents: [folderId],
  };

  const media = {
    mimeType: file.mimetype || "application/octet-stream",
    body: fs.createReadStream(file.path),
  };

  const uploadResponse = await drive.files.create({
    requestBody,
    media,
    fields: "id",
  });

  const fileId = uploadResponse?.data?.id;
  if (!fileId) {
    throw new Error("Drive upload failed");
  }

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId);
}

module.exports = { uploadImageToDrive };