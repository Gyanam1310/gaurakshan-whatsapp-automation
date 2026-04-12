const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());
app.disable("x-powered-by");

require("dotenv").config();

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes"); 
const { initializeWhatsApp } = require("./services/whatsappService");

function healthzResponse() {
  return {
    success: true,
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

app.get("/healthz", (req, res) => {
  res.json(healthzResponse());
});

app.get("/api/healthz", (req, res) => {
  res.json(healthzResponse());
});

app.use(messageRoutes);
app.use(imageRoutes);
app.use("/api", messageRoutes);
app.use("/api", imageRoutes);

initializeWhatsApp()
  .then(() => {
    console.log("[startup] WhatsApp initialization requested");
  })
  .catch((error) => {
    console.error("[startup] WhatsApp initialization failed:", error.message);
  });

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
