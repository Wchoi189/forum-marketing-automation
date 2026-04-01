export type ProjectedNode = {
  path: string;
  tag: string;
  role: string | null;
  name: string;
  text: string;
  attrs: Record<string, string>;
  visible: boolean;
  enabled: boolean;
  href: string | null;
  type: string | null;
  interactive: boolean;
  children: ProjectedNode[];
};

export type ProjectionStats = {
  nodesScanned: number;
  nodesEmitted: number;
  truncatedDepth: boolean;
  truncatedNodes: boolean;
  truncatedSiblings: boolean;
};

export type ProjectionOptions = {
  rootSelector?: string;
  maxDepth?: number;
  maxSiblingsPerNode?: number;
  maxTotalNodes?: number;
  maxTextLengthPerNode?: number;
  interactiveOnly?: boolean;
  includeHidden?: boolean;
};

export type ProjectedSnapshot = {
  capturedAt: string;
  url: string;
  title: string;
  rootSelector: string | null;
  nodes: ProjectedNode[];
  stats: ProjectionStats;
  confidence: number;
  warnings: string[];
};

export type PageOutline = {
  url: string;
  title: string;
  landmarks: ProjectedNode[];
  headings: Array<{ level: number; text: string; path: string }>;
  forms: ProjectedNode[];
  interactives: Array<{
    path: string;
    role: string | null;
    name: string;
    tag: string;
    href: string | null;
    type: string | null;
  }>;
  stats: ProjectionStats;
  confidence: number;
  warnings: string[];
};

export type NodeDelta = {
  path: string;
  before?: Pick<ProjectedNode, 'text' | 'name' | 'interactive'>;
  after?: Pick<ProjectedNode, 'text' | 'name' | 'interactive'>;
};

export type SnapshotDiff = {
  added: NodeDelta[];
  removed: NodeDelta[];
  changed: NodeDelta[];
  unchangedCount: number;
};
