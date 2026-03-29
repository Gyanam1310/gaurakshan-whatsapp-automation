const { connectWhatsApp } = require("../config/whatsapp");

let sock;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setSocket(newSocket) {
  sock = newSocket;
}

async function initializeWhatsApp() {
  sock = await connectWhatsApp(setSocket);
  return sock;
}

function isWhatsAppConnected() {
  return Boolean(sock);
}

function normalizeFirstImage(images) {
  if (Array.isArray(images) && images.length > 0) {
    return images[0];
  }

  if (typeof images === "string") {
    return images;
  }

  return null;
}

async function sendMessageToWhatsApp({ groupId, message, images }) {
  if (!sock) {
    throw new Error("WhatsApp not connected");
  }

  const firstImage = normalizeFirstImage(images);

  console.log("Message:", message);
  console.log("First Image:", firstImage);

  // CASE 1: Send image with caption.
  if (firstImage && typeof firstImage === "string") {
    try {
      await sock.sendMessage(groupId, {
        image: { url: firstImage.trim() },
        caption: message || "",
      });

      console.log("✅ Image sent successfully");
      await delay(1500);
      return;
    } catch (err) {
      console.log("❌ Image failed, fallback to text:", err.message);

      if (message) {
        await sock.sendMessage(groupId, { text: message });
      }

      return;
    }
  }

  // CASE 2: Only text.
  if (message) {
    await sock.sendMessage(groupId, { text: message });
    console.log("✅ Text message sent");
  }
}

module.exports = {
  initializeWhatsApp,
  isWhatsAppConnected,
  sendMessageToWhatsApp,
};
