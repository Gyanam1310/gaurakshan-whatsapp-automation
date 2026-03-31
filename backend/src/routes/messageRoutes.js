const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
	saveDonation,
	sendMessage,
	healthCheck,
	testWhatsApp,
} = require("../controllers/messageController");
const { validateSendMessageRequest } = require("../middleware/sendMessageValidation");

const router = express.Router();
const uploadDir = path.join(__dirname, "../../tmp-uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

router.post("/save-donation", upload.single("image"), saveDonation);
router.post("/send-message", validateSendMessageRequest, sendMessage);
router.post("/test-whatsapp", testWhatsApp);
router.get("/health", healthCheck);

module.exports = router;
