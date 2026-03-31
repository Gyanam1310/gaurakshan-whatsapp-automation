const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

require("dotenv").config();
const path = require("path");

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes"); 
const { initializeWhatsApp } = require("./services/whatsappService");

app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.use(messageRoutes);
app.use(imageRoutes);

initializeWhatsApp()
  .then(() => {
    console.log("[startup] WhatsApp initialization requested");
  })
  .catch((error) => {
    console.error("[startup] WhatsApp initialization failed:", error.message);
  });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;