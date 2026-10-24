#!/usr/bin/env node
// Stop hook. If the turn's final message ends in a question, send the agent back
// once to decide and act instead (CLAUDE.md, Decision Authority). It fires at most
// once per turn: stop_hook_active is set on the retry, so a question at the real
// escalation boundary still gets through. Fails open on any parse problem.

import { readFileSync } from 'node:fs';

function lastAssistantText(input) {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  const path = input.transcript_path;
  if (!path) return '';
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = entry.message;
    if (msg?.role !== 'assistant') continue;
    const text = (msg.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text.trim()) return text;
  }
  return '';
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.stop_hook_active) process.exit(0);
  const text = lastAssistantText(input).trim();
  const lastLine = text.split('\n').filter((l) => l.trim()).pop() ?? '';
  if (/[?？]\s*[*_`)"']*$/.test(lastLine) && !lastLine.startsWith('```')) {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          'Your reply ends with a question. If project principles, git history or the KEDB settle it, decide, do it, and end with what changed and what is next. Ask only when the action is irreversibly destructive, an unrequested outward effect, or conflicts with an instruction given this session (CLAUDE.md, Decision Authority).',
      }),
    );
  }
} catch {
  // fail open
}
process.exit(0);
