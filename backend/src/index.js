require("dotenv").config();
const express = require("express");
const path = require("path");

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes");
const { initializeWhatsApp } = require("./services/whatsappService");
const { logger } = require("./config/logger");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.use(messageRoutes);
app.use(imageRoutes);

initializeWhatsApp()
	.then(() => {
		logger.info("whatsapp_initialization_requested");
	})
	.catch((error) => {
		logger.error("whatsapp_initialization_failed", {
			message: error.message,
			code: error.code || null,
		});
	});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	logger.info("server_started", {
		port: Number(PORT),
	});
});
