const fs = require("fs");
const path = require("path");
const { createLogger, format, transports } = require("winston");

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_MAX_SIZE_MB = readPositiveInt(process.env.LOG_MAX_SIZE_MB, 10);
const LOG_MAX_FILES = readPositiveInt(process.env.LOG_MAX_FILES, 14);

fs.mkdirSync(LOG_DIR, { recursive: true });

const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: LOG_LEVEL,
  format: jsonFormat,
  defaultMeta: {
    service: "whatsapp-backend",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      maxsize: LOG_MAX_SIZE_MB * 1024 * 1024,
      maxFiles: LOG_MAX_FILES,
    }),
    new transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      maxsize: LOG_MAX_SIZE_MB * 1024 * 1024,
      maxFiles: LOG_MAX_FILES,
    }),
  ],
});

const accessLogger = logger.child({ component: "access" });

module.exports = {
  logger,
  accessLogger,
};
