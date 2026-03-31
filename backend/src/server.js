require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes");
const { initializeWhatsApp, getWhatsAppState } = require("./services/whatsappService");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 30000;

const allowedOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
fs.mkdirSync(logDir, { recursive: true });
const accessLogFile = path.join(logDir, "access.log");

function appendAccessLog(entry) {
  fs.appendFile(accessLogFile, JSON.stringify(entry) + "\n", () => {
    // Intentionally ignore file write errors to avoid blocking requests.
  });
}

app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigins.length === 1 && allowedOrigins[0] === "*" ? "*" : allowedOrigins }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: "Request timeout",
      });
    }
  });

  res.on("finish", () => {
    appendAccessLog({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });

  next();
});

app.get("/healthz", (req, res) => {
  return res.json({
    success: true,
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    whatsapp: getWhatsAppState(),
  });
});

app.use(messageRoutes);
app.use(imageRoutes);

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal server error";

  console.error("[backend][error]", {
    message,
    statusCode,
    path: req.originalUrl,
  });

  return res.status(statusCode).json({
    success: false,
    error: message,
    details: error.details || null,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[backend] server listening on port ${PORT}`);
});

server.headersTimeout = REQUEST_TIMEOUT_MS + 1000;
server.requestTimeout = REQUEST_TIMEOUT_MS;

initializeWhatsApp()
  .then(() => {
    console.log("[startup] WhatsApp initialization requested");
  })
  .catch((error) => {
    console.error("[startup] WhatsApp initialization failed:", error.message);
  });

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException", error);
});

module.exports = app;