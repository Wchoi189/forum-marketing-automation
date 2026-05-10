import test from "node:test";
import assert from "node:assert/strict";
import { validateVlmAgainstHtml } from "../../../lib/competitor-intel/extraction/validation.js";
import type { AdProduct } from "../../../lib/competitor-intel/types.js";
import type { PpomppuParsedRecord } from "../../../lib/competitor-ad-parser/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHtmlRecord(products: Array<{ price_krw?: number; duration_months?: number }>): PpomppuParsedRecord {
  return {
    title: "Test Post",
    vendor: "test_vendor",
    posted_at: "2026-01-01T00:00:00.000Z",
    posted_at_raw: "2026-01-01 00:00",
    landing_url: null,
    products: products.map((p) => ({
      name: "HTML Product",
      ...p,
    })),
    trust_signals: [],
    account_type: null,
    image_urls: [],
    confidence: 0.5,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Price validation
// ---------------------------------------------------------------------------

test("validateVlmAgainstHtml: VLM price within 10% → no conflict", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix 3개월", price_krw: 30000, duration_months: 3 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 29000, duration_months: 3 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 0);
  assert.equal(validated[0].price_krw, 30000); // unchanged
});

test("validateVlmAgainstHtml: VLM price deviates >10% → corrected to closest", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix 3개월", price_krw: 50000, duration_months: 3 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000, duration_months: 3 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].includes("deviates"));
  assert.equal(validated[0].price_krw, 30000); // corrected
});

test("validateVlmAgainstHtml: VLM price undefined → no validation", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix", duration_months: 3 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 0);
  assert.equal(validated[0].price_krw, undefined);
});

test("validateVlmAgainstHtml: no HTML prices → no price conflict", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix", price_krw: 30000 }];
  const htmlRecord = makeHtmlRecord([{}]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 0);
});

// ---------------------------------------------------------------------------
// Duration validation
// ---------------------------------------------------------------------------

test("validateVlmAgainstHtml: VLM duration found in HTML → no conflict", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix", duration_months: 3 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000, duration_months: 3 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 0);
});

test("validateVlmAgainstHtml: VLM duration not in HTML → conflict logged", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix", duration_months: 6 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000, duration_months: 3 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].includes("duration 6 not found"));
});

test("validateVlmAgainstHtml: VLM duration undefined → no validation", () => {
  const vlmProducts: AdProduct[] = [{ name: "Netflix", price_krw: 30000 }];
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000, duration_months: 3 }]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(conflicts.length, 0);
});

// ---------------------------------------------------------------------------
// Multi-product
// ---------------------------------------------------------------------------

test("validateVlmAgainstHtml: multiple products validated independently", () => {
  const vlmProducts: AdProduct[] = [
    { name: "Netflix", price_krw: 30000, duration_months: 3 },
    { name: "YouTube", price_krw: 100000, duration_months: 3 }, // price too high
  ];
  const htmlRecord = makeHtmlRecord([
    { price_krw: 30000, duration_months: 3 },
    { price_krw: 55000, duration_months: 12 },
  ]);

  const { validated, conflicts } = validateVlmAgainstHtml(vlmProducts, htmlRecord);
  assert.equal(validated.length, 2);
  // Netflix price unchanged (within 10%)
  assert.equal(validated[0].price_krw, 30000);
  // YouTube price corrected to closest HTML price
  assert.equal(validated[1].price_krw, 55000);
  assert.equal(conflicts.length, 1);
});

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

test("validateVlmAgainstHtml: empty VLM products → empty output", () => {
  const htmlRecord = makeHtmlRecord([{ price_krw: 30000 }]);
  const { validated, conflicts } = validateVlmAgainstHtml([], htmlRecord);
  assert.deepEqual(validated, []);
  assert.deepEqual(conflicts, []);
});
