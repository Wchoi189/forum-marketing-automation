'use strict';

// Renders `calm diff -f json` as the markdown table in contracts/cli.md, for pasting into a plan.
// Pure: no I/O. CALM reports a renamed item separately; it is shown under Modified as `old` → `new`.

const EMPTY = '—';

function code(id) {
  return `\`${id}\``;
}

function cell(items) {
  return items.length === 0 ? EMPTY : items.join(', ');
}

function row(label, diff, prefix, { withType }) {
  const added = (diff[`${prefix}Added`] || []).map((item) =>
    withType && item['node-type'] ? `${code(item['unique-id'])} (${item['node-type']})` : code(item['unique-id']),
  );
  const removed = (diff[`${prefix}Removed`] || []).map((item) => code(item['unique-id']));
  const modified = [
    ...(diff[`${prefix}Modified`] || []).map((item) => code((item.updated || item.original)['unique-id'])),
    ...(diff[`${prefix}Renamed`] || []).map((item) => `${code(item.oldId)} → ${code(item.newId)}`),
  ];
  return `| ${label} | ${cell(added)} | ${cell(removed)} | ${cell(modified)} |`;
}

function render(diffJson, basePath, candidatePath) {
  return [
    `### Architecture diff — ${basePath} → ${candidatePath}`,
    '',
    '| | Added | Removed | Modified |',
    '|---|---|---|---|',
    row('Nodes', diffJson, 'nodes', { withType: true }),
    row('Relationships', diffJson, 'edges', { withType: false }),
  ].join('\n');
}

module.exports = { render };
