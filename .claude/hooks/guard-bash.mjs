#!/usr/bin/env node
// PreToolUse hook for Bash. Turns the "escalate only at the irreversible
// boundary" rule from CLAUDE.md (Decision Authority) into a mechanical check.
//
// A block is exit code 2 with the reason on stderr; the agent sees the reason and
// takes the safe alternative itself. It must never turn into a question to the
// operator. Any parse problem fails open (exit 0): a broken guard must not stall work.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STAGE = 'Stage explicit paths you changed (git add <path> ...). The tree holds other sessions\' files.';

/** Drop heredoc bodies and quoted strings so prose in commit messages is not parsed as commands. */
function stripLiterals(cmd) {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function segments(cmd) {
  return stripLiterals(cmd)
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
}

/** Return { sub, args } for a git invocation, skipping env assignments and global options. */
function parseGit(tokens) {
  let i = 0;
  while (i < tokens.length && /^\w+=/.test(tokens[i])) i++;
  if (tokens[i] === 'sudo') i++;
  if (tokens[i] !== 'git') return null;
  i++;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
  }
  return tokens[i] ? { sub: tokens[i], args: tokens.slice(i + 1) } : null;
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Return a block reason, or null when the segment is fine. */
function check(tokens, cwd) {
  const git = parseGit(tokens);
  if (git) {
    const { sub, args } = git;
    const has = (re) => args.some((a) => re.test(a));

    if (sub === 'add' && has(/^(\.|\*|:\/|--all|--update|-[a-zA-Z]*[Au][a-zA-Z]*)$/)) {
      return `Blanket staging blocked. ${STAGE}`;
    }
    if (sub === 'commit') {
      if (has(/^(--all|-[a-zA-Z]*a[a-zA-Z]*)$/)) {
        return `commit -a blocked: it sweeps in unrelated modified files. ${STAGE}`;
      }
      if (has(/^(--no-verify|-n)$/)) {
        return 'commit --no-verify blocked: the pre-commit structure check is a gate. Fix what it reports.';
      }
      const branch = currentBranch(cwd);
      if (branch === 'main' || branch === 'master') {
        return `Commit on ${branch} blocked. Create a branch (git switch -c <name>), then commit there.`;
      }
    }
    if (sub === 'push' && (has(/^(--force|--force-with-lease(=.*)?|--mirror|--delete|-f)$/) || has(/^\+/))) {
      return 'Force/destructive push blocked. Push normally; if history diverged, rebase or merge instead of overwriting remote.';
    }
    if (sub === 'reset' && has(/^--hard$/)) {
      return 'reset --hard blocked: it discards uncommitted work, including files you did not create. Use git restore <path> on your own files.';
    }
    if (sub === 'clean' && has(/^-[a-zA-Z]*f[a-zA-Z]*$|^--force$/)) {
      return 'git clean -f blocked: it deletes untracked files you may not have created. Remove specific paths instead.';
    }
    if ((sub === 'checkout' && has(/^\.$/)) || (sub === 'restore' && has(/^\.$/))) {
      return 'Whole-tree checkout/restore blocked: it discards uncommitted work. Name the files you changed.';
    }
    if (sub === 'branch' && has(/^-D$/)) {
      return 'branch -D blocked: use -d, which refuses unmerged work.';
    }
    return null;
  }

  // rm -r on the artifacts tree: the competitor-intel database lives there. GC is scoped to artifacts/publisher-runs/.
  const rm = tokens.findIndex((t) => t === 'rm');
  if (rm !== -1) {
    const rest = tokens.slice(rm + 1);
    const recursive = rest.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$|^--recursive$/.test(t));
    const hitsArtifacts = rest.some((t) => /^(\.\/)?artifacts\/?(\*|competitor[^/]*.*)?$/.test(t));
    if (recursive && hitsArtifacts) {
      return 'rm -r on artifacts/ blocked: it holds the competitor-intel database. Use `npm run clean:all -- --dry-run`, or delete under artifacts/publisher-runs/ only.';
    }
  }
  return null;
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== 'string') process.exit(0);
  const cwd = input.cwd || process.cwd();
  for (const tokens of segments(cmd)) {
    const reason = check(tokens, cwd);
    if (reason) {
      process.stderr.write(`guard-bash: ${reason} Do the safe alternative now; do not ask the user.\n`);
      process.exit(2);
    }
  }
} catch {
  // fail open
}
process.exit(0);
