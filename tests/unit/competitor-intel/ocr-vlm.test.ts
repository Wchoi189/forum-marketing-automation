import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "../../../lib/competitor-intel/extraction/vlm.js";
import { estimateOcrConfidence, callOllamaGenerate } from "../../../lib/competitor-intel/extraction/ocr.js";

// ---------------------------------------------------------------------------
// extractJsonObject — pure function
// ---------------------------------------------------------------------------

test("extractJsonObject: parses clean JSON", () => {
  const raw = '{"name":"Netflix","price":15000}';
  const result = extractJsonObject(raw);
  assert.deepEqual(result, { name: "Netflix", price: 15000 });
});

test("extractJsonObject: extracts JSON from markdown wrapper", () => {
  const raw = '```json\n{"products":[]}\n```';
  const result = extractJsonObject(raw);
  assert.deepEqual(result, { products: [] });
});

test("extractJsonObject: extracts JSON with surrounding text", () => {
  const raw = "Here is the result:\n{\"name\":\"test\"}\nHope this helps!";
  const result = extractJsonObject(raw);
  assert.deepEqual(result, { name: "test" });
});

test("extractJsonObject: returns null for empty string", () => {
  assert.equal(extractJsonObject(""), null);
});

test("extractJsonObject: returns null for whitespace only", () => {
  assert.equal(extractJsonObject("   \n  "), null);
});

test("extractJsonObject: returns null for non-JSON text", () => {
  assert.equal(extractJsonObject("This is just plain text with no JSON"), null);
});

test("extractJsonObject: returns null for malformed JSON in braces", () => {
  const raw = '{name: "Netflix", price:}';
  assert.equal(extractJsonObject(raw), null);
});

test("extractJsonObject: handles nested objects", () => {
  const raw = JSON.stringify({
    products: [{ name: "Netflix", price_krw: 15000, details: { tier: "Premium" } }],
    total: 1,
  });
  const result = extractJsonObject(raw);
  assert.ok(result !== null);
  const obj = result as Record<string, unknown>;
  assert.equal((obj as any).total, 1);
  assert.ok(Array.isArray((obj as any).products));
});

test("extractJsonObject: finds first { and last } correctly", () => {
  // Multiple JSON-like objects — should grab the outermost span
  const raw = '{"a":1} and {"b":2}';
  const result = extractJsonObject(raw);
  // It takes from first { to last }, which is invalid JSON — should be null
  // Actually the string is '{"a":1} and {"b":2}' — indexOf("{")=0, lastIndexOf("}")=18
  // slice is '{"a":1} and {"b":2}' which is invalid → null
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// estimateOcrConfidence — pure function
// ---------------------------------------------------------------------------

test("estimateOcrConfidence: empty text → 0.4", () => {
  assert.equal(estimateOcrConfidence(""), 0.4);
  assert.equal(estimateOcrConfidence("   "), 0.4);
});

test("estimateOcrConfidence: text with Korean price → 0.9", () => {
  assert.equal(estimateOcrConfidence("15,000원 3개월"), 0.9);
  assert.equal(estimateOcrConfidence("가격은 8000원입니다"), 0.9);
});

test("estimateOcrConfidence: long text without price → 0.8", () => {
  const long = "이".repeat(50);
  assert.equal(estimateOcrConfidence(long), 0.8);
});

test("estimateOcrConfidence: short text without price → 0.7", () => {
  assert.equal(estimateOcrConfidence("짧은 텍스트"), 0.7);
});

// ---------------------------------------------------------------------------
// callOllamaGenerate — live Ollama integration
// ---------------------------------------------------------------------------

test("callOllamaGenerate: text-only call to qwen3:1.7b succeeds", async () => {
  const result = await callOllamaGenerate(
    "Reply with exactly: hello",
    undefined,
    "qwen3:1.7b",
  );

  assert.ok(result.text.length > 0, "Expected non-empty response");
  assert.equal(result.modelUsed, "qwen3:1.7b");
});

test("callOllamaGenerate: falls back to secondary model when primary missing", async () => {
  // Primary model doesn't exist, should fall back to the known available model
  const result = await callOllamaGenerate(
    "Reply with: hi",
    undefined,
    "nonexistent-model-that-does-not-exist",
    ["qwen3:1.7b"],
  );

  assert.ok(result.text.length > 0, "Expected fallback response");
  assert.equal(result.modelUsed, "qwen3:1.7b");
});
