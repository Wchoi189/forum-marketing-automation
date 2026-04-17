import { ENV } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Sends a notification to Slack using an Incoming Webhook URL.
 * If SLACK_WEBHOOK_URL is not configured, it will only log to the local logger.
 */
export async function sendSlackNotification(text: string): Promise<void> {
  const url = ENV.SLACK_WEBHOOK_URL;

  if (!url) {
    logger.debug({ text }, "[Notifications] Slack Webhook URL not configured; skipping notification.");
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, errorText },
        "[Notifications] Failed to send Slack notification"
      );
    } else {
      logger.debug("[Notifications] Slack notification sent successfully.");
    }
  } catch (err) {
    logger.error({ err }, "[Notifications] Exception during Slack notification");
  }
}
