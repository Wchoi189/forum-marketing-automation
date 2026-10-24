'use strict';

const RULE = 'ARCH-002';

// ARCH-002: an edge INTO `toZone` must start in one of `allowedFromZones`. Edges out of that zone
// (a webhook calling back in) are not egress and are left alone.
function checkEgressOrigins(model, { toZone, allowedFromZones }) {
  const allowed = new Set(allowedFromZones);
  const findings = [];
  for (const edge of model.edges) {
    const destination = model.nodes.get(edge.destination);
    if (!destination || destination.zone !== toZone) continue;
    const source = model.nodes.get(edge.source);
    if (!source) continue; // a dangling endpoint is CALM's finding, not this rule's
    if (allowed.has(source.zone)) continue;
    findings.push({
      rule: RULE,
      subject: `${edge.id} reaches zone ${toZone} from zone ${source.zone ?? '(none)'}`,
      location: `${edge.source} -> ${edge.destination}`,
    });
  }
  return { rule: RULE, target: 'egress origins', findings };
}

module.exports = { checkEgressOrigins };
