require("dotenv").config();
const express = require("express");
const path = require("path");

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes");
const { initializeWhatsApp } = require("./services/whatsappService");

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
		console.log("[startup] WhatsApp initialization requested");
	})
	.catch((error) => {
		console.error("[startup] WhatsApp initialization failed:", error.message);
	});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`🚀 Server running on port ${PORT}`);
});
