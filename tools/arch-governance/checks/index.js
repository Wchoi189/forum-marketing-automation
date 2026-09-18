'use strict';

const { checkForbiddenConnections } = require('./forbiddenConnections');
const { checkEgressOrigins } = require('./egressOrigins');
const { checkEgressCoverage } = require('./egressCoverage');

function toStage({ rule, target, findings }) {
  const ok = findings.length === 0;
  return { stage: rule, target, ok, kind: 'guardrail', status: ok ? 'ok' : 'FAIL', findings };
}

function notConfigured(rule, target) {
  return { stage: rule, target, ok: true, kind: 'guardrail', status: 'not configured', findings: [] };
}

// validate stage 4. Every check runs; findings aggregate; the caller decides the exit code.
function runGuardrails({ config, model }) {
  const { forbiddenConnections, egressOrigins, egressCoverage } = config.rules;
  return [
    toStage(checkForbiddenConnections(model, forbiddenConnections)),
    egressOrigins ? toStage(checkEgressOrigins(model, egressOrigins)) : notConfigured('ARCH-002', 'egress origins'),
    egressCoverage ? toStage(checkEgressCoverage(model, egressCoverage)) : notConfigured('ARCH-003', 'egress coverage'),
  ];
}

module.exports = { runGuardrails };
