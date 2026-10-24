'use strict';

const fs = require('fs');
const path = require('path');
const { EXIT } = require('./errors');
const { runCalm } = require('./calmRunner');
const { loadModel } = require('./calmModel');

// A stage is { stage, target, status, ok, kind, findings }. `kind` decides the exit code:
// a failed 'calm' stage exits 1, a failed 'guardrail' stage exits 2, and 1 wins over 2.

function calmFindings(result) {
  if (result.issues === null) {
    const line = result.stderr.split('\n').map((l) => l.trim()).find((l) => /error/i.test(l));
    return [{ rule: 'calm', subject: 'output was not a JSON report', location: line || `exit ${result.exitCode}` }];
  }
  const outputs = [
    ...(result.issues.jsonSchemaValidationOutputs || []),
    ...(result.issues.spectralSchemaValidationOutputs || []),
  ];
  return outputs.map((o) => ({
    rule: o.code || 'calm',
    subject: `${o.severity || 'error'}: ${o.message}`,
    location: `${o.path || ''}${o.line_start ? `:${o.line_start}` : ''}`,
  }));
}

function calmStage(stage, target, result) {
  const ok = result.exitCode === 0 && result.issues !== null;
  const warnings = ok && result.issues.hasWarnings;
  return {
    stage,
    target,
    ok,
    kind: 'calm',
    status: ok ? (warnings ? 'ok (warnings)' : 'ok') : 'FAIL',
    findings: ok && !warnings ? [] : calmFindings(result),
  };
}

function listPatterns(patternsDir) {
  return fs
    .readdirSync(patternsDir)
    .filter((name) => name.endsWith('.pattern.json'))
    .sort();
}

// CALM-native conformance (research R5, P1): `calm validate -p <pattern> -a <arch>` per pattern.
// Ajv reports a failed `contains` against every non-matching item, so the finding names the
// pattern and the issue count rather than echoing CALM's first message as a diagnosis.
function conformanceStage(architecture, patternsDir, patterns, strictArgs) {
  const findings = [];
  for (const name of patterns) {
    const result = runCalm(['validate', '-p', path.join(patternsDir, name), '-a', architecture, ...strictArgs]);
    if (result.exitCode === 0 && result.issues !== null) continue;
    const count = result.issues === null ? null : calmFindings(result).length;
    findings.push({
      rule: 'conformance',
      subject: `${path.basename(architecture)} does not conform to ${name}`,
      location: count === null ? calmFindings(result)[0].location : `${count} CALM issue(s)`,
    });
  }
  return {
    stage: 'conformance',
    target: `${patterns.length} pattern${patterns.length === 1 ? '' : 's'}`,
    ok: findings.length === 0,
    kind: 'calm',
    status: findings.length === 0 ? 'ok' : 'FAIL',
    findings,
  };
}

// Model integrity is a toolkit check (exit 2). An architecture that is not readable JSON is
// skipped here, because the CALM schema stage has already failed it with exit 1.
function modelStage(architecture) {
  let model;
  try {
    model = loadModel(architecture);
  } catch {
    const stage = { stage: 'MODEL-METADATA', target: 'zone and hosts', ok: true, kind: 'guardrail', findings: [] };
    return { model: null, stage: { ...stage, status: 'skipped (architecture is not readable JSON)' } };
  }
  const ok = model.violations.length === 0;
  return {
    model,
    stage: {
      stage: 'MODEL-METADATA',
      target: `zone and hosts (${model.nodes.size} nodes)`,
      ok,
      kind: 'guardrail',
      status: ok ? 'ok' : 'FAIL',
      findings: model.violations,
    },
  };
}

function sizeStage(architecture, budget, strict) {
  const bytes = fs.statSync(architecture).size;
  const over = budget !== null && bytes > budget;
  return {
    stage: 'size',
    target: path.basename(architecture),
    ok: !(over && strict),
    kind: 'guardrail',
    status: budget === null ? `${bytes} bytes` : `${bytes} / ${budget} bytes${over ? ' WARN over budget' : ''}`,
    findings: over
      ? [{ rule: 'size', subject: `${bytes} bytes exceeds sizeBudgetBytes ${budget}`, location: architecture }]
      : [],
  };
}

function exitCodeFor(stages) {
  if (stages.some((s) => !s.ok && s.kind === 'calm')) return EXIT.CALM;
  if (stages.some((s) => !s.ok && s.kind === 'guardrail')) return EXIT.GUARDRAIL;
  return EXIT.OK;
}

// Runs every stage and reports all of them; nothing stops at the first failure.
function runValidate({ config, architecture, patternsDir, strict, guardrails = () => [] }) {
  const strictArgs = strict ? ['--strict'] : [];
  const stages = [];

  stages.push(calmStage('calm schema', path.basename(architecture), runCalm(['validate', '-a', architecture, ...strictArgs])));

  const patterns = listPatterns(patternsDir);
  for (const name of patterns) {
    const result = runCalm(['validate', '-p', path.join(patternsDir, name), ...strictArgs]);
    stages.push(calmStage('calm pattern', name, result));
  }

  stages.push(conformanceStage(architecture, patternsDir, patterns, strictArgs));
  const { model, stage } = modelStage(architecture);
  stages.push(stage);
  if (model !== null) stages.push(...guardrails({ config, architecture, model, strict }));
  stages.push(sizeStage(architecture, config.sizeBudgetBytes, strict));

  return { command: 'validate', strict, architecture, patternsDir, exitCode: exitCodeFor(stages), stages };
}

function formatStages(stages) {
  const lines = [];
  for (const s of stages) {
    lines.push(`${s.stage.padEnd(17)}${s.target.padEnd(40)}${s.status}`);
    for (const f of s.findings) lines.push(`${f.rule} ${f.subject}  ${f.location}`);
  }
  return lines.join('\n');
}

module.exports = { runValidate, formatStages, exitCodeFor, calmStage };
