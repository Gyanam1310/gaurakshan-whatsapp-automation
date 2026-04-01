require("dotenv").config();

const express = require("express");
const cors = require("cors");

const messageRoutes = require("./routes/messageRoutes");
const imageRoutes = require("./routes/imageRoutes");
const { initializeWhatsApp, getWhatsAppState } = require("./services/whatsappService");
const { logger, accessLogger } = require("./config/logger");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 30000;

const allowedOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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
    accessLogger.info("http_request", {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
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

  logger.error("request_failed", {
    message,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    details: error.details || null,
  });

  return res.status(statusCode).json({
    success: false,
    error: message,
    details: error.details || null,
  });
});

const server = app.listen(PORT, () => {
  logger.info("server_started", {
    port: PORT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
});

server.headersTimeout = REQUEST_TIMEOUT_MS + 1000;
server.requestTimeout = REQUEST_TIMEOUT_MS;

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

process.on("unhandledRejection", (reason) => {
  logger.error("process_unhandled_rejection", {
    reason,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("process_uncaught_exception", {
    message: error.message,
    stack: error.stack || null,
  });
});

module.exports = app;