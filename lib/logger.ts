import pino from "pino";

const level = process.env.LOG_LEVEL?.trim().toLowerCase() || "info";
const isDevelopment = process.env.NODE_ENV?.trim().toLowerCase() !== "production";

export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

