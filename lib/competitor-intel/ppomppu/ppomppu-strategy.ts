import { parsePpomppuPost } from "../../competitor-ad-parser/index.js";
import type { ParsedResult, VendorSelectors, VendorStrategy } from "../vendor-strategy.js";
import { PPOMPPU_PRICE_PATTERN, PPOMPPU_DURATION_PATTERN } from "./patterns.js";

export class PpomppuStrategy implements VendorStrategy {
  readonly vendorId = "ppomppu";

  contentSelectors(): VendorSelectors {
    return {
      contentBodySelectors: [
        "div.JS_ContentMain td.board-contents",
        "td.board-contents",
        "div.JS_ContentMain",
      ],
      titleSelector: "#topTitle > h1",
      vendorSelector: "li.topTitle-name",
      dateSelector: "ul.topTitle-mainbox > li",
      imageSelector: "div.JS_ContentMain img.clickWide",
    };
  }

  parse(html: string, postUrl: string): ParsedResult {
    const parsed = parsePpomppuPost(html, postUrl);
    return {
      products: parsed.products,
      account_type: parsed.account_type ?? undefined,
      posted_at: parsed.posted_at,
      posted_at_raw: parsed.posted_at_raw,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
    };
  }

  isUserContentImage(src: string): boolean {
    const normalized = src.toLowerCase();
    if (normalized.includes("zboard/data")) return true;
    if (normalized.startsWith("data:")) return true;
    return false;
  }

  classifyAccountType(bodyText: string, titleText: string): string | null {
    const joined = titleText + " " + bodyText;
    if (/직접\s*(로그인|결제)/.test(joined)) return "direct_login";
    if (/가족/.test(joined) && /공유|초대|파티/.test(joined)) return "family_share";
    if (/공유|초대|파티/.test(joined)) return "group_invite";
    return null;
  }

  pricePattern(): RegExp {
    return PPOMPPU_PRICE_PATTERN;
  }

  durationPattern(): RegExp {
    return PPOMPPU_DURATION_PATTERN;
  }
}
