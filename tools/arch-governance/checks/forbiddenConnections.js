'use strict';

const RULE = 'ARCH-001';

// A rule side matches a node when every constraint it names (zone, node type) holds.
function sideMatches(node, zone, nodeType) {
  if (!node) return false;
  if (zone !== undefined && node.zone !== zone) return false;
  if (nodeType !== undefined && node.type !== nodeType) return false;
  return true;
}

// ARCH-001: no `connects` edge may join the node classes a forbiddenConnections entry names.
// Rules range over metadata.zone and node-type only, so the module holds no node id.
function checkForbiddenConnections(model, entries) {
  const findings = [];
  for (const entry of entries) {
    for (const edge of model.edges) {
      const source = model.nodes.get(edge.source);
      const destination = model.nodes.get(edge.destination);
      if (!sideMatches(source, entry.fromZone, entry.fromNodeType)) continue;
      if (!sideMatches(destination, entry.toZone, entry.toNodeType)) continue;
      findings.push({
        rule: RULE,
        subject: `${entry.id} ${edge.id}: ${entry.message}`,
        location: `${edge.source} -> ${edge.destination}`,
      });
    }
  }
  return { rule: RULE, target: 'forbidden connections', findings };
}

module.exports = { checkForbiddenConnections };
