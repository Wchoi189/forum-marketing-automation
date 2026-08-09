/**
 * Structure policy validator.
 *
 * Reads .structure.json and checks the git-tracked tree against it:
 *   1. root allowlist        - anything at the repo root must be declared
 *   2. placement rules       - file patterns denied at the root or anywhere
 *   3. module entry points   - no reaching into a module's internals from outside
 *   4. size budgets          - files over the line budget need an exemption entry
 *
 * Only tracked files are inspected, so generated directories (artifacts/, dist/,
 * node_modules/) are out of scope by construction.
 *
 * Run: npm run lint:structure
 * Rationale: .planning/audit/structure-roadmap-2026-08-08.md Part 3.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, '.structure.json');

interface PlacementRule {
  pattern: string;
  deny_at_root?: boolean;
  deny_anywhere?: boolean;
  except?: string[];
  goes_to?: string;
  reason?: string;
}

type Severity = 'error' | 'warn';

interface Manifest {
  enforcement: {
    root_allowlist: Severity;
    placement_rules: Severity;
    module_entry_points: Severity;
    module_boundary_baseline: number;
    size_budgets: Severity;
  };
  root: { allowed_files: string[]; allowed_dirs: string[] };
  placement_rules: PlacementRule[];
  module_entry_points: Record<string, string>;
  size_budgets: {
    default_max_lines: number;
    include: string[];
    extensions: string[];
    exemptions: Record<string, string>;
  };
}

const errors: string[] = [];
const warnings: string[] = [];

function report(severity: Severity, message: string): void {
  (severity === 'error' ? errors : warnings).push(message);
}

function trackedFiles(): string[] {
  // -z avoids git's quoting of non-ASCII paths (.planning holds Korean filenames).
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

/** Glob subset used by placement_rules: `*` matches within a single path segment. */
function matchesPattern(basename: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(basename);
}

function checkRootAllowlist(files: string[], manifest: Manifest): void {
  const severity = manifest.enforcement.root_allowlist;
  const allowedFiles = new Set(manifest.root.allowed_files);
  const allowedDirs = new Set(manifest.root.allowed_dirs);
  const seenDirs = new Set<string>();

  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash === -1) {
      if (!allowedFiles.has(file)) {
        report(
          severity,
          `${file} is at the repo root but not in .structure.json root.allowed_files.\n` +
            `    Move it into a subdirectory, or add it to the allowlist with a reason in the PR description.`,
        );
      }
      continue;
    }
    const dir = file.slice(0, slash);
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    if (!allowedDirs.has(dir)) {
      report(
        severity,
        `${dir}/ is a root directory but not in .structure.json root.allowed_dirs.\n` +
          `    Fold it into an existing directory, or add it to the allowlist with a reason.`,
      );
    }
  }
}

function checkPlacementRules(files: string[], manifest: Manifest): void {
  const severity = manifest.enforcement.placement_rules;

  for (const file of files) {
    const basename = path.basename(file);
    const atRoot = !file.includes('/');

    for (const rule of manifest.placement_rules) {
      if (!matchesPattern(basename, rule.pattern)) continue;
      if (rule.except?.includes(basename)) continue;

      if (rule.deny_anywhere) {
        report(severity, `${file} matches denied pattern "${rule.pattern}". ${rule.reason ?? ''}`.trimEnd());
      } else if (rule.deny_at_root && atRoot) {
        report(
          severity,
          `${file} matches "${rule.pattern}" and may not live at the repo root.\n` +
            `    Belongs in: ${rule.goes_to ?? 'a subdirectory'}.`,
        );
      }
    }
  }
}

/**
 * Resolve a relative import specifier to a repo-relative source path.
 * Handles the NodeNext convention used server-side, where `./x.js` means `./x.ts`.
 * Returns null when nothing on disk matches - unresolvable specifiers are tsc's
 * problem, not this check's.
 */
