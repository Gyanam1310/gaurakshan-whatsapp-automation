const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");

async function connectWhatsApp(onSocketReady) {
  const sessionDir = process.env.WHATSAPP_SESSION_DIR || "session";
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Keep using the latest supported Baileys version for better compatibility.
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📲 Scan QR:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
      if (typeof onSocketReady === "function") {
        onSocketReady(sock);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed:", statusCode);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("Reconnecting in 5s...");
        setTimeout(async () => {
          try {
            await connectWhatsApp(onSocketReady);
          } catch (err) {
            console.error("Reconnect failed:", err.message);
          }
        }, 5000);
      } else {
        console.log("❌ Logged out. Delete session and re-scan.");
      }
    }
  });

  return sock;
}

module.exports = { connectWhatsApp };
