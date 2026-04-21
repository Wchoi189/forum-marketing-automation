const PASS_1: Array<{ regex: RegExp; replacement: string }> = [
  // Phone must run before bank account — 010-XXXX-XXXX matches the bank regex too
  { regex: /01[016789]-?\d{3,4}-?\d{4}/g, replacement: "[PHONE]" },
  { regex: /\d{3,6}-\d{2,6}-\d{4,10}/g, replacement: "[ACCOUNT]" },
  { regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { regex: /\d{6}-[1-4]\d{6}/g, replacement: "[RRN]" },
];

const PASS_2: Array<{
  triggers: string[];
  regex: RegExp;
  replacement: string;
}> = [
  {
    triggers: ["계좌", "입금", "국민은행", "기업은행", "신한", "카카오뱅크"],
    regex: /\d[\d\s\-]{7,}\d/g,
    replacement: "[ACCOUNT]",
  },
  {
    triggers: ["전화", "연락처", "번호"],
    regex: /\d[\d.\s]{8,10}\d/g,
    replacement: "[PHONE]",
  },
];

export function scrubContext(text: string): string {
  let result = text;
  for (const { regex, replacement } of PASS_1) {
    result = result.replace(regex, replacement);
  }
  for (const { triggers, regex, replacement } of PASS_2) {
    if (triggers.some((t) => result.includes(t))) {
      result = result.replace(regex, replacement);
    }
  }
  return result;
}
