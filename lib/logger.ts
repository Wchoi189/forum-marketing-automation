import pino from "pino";

const level = process.env.LOG_LEVEL?.trim().toLowerCase() || "info";

export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

