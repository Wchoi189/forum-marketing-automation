import type { ParsedResult } from "./types.js";
export type { ParsedResult };

export type VendorSelectors = {
  /** CSS selectors to find content body, most specific first */
  contentBodySelectors: string[];
  /** CSS selector for title extraction */
  titleSelector?: string;
  /** CSS selector for vendor name extraction */
  vendorSelector?: string;
  /** CSS selector for date extraction */
  dateSelector?: string;
  /** CSS selector for image extraction (within content body) */
  imageSelector?: string;
};

/**
 * Strategy interface that each vendor/platform must implement.
 * Enables multi-platform support by separating parsing logic from orchestration.
 */
export interface VendorStrategy {
  /** Unique identifier, e.g. "ppomppu" */
  readonly vendorId: string;

  /** CSS selectors for locating content on this platform */
  contentSelectors(): VendorSelectors;

  /** Parse HTML deterministically; returns ParsedResult with confidence score */
  parse(html: string, postUrl: string): ParsedResult;

  /** Given an image src attribute, decide if it is user-uploaded content (vs chrome/icon) */
  isUserContentImage(src: string): boolean;

  /** Classify account type from body text (e.g. "direct_login", "family_share") */
  classifyAccountType(bodyText: string, titleText: string): string | null;

  /** Regex for price patterns in this platform's language/market */
  pricePattern(): RegExp;

  /** Regex for duration patterns in this platform's language/market */
  durationPattern(): RegExp;
}
