import test from "node:test";
import assert from "node:assert/strict";
import { getImageDimensions, validateImageForVlm, isImageLargeEnough } from "../../../lib/competitor-intel/extraction/image-utils.js";

// ---------------------------------------------------------------------------
// Helpers — minimal valid JPEG and PNG buffers
// ---------------------------------------------------------------------------

/** Build a minimal JPEG buffer (100x50, SOF0 marker). */
function makeFakeJpeg(w: number, h: number): Buffer {
  const buf = Buffer.alloc(20);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf[4] = 0x00; buf[5] = 0x0b; // segment length
  buf[6] = 0x08; // precision
  buf[7] = (h >> 8) & 0xff;
  buf[8] = h & 0xff;
  buf[9] = (w >> 8) & 0xff;
  buf[10] = w & 0xff;
  buf[11] = 0x03; // components
  buf[12] = 0x01; buf[13] = 0x11; buf[14] = 0x00;
  buf[15] = 0x02; buf[16] = 0x11; buf[17] = 0x01;
  buf[18] = 0x03; buf[19] = 0x11; buf[20] = 0x01;
  return buf;
}

/** Build a minimal PNG buffer (IHDR with given WxH). */
function makeFakePng(w: number, h: number): Buffer {
  // PNG sig (8 bytes) + IHDR chunk length (4) + "IHDR" (4) + width(4) + height(4) + rest(13) = 33
  const buf = Buffer.alloc(33);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk
  buf[8] = 0x00; buf[9] = 0x00; buf[10] = 0x00; buf[11] = 0x0d; // length = 13
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52; // "IHDR"
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// ---------------------------------------------------------------------------
// getImageDimensions — JPEG
// ---------------------------------------------------------------------------

test("getImageDimensions: parses JPEG 100x50", () => {
  const buf = makeFakeJpeg(100, 50);
  const dims = getImageDimensions(buf);
  assert.ok(dims !== null);
  assert.deepEqual(dims, [100, 50]);
});

test("getImageDimensions: parses JPEG 1x1", () => {
  const buf = makeFakeJpeg(1, 1);
  const dims = getImageDimensions(buf);
  assert.ok(dims !== null);
  assert.deepEqual(dims, [1, 1]);
});

// ---------------------------------------------------------------------------
// getImageDimensions — PNG
// ---------------------------------------------------------------------------

test("getImageDimensions: parses PNG 200x150", () => {
  const buf = makeFakePng(200, 150);
  const dims = getImageDimensions(buf);
  assert.ok(dims !== null);
  assert.deepEqual(dims, [200, 150]);
});

test("getImageDimensions: PNG too short (<24 bytes) → null", () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(getImageDimensions(buf), null);
});

// ---------------------------------------------------------------------------
// getImageDimensions — unknown format
// ---------------------------------------------------------------------------

test("getImageDimensions: unknown magic bytes → null", () => {
  const buf = Buffer.from("hello world");
  assert.equal(getImageDimensions(buf), null);
});

test("getImageDimensions: GIF magic bytes → null (not supported)", () => {
  const buf = Buffer.from("GIF89a");
  assert.equal(getImageDimensions(buf), null);
});

// ---------------------------------------------------------------------------
// validateImageForVlm
// ---------------------------------------------------------------------------

test("validateImageForVlm: valid JPEG 100x50 → ok", () => {
  const buf = makeFakeJpeg(100, 50);
  const result = validateImageForVlm(buf, 16);
  assert.equal(result.ok, true);
});

test("validateImageForVlm: image too small (10x10, minDim=16) → reject", () => {
  const buf = makeFakeJpeg(10, 10);
  const result = validateImageForVlm(buf, 16);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.reason.includes("too small"));
    assert.equal(result.w, 10);
    assert.equal(result.h, 10);
  }
});

test("validateImageForVlm: unrecognised format → reject", () => {
  const buf = Buffer.from("not an image");
  const result = validateImageForVlm(buf, 16);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.reason.includes("unrecognised"));
  }
});

test("validateImageForVlm: default minDim is 16", () => {
  const buf = makeFakeJpeg(20, 20);
  assert.equal(validateImageForVlm(buf).ok, true);
});

// ---------------------------------------------------------------------------
// isImageLargeEnough
// ---------------------------------------------------------------------------

test("isImageLargeEnough: large JPEG 200x100, minDim=100 → true", () => {
  const buf = makeFakeJpeg(200, 100);
  // Pad to exceed the 2048-byte fast-path threshold
  const padded = Buffer.concat([buf, Buffer.alloc(2048, 0)]);
  assert.equal(isImageLargeEnough(padded, 100), true);
});

test("isImageLargeEnough: small JPEG 50x50, minDim=100 → false", () => {
  const buf = makeFakeJpeg(50, 50);
  assert.equal(isImageLargeEnough(buf, 100), false);
});

test("isImageLargeEnough: tiny buffer (<2048 bytes) → false", () => {
  const buf = Buffer.alloc(100, 0xff);
  assert.equal(isImageLargeEnough(buf, 100), false);
});
