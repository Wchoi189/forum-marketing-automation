/** Decode image dimensions from a JPEG or PNG buffer. */
export function getImageDimensions(buffer: Buffer): [number, number] | null {
  // PNG: first 8 bytes are signature, then IHDR chunk (4 len + 4 "IHDR" + W + H)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length >= 24) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      return [w, h];
    }
    return null;
  }

  // JPEG: scan for SOF marker (0xFFC0–0xFFCF), usually SOF0 at 0xFFC0
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    try {
      for (let i = 2; i < buffer.length - 9; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] >= 0xc0 && buffer[i + 1] <= 0xcf) {
          const h = buffer.readUInt16BE(i + 5);
          const w = buffer.readUInt16BE(i + 7);
          return [w, h];
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  return null;
}

/** Validate that an image buffer is safe to send to the VLM API. */
export function validateImageForVlm(
  buffer: Buffer,
  minDim: number = 16,
): { ok: true } | { ok: false; reason: string; w: number; h: number } {
  const dims = getImageDimensions(buffer);
  if (!dims) return { ok: false, reason: "unrecognised image format", w: 0, h: 0 };
  const [w, h] = dims;
  if (w < minDim || h < minDim) {
    return { ok: false, reason: `too small (${w}x${h}, minimum ${minDim}px)`, w, h };
  }
  return { ok: true };
}

/** Check if a JPEG buffer decodes to at least minWidth x minHeight. */
export function isImageLargeEnough(buffer: Buffer, minDim: number): boolean {
  if (buffer.length < 2048) return false;
  const dims = getImageDimensions(buffer);
  if (!dims) return buffer.length >= 8192;
  const [w, h] = dims;
  return w >= minDim && h >= minDim;
}
