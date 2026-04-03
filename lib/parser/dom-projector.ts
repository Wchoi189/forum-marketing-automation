import type { Page } from 'playwright';
import type { PageOutline, ProjectedNode, ProjectedSnapshot, ProjectionOptions, ProjectionStats } from './types.js';

const DEFAULT_OPTIONS: Required<Omit<ProjectionOptions, 'rootSelector'>> = {
  maxDepth: 5,
  maxSiblingsPerNode: 40,
  maxTotalNodes: 400,
  maxTextLengthPerNode: 160,
  interactiveOnly: false,
  includeHidden: false
};

type BrowserProjectionResult = {
  nodes: ProjectedNode[];
  stats: ProjectionStats;
  warnings: string[];
};

/**
 * In-browser projection. Must not use nested `function` declarations: TypeScript emits
 * `__name(...)` helpers that are undefined inside Playwright's `page.evaluate` VM.
 */
const browserProjectDom = (opts: Required<ProjectionOptions>): BrowserProjectionResult => {
  const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'option']);
  const hiddenTags = new Set(['script', 'style', 'noscript', 'template']);
  const attrWhitelist = new Set([
    'id',
    'data-testid',
    'name',
    'placeholder',
    'value',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-expanded',
    'aria-pressed',
    'aria-selected'
  ]);
  const warnings: string[] = [];
  const stats: ProjectionStats = {
    nodesScanned: 0,
    nodesEmitted: 0,
    truncatedDepth: false,
    truncatedNodes: false,
    truncatedSiblings: false
  };

  const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.body;
  if (!root) {
    return { nodes: [], stats, warnings: ['root_not_found'] };
  }

  const toText = (value: string | null | undefined): string => {
    if (!value) return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, opts.maxTextLengthPerNode);
  };

  const getRole = (el: Element): string | null => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && (el as HTMLAnchorElement).href) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type || 'text';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'form') return 'form';
    if (tag === 'main' || tag === 'nav' || tag === 'aside' || tag === 'header' || tag === 'footer') return 'landmark';
    return null;
  };

  const isVisible = (el: Element): boolean => {
    if (opts.includeHidden) return true;
    const htmlEl = el as HTMLElement;
    if (htmlEl.hidden) return false;
    const style = window.getComputedStyle(htmlEl);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = htmlEl.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const getName = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return toText(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const candidate = document.getElementById(labelledBy);
      if (candidate) return toText(candidate.textContent);
    }
    const htmlEl = el as HTMLElement;
    if (typeof htmlEl.innerText === 'string' && htmlEl.innerText.trim().length > 0) {
      return toText(htmlEl.innerText);
    }
    return toText(el.textContent);
  };

  const shouldKeep = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (hiddenTags.has(tag)) return false;
    if (!isVisible(el)) return false;
    if (!opts.interactiveOnly) return true;
    const role = getRole(el);
    return interactiveTags.has(tag) || Boolean(role && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(role));
  };

  const collectAttrs = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!attrWhitelist.has(name)) continue;
      out[name] = toText(attr.value);
    }
    return out;
  };

  const toPath = (pathParts: string[]): string => pathParts.join('>');

  const walk = (el: Element, depth: number, pathParts: string[]): ProjectedNode | null => {
    if (stats.nodesEmitted >= opts.maxTotalNodes) {
      stats.truncatedNodes = true;
      return null;
    }

    stats.nodesScanned += 1;
    const tag = el.tagName.toLowerCase();
    if (depth > opts.maxDepth) {
      stats.truncatedDepth = true;
      return null;
    }
    if (!shouldKeep(el)) {
      return null;
    }

    const role = getRole(el);
    const href = tag === 'a' ? (el as HTMLAnchorElement).href || null : null;
    const type = tag === 'input' ? (el as HTMLInputElement).type || null : null;
    const interactive = interactiveTags.has(tag) || Boolean(role && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(role));
    const node: ProjectedNode = {
      path: toPath(pathParts),
      tag,
      role,
      name: getName(el),
      text: toText(el.textContent),
      attrs: collectAttrs(el),
      visible: true,
      enabled: !(el as HTMLInputElement).disabled,
      href,
      type,
      interactive,
      children: []
    };
    stats.nodesEmitted += 1;

    const children = Array.from(el.children);
    const limitedChildren = children.slice(0, opts.maxSiblingsPerNode);
    if (children.length > limitedChildren.length) {
      stats.truncatedSiblings = true;
    }

    for (let i = 0; i < limitedChildren.length; i++) {
      const child = limitedChildren[i];
      const childTag = child.tagName.toLowerCase();
      const childNode = walk(child, depth + 1, [...pathParts, `${childTag}[${i}]`]);
      if (childNode) node.children.push(childNode);
    }
    return node;
  };

  const initialPath = [`${root.tagName.toLowerCase()}[0]`];
  const rootNode = walk(root, 0, initialPath);
  if (!rootNode) {
    warnings.push('empty_projection');
  }

  return {
    nodes: rootNode ? [rootNode] : [],
    stats,
    warnings
  };
};

