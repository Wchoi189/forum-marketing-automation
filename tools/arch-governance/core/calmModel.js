'use strict';

const fs = require('fs');

const RULE = 'MODEL-METADATA';

// Reads a CALM architecture into the shape guardrails range over. Only `connects` relationships are
// edges; `interacts`, `deployed-in` and `composed-of` describe people and placement, not traffic.
// Integrity (data-model §5.3–4) is returned as `violations`, never thrown: every stage reports.
function loadModel(architecturePath) {
  const doc = JSON.parse(fs.readFileSync(architecturePath, 'utf8'));
  const nodes = new Map();
  const edges = [];
  const violations = [];

  for (const node of Array.isArray(doc.nodes) ? doc.nodes : []) {
    const id = node['unique-id'];
    const type = node['node-type'];
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    const zone = typeof metadata.zone === 'string' && metadata.zone !== '' ? metadata.zone : null;
    const hosts = Array.isArray(metadata.hosts) ? metadata.hosts : [];

    if (type !== 'actor' && zone === null) {
      violations.push({ rule: RULE, subject: `node ${id} has no metadata.zone`, location: `/nodes/${id}/metadata/zone` });
    }
    if (zone === 'external') {
      if (hosts.length === 0) {
        violations.push({ rule: RULE, subject: `external node ${id} has no metadata.hosts`, location: `/nodes/${id}/metadata/hosts` });
      }
      for (const host of hosts) {
        if (typeof host !== 'string' || host === '' || host !== host.toLowerCase()) {
          violations.push({
            rule: RULE,
            subject: `external node ${id} host ${JSON.stringify(host)} must be a non-empty lower-case string`,
            location: `/nodes/${id}/metadata/hosts`,
          });
        }
      }
    }
    nodes.set(id, { type, zone, hosts: hosts.filter((h) => typeof h === 'string') });
  }

  for (const relationship of Array.isArray(doc.relationships) ? doc.relationships : []) {
    const connects = relationship['relationship-type'] && relationship['relationship-type'].connects;
    if (!connects) continue;
    edges.push({
      id: relationship['unique-id'],
      source: connects.source && connects.source.node,
      destination: connects.destination && connects.destination.node,
      protocol: relationship.protocol ?? null,
    });
  }

  return { nodes, edges, violations };
}

module.exports = { loadModel };
