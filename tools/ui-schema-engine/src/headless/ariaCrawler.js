'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { ToolkitError } = require('../errors');
const { serializeToYaml } = require('../schemaSerializer');

// The domExtractor source is read from disk and injected into the browser context.
// This avoids bundling issues — Playwright's page.evaluate() runs plain JS in the browser.
const EXTRACTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '../domExtractor.js'),
  'utf-8'
);

// Strip the module.exports line so it runs as plain browser JS
const BROWSER_EXTRACTOR = EXTRACTOR_SOURCE
  .replace(/^'use strict';\n/, '')
  .replace(/\nmodule\.exports\s*=\s*\{[^}]*\};?\s*$/, '');

/**
 * Slugify a URL route into a safe filename component.
 * e.g. "/refunds/new" → "refunds_new"
 * @param {string} route
 * @returns {string}
 */
function routeToSlug(route) {
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';
}

/**
 * Extract the visible view name from the schema (title → slug).
 * @param {object} schema
 * @param {string} fallback
 * @returns {string}
 */
function schemaToFilename(schema, fallback) {
  const title = schema && schema.title;
  if (title) {
    return title.replace(/[^a-zA-Z0-9]+/g, '') || fallback;
  }
  return fallback;
}

/**
 * `ui-schema extract` command implementation.
 *
 * @param {{ url: string, routes: string, out: string, selector?: string, auth?: string }} opts
 */
async function runExtract(opts) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new ToolkitError(
      "Playwright is not installed. Run: npm install playwright\n" +
      "Or use the root installation: node -e \"require('playwright')\"",
      3
    );
  }

  const baseUrl  = opts.url.replace(/\/$/, '');
  const routes   = opts.routes.split(',').map(r => r.trim());
  const outDir   = path.resolve(opts.out);
  const selector = opts.selector || null;
  const authFile = opts.auth ? path.resolve(opts.auth) : null;

  fs.mkdirSync(outDir, { recursive: true });

  const storageState = authFile && fs.existsSync(authFile) ? authFile : undefined;

  const browser = await chromium.launch({ headless: true });

  let exitCode = 0;
  const results = [];

  try {
    for (const route of routes) {
      const url   = `${baseUrl}${route}`;
      const slug  = routeToSlug(route);

      const context = await browser.newContext({ storageState });
      const page    = await context.newPage();

      process.stderr.write(`[ui-schema extract] → ${url}\n`);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

        if (selector) {
          await page.waitForSelector(selector, { timeout: 10_000 });
        }

        // Inject extractor and run in browser context
        const schema = await page.evaluate((extractorSrc) => {
          // eslint-disable-next-line no-new-func
          const mod = new Function(extractorSrc + '\nreturn { extractSemanticUiSchema };')();
          return mod.extractSemanticUiSchema(null, {}, document);
        }, BROWSER_EXTRACTOR);

        const filename = `${schemaToFilename(schema, slug)}.ui-schema.yaml`;
        const outPath  = path.join(outDir, filename);
        const yaml     = serializeToYaml(schema);

        fs.writeFileSync(outPath, yaml, 'utf-8');

        const tokens = Math.ceil(yaml.length / 3.8);
        results.push({ route, filename, fields: schema.fields.length, tokens });
        process.stderr.write(`  ✓ ${filename} (${schema.fields.length} fields, ~${tokens} tokens)\n`);
      } catch (err) {
        process.stderr.write(`  ✗ ${route}: ${err.message}\n`);
        exitCode = 1;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  if (results.length > 0) {
    process.stderr.write(`\n[ui-schema extract] wrote ${results.length} contract(s) to ${outDir}\n`);
  }

  if (exitCode !== 0) {
    throw new ToolkitError('Some routes failed to extract — see errors above.', exitCode);
  }
}

module.exports = { runExtract };