function normalizeOptions(options?: ProjectionOptions): Required<ProjectionOptions> {
  return {
    rootSelector: options?.rootSelector,
    maxDepth: options?.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    maxSiblingsPerNode: options?.maxSiblingsPerNode ?? DEFAULT_OPTIONS.maxSiblingsPerNode,
    maxTotalNodes: options?.maxTotalNodes ?? DEFAULT_OPTIONS.maxTotalNodes,
    maxTextLengthPerNode: options?.maxTextLengthPerNode ?? DEFAULT_OPTIONS.maxTextLengthPerNode,
    interactiveOnly: options?.interactiveOnly ?? DEFAULT_OPTIONS.interactiveOnly,
    includeHidden: options?.includeHidden ?? DEFAULT_OPTIONS.includeHidden
  };
}

function computeConfidence(stats: ProjectionStats, warnings: string[]): number {
  let confidence = 1;
  if (stats.truncatedDepth) confidence -= 0.1;
  if (stats.truncatedSiblings) confidence -= 0.1;
  if (stats.truncatedNodes) confidence -= 0.2;
  confidence -= Math.min(warnings.length * 0.05, 0.2);
  return Math.max(0, Number(confidence.toFixed(2)));
}

export async function projectDom(page: Page, options?: ProjectionOptions): Promise<ProjectedSnapshot> {
  const normalized = normalizeOptions(options);
  const result = await page.evaluate<BrowserProjectionResult, Required<ProjectionOptions>>(browserProjectDom, normalized);

  const [url, title] = await Promise.all([page.url(), page.title().catch(() => 'N/A')]);
  const confidence = computeConfidence(result.stats, result.warnings);
  return {
    capturedAt: new Date().toISOString(),
    url,
    title,
    rootSelector: normalized.rootSelector ?? null,
    nodes: result.nodes,
    stats: result.stats,
    confidence,
    warnings: result.warnings
  };
}

function flattenNodes(nodes: ProjectedNode[]): ProjectedNode[] {
  const out: ProjectedNode[] = [];
  const visit = (node: ProjectedNode) => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

export async function pageOutline(page: Page, options?: ProjectionOptions): Promise<PageOutline> {
  const snapshot = await projectDom(page, {
    ...options,
    maxDepth: options?.maxDepth ?? 4,
    maxTotalNodes: options?.maxTotalNodes ?? 300
  });
  const flat = flattenNodes(snapshot.nodes);
  const landmarks = flat.filter((node) => node.role === 'landmark');
  const forms = flat.filter((node) => node.tag === 'form' || node.role === 'form');
  const headings = flat
    .filter((node) => /^h[1-6]$/.test(node.tag))
    .map((node) => ({ level: Number(node.tag.slice(1)), text: node.name || node.text, path: node.path }));
  const interactives = flat
    .filter((node) => node.interactive)
    .slice(0, 80)
    .map((node) => ({
      path: node.path,
      role: node.role,
      name: node.name,
      tag: node.tag,
      href: node.href,
      type: node.type
    }));

  return {
    url: snapshot.url,
    title: snapshot.title,
    landmarks,
    headings,
    forms,
    interactives,
    stats: snapshot.stats,
    confidence: snapshot.confidence,
    warnings: snapshot.warnings
  };
}

export async function subtree(page: Page, target: string, options?: ProjectionOptions): Promise<ProjectedSnapshot> {
  return projectDom(page, {
    ...options,
    rootSelector: target
  });
}

export async function interactiveElements(page: Page, options?: ProjectionOptions): Promise<ProjectedSnapshot> {
  return projectDom(page, {
    ...options,
    interactiveOnly: true,
    maxDepth: options?.maxDepth ?? 6,
    maxTotalNodes: options?.maxTotalNodes ?? 250
  });
}
