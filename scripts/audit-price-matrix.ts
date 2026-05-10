/**
 * Analyze the quality issues in price-matrix.txt
 */

import * as fs from "node:fs";

const lines = fs.readFileSync("artifacts/competitor-ads/ui-data-sample/price-matrix.txt", "utf-8").split("\n");

console.log("=== Price Matrix Quality Audit ===");
console.log(`Total lines: ${lines.length}`);
console.log(`Header: ${lines[0]}`);
console.log(`Column header: ${lines[1]}`);
console.log("");

// Parse entries
const entries = lines.slice(2).map((line) => {
  const parts = line.split("\t");
  return {
    product: parts[0] || "",
    vendor: parts[1] || "",
    totalPrice: parts[2] || "",
    perMonth: parts[3] || "",
    duration: parts[4] || "",
    tier: parts[5] || "",
    posted: parts[6] || "",
  };
});

// Quality checks
const emptyProducts = entries.filter((e) => !e.product || e.product === "-").length;
const shortProducts = entries.filter((e) => e.product.length <= 3).length;
const longProducts = entries.filter((e) => e.product.length > 50).length;
const emptyPrices = entries.filter((e) => !e.totalPrice || e.totalPrice === "—").length;
const emptyDurations = entries.filter((e) => !e.duration || e.duration === "—").length;

console.log(`Total entries: ${entries.length}`);
console.log(`Empty product names: ${emptyProducts}`);
console.log(`Very short product names (<=3 chars): ${shortProducts}`);
console.log(`Very long product names (>50 chars): ${longProducts}`);
console.log(`Missing prices: ${emptyPrices}`);
console.log(`Missing durations: ${emptyDurations}`);
console.log("");

// Show the worst offenders
console.log("=== Worst product names (long sentences) ===");
const longEntries = entries.filter((e) => e.product.length > 40);
for (const e of longEntries.slice(0, 5)) {
  console.log(`  [${e.product.slice(0, 80)}...]`);
  console.log(`    Price: ${e.totalPrice}, Duration: ${e.duration}`);
}

console.log("");
console.log("=== Junk product names (<= 3 chars) ===");
const junkEntries = entries.filter((e) => e.product.length <= 3 && e.product.length > 0);
const uniqueJunk = [...new Set(junkEntries.map((e) => e.product))];
for (const name of uniqueJunk) {
  const count = junkEntries.filter((e) => e.product === name).length;
  console.log(`  "${name}" — ${count} entries`);
}

console.log("");
console.log("=== Missing price/duration entries ===");
const broken = entries.filter((e) => (!e.totalPrice || e.totalPrice === "—") && (!e.duration || e.duration === "—"));
console.log(`Both missing: ${broken.length} entries`);

const priceOnly = entries.filter((e) => e.totalPrice && e.totalPrice !== "—" && (!e.duration || e.duration === "—"));
console.log(`Price only (no duration): ${priceOnly.length} entries`);

const durOnly = entries.filter((e) => (!e.totalPrice || e.totalPrice === "—") && e.duration && e.duration !== "—");
console.log(`Duration only (no price): ${durOnly.length} entries`);

console.log("");
console.log("=== Clean entries (product name < 30 chars, has price, has duration) ===");
const clean = entries.filter((e) =>
  e.product.length > 0 && e.product.length <= 30 &&
  e.totalPrice && e.totalPrice !== "—" &&
  e.duration && e.duration !== "—"
);
console.log(`Clean: ${clean.length} / ${entries.length} (${((clean.length / entries.length) * 100).toFixed(1)}%)`);

console.log("");
console.log("=== Sample clean entries ===");
for (const e of clean.slice(0, 10)) {
  console.log(`  ${e.product} | ${e.vendor} | ${e.totalPrice} | ${e.perMonth} | ${e.duration} | ${e.tier}`);
}
