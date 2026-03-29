const axios = require("axios");

async function saveToSheet(data) {
  const sheetUrl = process.env.GOOGLE_SHEET_URL;

  if (!sheetUrl) {
    console.warn("⚠️ GOOGLE_SHEET_URL is missing. Skipping Google Sheet save.");
    return { skipped: true };
  }

  try {
    const response = await axios.post(sheetUrl, data, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    console.log("✅ Saved to Google Sheet");
    return response.data;
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error("❌ Failed to save to Google Sheet:", details);
    throw error;
  }
}

module.exports = { saveToSheet };
