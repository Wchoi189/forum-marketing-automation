/**
 * Export Crawlee Dataset to gzip-compressed JSONL for backward compatibility.
 *
 * Crawlee stores results in its local Dataset (SQLite-based by default).
 * This iterates the dataset and writes a .jsonl.gz file matching the
 * pre-Crawlee output format.
 */

import fs from "node:fs";
import zlib from "node:zlib";
import { Dataset } from "crawlee";

export async function exportDatasetToJsonlGz(outputPath: string): Promise<{ count: number }> {
  const dataset = await Dataset.open();
  const result = await dataset.getData();
  const items = Array.isArray(result) ? result : result.items ?? [];

  if (items.length === 0) {
    // Write empty file
    fs.writeFileSync(outputPath, zlib.gzipSync(Buffer.from("")));
    return { count: 0 };
  }

  const gzip = zlib.createGzip();
  const outStream = fs.createWriteStream(outputPath, { flags: "w" });
  gzip.pipe(outStream);

  for (const item of items) {
    gzip.write(`${JSON.stringify(item)}\n`);
  }

  gzip.end();
  await new Promise<void>((resolve, reject) => {
    outStream.on("close", () => resolve());
    outStream.on("error", reject);
  });

  return { count: items.length };
}
