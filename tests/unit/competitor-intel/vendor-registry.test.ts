import test from "node:test";
import assert from "node:assert/strict";
import { VendorRegistry } from "../../../lib/competitor-intel/vendor-registry.js";
import type { VendorStrategy, VendorSelectors, ParsedResult } from "../../../lib/competitor-intel/vendor-strategy.js";

// ---------------------------------------------------------------------------
// Helpers — fake strategy implementations
// ---------------------------------------------------------------------------

function makeStrategy(id: string, urlMatch: string): VendorStrategy {
  return {
    vendorId: id,
    contentSelectors(): VendorSelectors {
      return { contentBodySelectors: [`#${id}-content`] };
    },
    parse(): ParsedResult {
      return { products: [], posted_at: "", confidence: 0, warnings: [] };
    },
    isUserContentImage(src: string): boolean {
      return src.includes(urlMatch);
    },
    classifyAccountType(): string | null {
      return null;
    },
    pricePattern(): RegExp {
      return /\d+/;
    },
    durationPattern(): RegExp {
      return /\d+/;
    },
  };
}

// ---------------------------------------------------------------------------
// register / get
// ---------------------------------------------------------------------------

test("VendorRegistry: register and get by vendorId", () => {
  const registry = new VendorRegistry();
  const strategy = makeStrategy("ppomppu", "ppomppu");
  registry.register(strategy);
  assert.equal(registry.get("ppomppu"), strategy);
  assert.equal(registry.get("unknown"), undefined);
});

test("VendorRegistry: register multiple strategies", () => {
  const registry = new VendorRegistry();
  const s1 = makeStrategy("ppomppu", "ppomppu");
  const s2 = makeStrategy("danawa", "danawa");
  registry.register(s1);
  registry.register(s2);
  assert.equal(registry.get("ppomppu"), s1);
  assert.equal(registry.get("danawa"), s2);
});

// ---------------------------------------------------------------------------
// resolveFromUrl
// ---------------------------------------------------------------------------

test("VendorRegistry: resolveFromUrl matches vendorId in URL", () => {
  const registry = new VendorRegistry();
  registry.register(makeStrategy("ppomppu", "ppomppu"));
  registry.register(makeStrategy("danawa", "danawa"));

  const resolved = registry.resolveFromUrl("https://ppomppu.co.kr/bbs/board.php?bo_table=share");
  assert.ok(resolved !== undefined);
  assert.equal(resolved.vendorId, "ppomppu");
});

test("VendorRegistry: resolveFromUrl returns undefined for unknown URL", () => {
  const registry = new VendorRegistry();
  registry.register(makeStrategy("ppomppu", "ppomppu"));

  const resolved = registry.resolveFromUrl("https://example.com/something");
  assert.equal(resolved, undefined);
});

test("VendorRegistry: resolveFromUrl is case-insensitive", () => {
  const registry = new VendorRegistry();
  registry.register(makeStrategy("ppomppu", "ppomppu"));

  const resolved = registry.resolveFromUrl("https://PPOMPPU.CO.KR/test");
  assert.ok(resolved !== undefined);
  assert.equal(resolved.vendorId, "ppomppu");
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

test("VendorRegistry: list returns all registered strategies", () => {
  const registry = new VendorRegistry();
  const s1 = makeStrategy("ppomppu", "ppomppu");
  const s2 = makeStrategy("danawa", "danawa");
  registry.register(s1);
  registry.register(s2);

  const all = registry.list();
  assert.equal(all.length, 2);
  assert.ok(all.some((s) => s.vendorId === "ppomppu"));
  assert.ok(all.some((s) => s.vendorId === "danawa"));
});

test("VendorRegistry: list on empty registry → empty array", () => {
  const registry = new VendorRegistry();
  assert.deepEqual(registry.list(), []);
});
