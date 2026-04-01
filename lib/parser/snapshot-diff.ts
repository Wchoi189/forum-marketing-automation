import type { NodeDelta, ProjectedNode, ProjectedSnapshot, SnapshotDiff } from './types.js';

function flatten(nodes: ProjectedNode[]): Map<string, ProjectedNode> {
  const out = new Map<string, ProjectedNode>();
  const visit = (node: ProjectedNode) => {
    out.set(node.path, node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

function shallowNode(node: ProjectedNode): Pick<ProjectedNode, 'text' | 'name' | 'interactive'> {
  return {
    text: node.text,
    name: node.name,
    interactive: node.interactive
  };
}

export function snapshotDiff(before: ProjectedSnapshot | null, after: ProjectedSnapshot): SnapshotDiff {
  if (!before) {
    const added = Array.from(flatten(after.nodes).entries()).map(
      ([path, node]): NodeDelta => ({ path, after: shallowNode(node) })
    );
    return {
      added,
      removed: [],
      changed: [],
      unchangedCount: 0
    };
  }

  const beforeMap = flatten(before.nodes);
  const afterMap = flatten(after.nodes);
  const added: NodeDelta[] = [];
  const removed: NodeDelta[] = [];
  const changed: NodeDelta[] = [];
  let unchangedCount = 0;

  for (const [path, afterNode] of afterMap.entries()) {
    const beforeNode = beforeMap.get(path);
    if (!beforeNode) {
      added.push({ path, after: shallowNode(afterNode) });
      continue;
    }
    if (
      beforeNode.text !== afterNode.text ||
      beforeNode.name !== afterNode.name ||
      beforeNode.interactive !== afterNode.interactive
    ) {
      changed.push({ path, before: shallowNode(beforeNode), after: shallowNode(afterNode) });
    } else {
      unchangedCount += 1;
    }
  }

  for (const [path, beforeNode] of beforeMap.entries()) {
    if (!afterMap.has(path)) {
      removed.push({ path, before: shallowNode(beforeNode) });
    }
  }

  return {
    added: added.slice(0, 120),
    removed: removed.slice(0, 120),
    changed: changed.slice(0, 120),
    unchangedCount
  };
}
