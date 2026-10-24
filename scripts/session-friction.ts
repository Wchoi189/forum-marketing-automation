/**
 * Session friction report: how often did agent sessions interrupt the operator?
 *
 * Reads Claude Code transcripts for this project and counts, per session:
 *   - AskUserQuestion calls
 *   - turns that ended on a question (last line of the final message ends in "?")
 *   - hook blocks (guard-bash, no-closing-question)
 *   - median length of the closing message
 *
 * Use it to compare sessions before and after a change to the Decision Authority
 * rules in CLAUDE.md. Read-only.
 *
 *   npm run agent:friction
 *   npm run agent:friction -- --since 2026-10-25
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Block {
  type?: string;
  name?: string;
  text?: string;
  content?: string | Block[];
}
interface Entry {
  timestamp?: string;
  message?: { role?: string; content?: string | Block[] };
}

function transcriptDir(): string {
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

function sinceArg(): string {
  const i = process.argv.indexOf('--since');
  return i !== -1 ? (process.argv[i + 1] ?? '') : '';
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const HOOK_BLOCK = /^\s*(guard-bash:|Stop hook feedback)/s;

function flatten(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return content;
  return (content ?? []).map((b) => b.text ?? '').join('\n');
}

function analyze(file: string) {
  const raw = fs.readFileSync(file, 'utf8');
  let first = '';
  let asks = 0;
  let hookBlocks = 0;
  const closings: string[] = [];
  let pendingText = '';

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: Entry;
    try {
      entry = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (!first && entry.timestamp) first = entry.timestamp;
    const msg = entry.message;
    if (!msg) continue;
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        // A new operator prompt closes the previous turn.
        if (pendingText) closings.push(pendingText);
        pendingText = '';
      } else if (Array.isArray(msg.content)) {
        // Hook feedback comes back as a tool result; count those, not mentions in code the agent wrote.
        for (const b of msg.content) if (b.type === 'tool_result' && HOOK_BLOCK.test(flatten(b.content))) hookBlocks++;
      }
      continue;
    }
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === 'tool_use' && b.name === 'AskUserQuestion') asks++;
      if (b.type === 'text' && b.text?.trim()) pendingText = b.text.trim();
    }
  }
  if (pendingText) closings.push(pendingText);

  const questionClosings = closings.filter((t) => /[?？]\s*[*_`)"']*$/.test(t.split('\n').filter(Boolean).pop() ?? '')).length;
  return {
    id: path.basename(file, '.jsonl').slice(0, 8),
    date: first.slice(0, 10),
    turns: closings.length,
    asks,
    questionClosings,
    hookBlocks,
    closingChars: median(closings.map((t) => t.length)),
  };
}

const dir = transcriptDir();
if (!fs.existsSync(dir)) {
  console.log(`No transcripts at ${dir}`);
  process.exit(0);
}
const since = sinceArg();
const rows = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => analyze(path.join(dir, f)))
  .filter((r) => r.date && (!since || r.date >= since))
  .sort((a, b) => a.date.localeCompare(b.date));

console.log('session   date        turns  asks  q-closings  hook-blocks  median-closing-chars');
for (const r of rows) {
  console.log(
    `${r.id}  ${r.date}  ${String(r.turns).padStart(5)}  ${String(r.asks).padStart(4)}  ${String(r.questionClosings).padStart(10)}  ${String(r.hookBlocks).padStart(11)}  ${String(r.closingChars).padStart(20)}`,
  );
}
const sum = (k: 'turns' | 'asks' | 'questionClosings' | 'hookBlocks') => rows.reduce((n, r) => n + r[k], 0);
console.log(`total: ${rows.length} sessions, ${sum('turns')} turns, ${sum('asks')} AskUserQuestion, ${sum('questionClosings')} question closings, ${sum('hookBlocks')} hook blocks`);
