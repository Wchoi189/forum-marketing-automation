'use strict';

// `apply`: every output — parts, shared part, facade, receipt, baseline — is computed before the first write, so a
// failure leaves no partial output; on a write error every file already written is restored from its in-memory
// original. Never stages, never commits.

const fs = require('node:fs');
const path = require('node:path');
const { usageError } = require('./errors');
const { buildReceipt, serializeReceipt } = require('./receipt');
const { serialize } = require('./baseline');
const { BASELINE_SCHEMA } = require('./config');
const { TOOLKIT_DIR } = require('./deps');

function toolkitVersion() {
    return JSON.parse(fs.readFileSync(path.join(TOOLKIT_DIR, 'package.json'), 'utf8')).version;
}

// Returns the list of repo-relative paths written.
function applyPlan({ root, config, baseline, recipe, plan, now = new Date() }) {
    const outputs = new Map(plan.files);
    const receipt = buildReceipt({ root, recipe, plan, toolkitVersion: toolkitVersion(), now });
    outputs.set(plan.receiptPath, serializeReceipt(receipt));
    const effect = plan.ratchetEffect;
    if (effect && effect.inScope && (baseline.exists || effect.added.length > 0)) {
        outputs.set(config.baseline, serialize({ $schema: BASELINE_SCHEMA, limits: baseline.limits || config.limits, files: effect.files }));
    }

    const originals = new Map(); // full path -> Buffer | null (did not exist)
    const written = [];
    try {
        for (const [relPath, content] of outputs) {
            const full = path.resolve(root, relPath);
            originals.set(full, fs.existsSync(full) ? fs.readFileSync(full) : null);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content);
            written.push(relPath);
        }
    } catch (error) {
        for (const [full, original] of originals) {
            try {
                if (original === null) fs.rmSync(full, { force: true });
                else fs.writeFileSync(full, original);
            } catch {
                // best effort: the first error is the one reported
            }
        }
        throw usageError(`apply: write failed (${error.message}); every file written so far was restored`);
    }
    return { written, receipt };
}

module.exports = { applyPlan, toolkitVersion };
