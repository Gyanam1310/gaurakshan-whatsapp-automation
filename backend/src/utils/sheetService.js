const { google } = require("googleapis");

const ALLOWED_STATUSES = new Set(["pending", "sent", "failed"]);

function toTrimmedString(value) {
  if (Array.isArray(value)) {
    return toTrimmedString(value[0]);
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toOptionalNumericId(value) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function toRetryCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function toStatus(value) {
  const normalized = toTrimmedString(value).toLowerCase();
  return ALLOWED_STATUSES.has(normalized) ? normalized : "pending";
}

async function getNextSheetId({ sheets, spreadsheetId, sheetName }) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:A`,
  });

  const rows = Array.isArray(response.data?.values) ? response.data.values : [];
  let maxId = 0;

  for (const row of rows) {
    const value = Array.isArray(row) ? row[0] : null;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > maxId) {
      maxId = Math.floor(parsed);
    }
  }

  return maxId + 1;
}

async function prepareSheetData({ data, sheets, spreadsheetId, sheetName }) {
  const providedId = toOptionalNumericId(data?.id);
  const id = providedId || await getNextSheetId({ sheets, spreadsheetId, sheetName });

  return {
    id,
    donationDate: toTrimmedString(data?.donationDate),
    formattedMessage: toTrimmedString(data?.formattedMessage),
    imageUrl: toTrimmedString(data?.imageUrl),
    status: toStatus(data?.status),
    retryCount: toRetryCount(data?.retryCount),
  };
}

async function saveToSheet(data) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetName = "Sheet1";

  if (!spreadsheetId) {
    console.warn("⚠️ SPREADSHEET_ID is missing. Skipping Google Sheet save.");
    return { skipped: true };
  }

  if (!keyFile) {
    console.warn("⚠️ GOOGLE_SERVICE_ACCOUNT_KEY is missing. Skipping Google Sheet save.");
    return { skipped: true };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const sheetData = await prepareSheetData({
      data,
      sheets,
      spreadsheetId,
      sheetName,
    });

    console.log("[sheets] prepared payload:", sheetData);

    const values = [[
      sheetData.id,
      sheetData.donationDate,
      sheetData.formattedMessage,
      sheetData.imageUrl,
      sheetData.status,
      sheetData.retryCount,
    ]];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    console.log("✅ Saved to Google Sheet");
    return {
      saved: true,
      sheetData,
      updates: response.data?.updates || null,
    };
  } catch (error) {
    const details = error.response?.data?.error || error.message;
    console.error("❌ Failed to save to Google Sheet:", details);
    throw error;
  }
}

module.exports = { saveToSheet, prepareSheetData };
