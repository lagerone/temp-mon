import fs from 'fs';
import path from 'path';
import { createLogger, format, transports } from 'winston';

const logLevel = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';

// Ensure log directory exists
const logDir = process.env.LOG_DIR || 'logs';
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  // If directory creation fails, we'll continue with console-only logging.
  // eslint-disable-next-line no-console
  console.error('Failed to create log directory', { logDir, err });
}

const winstonLogger = createLogger({
  level: logLevel,
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'temp-mon' },
  transports: [
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
      ),
    }),
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
      ),
    }),
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: path.join(logDir, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: path.join(logDir, 'rejections.log') }),
  ],
});

export const logger = winstonLogger;
