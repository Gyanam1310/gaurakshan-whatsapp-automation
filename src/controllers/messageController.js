const {
  isWhatsAppConnected,
  sendMessageToWhatsApp,
} = require("../services/whatsappService");
const { saveToSheet } = require("../utils/sheetService");

async function sendMessage(req, res) {
  try {
    console.log("==== INCOMING REQUEST ====");
    console.log(JSON.stringify(req.body, null, 2));

    if (!isWhatsAppConnected()) {
      return res.status(500).json({ error: "WhatsApp not connected" });
    }

    const {
      postType,
      donationType,
      donorName,
      familyName,
      occasion,
      count,
      location,
      message,
      images,
    } = req.body;
    const groupId = process.env.GROUP_ID;

    if (!groupId) {
      return res.status(500).json({ error: "GROUP_ID missing in .env" });
    }

    if (!message && (!images || images.length === 0)) {
      return res.status(400).json({ error: "Message or image required" });
    }

    await sendMessageToWhatsApp({ groupId, message, images });

    const date = new Date().toISOString().split("T")[0];
    const firstImage = Array.isArray(images)
      ? images?.[0] || ""
      : typeof images === "string"
      ? images
      : "";

    try {
      await saveToSheet({
        date,
        postType: postType || "",
        donationType: donationType || "",
        donorName: donorName || "",
        familyName: familyName || "",
        occasion: occasion || "",
        count: count || "",
        location: location || "",
        message: message || "",
        image: firstImage,
        status: "sent",
      });
    } catch (sheetError) {
      console.error("⚠️ Google Sheet save failed, continuing response:", sheetError.message);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("🔥 ERROR:", err);
    return res.status(500).json({
      error: "Failed to send message",
      details: err.message,
    });
  }
}

module.exports = { sendMessage };