function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const base = path.join(path.dirname(fromFile), specifier);
  const withoutJs = base.replace(/\.js$/, '');
  const candidates = [
    base,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (fs.existsSync(path.join(PROJECT_ROOT, normalized)) && fs.statSync(path.join(PROJECT_ROOT, normalized)).isFile()) {
      return normalized.split(path.sep).join('/');
    }
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;

/**
 * Cross-module imports are the one check with a large pre-existing population, so
 * it runs as a ratchet: the current count is tolerated, one more than that fails.
 */
function checkModuleBoundaries(files: string[], manifest: Manifest): void {
  const { module_entry_points: severity, module_boundary_baseline: baseline } = manifest.enforcement;
  const modules = Object.entries(manifest.module_entry_points).filter(([key]) => !key.startsWith('$'));
  const sources = files.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith('archive/'));
  const violations: string[] = [];

  for (const file of sources) {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveRelativeImport(file, match[1]);
      if (!target) continue;

      for (const [moduleDir, entryPoint] of modules) {
        const prefix = `${moduleDir}/`;
        if (!target.startsWith(prefix)) continue; // import does not reach into this module
        if (file.startsWith(prefix)) continue; // internal import, always allowed
        if (target === entryPoint) continue; // through the front door

        violations.push(`${file} -> ${target} (module ${moduleDir}/, entry point ${entryPoint})`);
      }
    }
  }

  if (violations.length > baseline) {
    errors.push(
      `${violations.length} cross-module imports bypass a declared entry point, over the baseline of ${baseline}.\n` +
        `    New offenders must import through the module's index.ts, or re-export the symbol there.\n` +
        violations.map((v) => `      ${v}`).join('\n'),
    );
    return;
  }

  if (violations.length > 0) {
    report(
      severity,
      `${violations.length} cross-module imports bypass a declared entry point (baseline ${baseline}, not failing).\n` +
        `    Tracked as step 7 of .planning/audit/structure-roadmap-2026-08-08.md.` +
        (violations.length < baseline
          ? `\n    Count dropped below the baseline - lower module_boundary_baseline to ${violations.length} in .structure.json to hold the gain.`
          : ''),
    );
  }
}

function checkSizeBudgets(files: string[], manifest: Manifest): void {
  const severity = manifest.enforcement.size_budgets;
  const { default_max_lines, include, extensions, exemptions } = manifest.size_budgets;

  for (const file of files) {
    if (!include.some((dir) => file.startsWith(dir))) continue;
    if (!extensions.some((ext) => file.endsWith(ext))) continue;

    const text = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    // Match wc -l: a trailing newline terminates the last line, it does not start a new one.
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const exemption = exemptions[file];

    if (lines > default_max_lines && exemption === undefined) {
      report(
        severity,
        `${file} is ${lines} lines, over the ${default_max_lines}-line budget.\n` +
          `    Split it, or add an entry to size_budgets.exemptions in .structure.json saying why it stays.`,
      );
    }
  }

  // A stale exemption is a lie about the codebase - the same drift the budget exists to catch.
  for (const exempt of Object.keys(exemptions)) {
    if (!files.includes(exempt)) {
      report(
        severity,
        `.structure.json exempts ${exempt} from the size budget, but that file is not tracked. Remove the exemption.`,
      );
    }
  }
}

function main(): void {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const files = trackedFiles();

  checkRootAllowlist(files, manifest);
  checkPlacementRules(files, manifest);
  checkModuleBoundaries(files, manifest);
  checkSizeBudgets(files, manifest);

  for (const warning of warnings) console.warn(`  ! ${warning}\n`);

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} structure violation(s):\n`);
    for (const error of errors) console.error(`  ✗ ${error}\n`);
    console.error('Policy lives in .structure.json. Rationale: .planning/audit/structure-roadmap-2026-08-08.md');
    process.exit(1);
  }

  console.log(`✓ structure OK (${files.length} tracked files, ${warnings.length} warning(s))`);
}

main();
