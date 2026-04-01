import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { z } from 'zod/v4';
import {
  interactiveElements,
  pageOutline,
  snapshotDiff,
  subtree,
  type ProjectedSnapshot,
  type ProjectionOptions
} from '../lib/parser/index.js';
import { ParserSessionManager } from './parser-session.js';
import { SnapshotStore } from './snapshot-store.js';

dotenv.config();

type ServerConfig = {
  host: string;
  port: number;
  headless: boolean;
  navTimeoutMs: number;
  maxStoredSnapshots: number;
};

function optionalInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected integer ${min}..${max}`);
  }
  return value;
}

function optionalBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('Expected boolean true/false');
}

function loadConfigFromEnv(): ServerConfig {
  return {
    host: process.env.MCP_PARSER_HOST?.trim() || '127.0.0.1',
    port: optionalInt(process.env.MCP_PARSER_PORT, 3333, 1, 65535),
    headless: optionalBool(process.env.MCP_PARSER_HEADLESS, true),
    navTimeoutMs: optionalInt(process.env.MCP_PARSER_NAV_TIMEOUT_MS, 45000, 5000, 120000),
    maxStoredSnapshots: optionalInt(process.env.MCP_PARSER_MAX_STORED_SNAPSHOTS, 200, 10, 1000)
  };
}

const HARD_LIMITS = {
  maxDepth: 10,
  maxSiblingsPerNode: 100,
  maxTotalNodes: 1000,
  maxTextLengthPerNode: 600
} as const;

const DEFAULT_OPTIONS: Required<Pick<ProjectionOptions, 'maxDepth' | 'maxSiblingsPerNode' | 'maxTotalNodes' | 'maxTextLengthPerNode'>> = {
  maxDepth: 5,
  maxSiblingsPerNode: 40,
  maxTotalNodes: 350,
  maxTextLengthPerNode: 180
};

const parserOptionsSchema = z.object({
  maxDepth: z.number().int().min(1).max(HARD_LIMITS.maxDepth).optional(),
  maxSiblingsPerNode: z.number().int().min(1).max(HARD_LIMITS.maxSiblingsPerNode).optional(),
  maxTotalNodes: z.number().int().min(10).max(HARD_LIMITS.maxTotalNodes).optional(),
  maxTextLengthPerNode: z.number().int().min(20).max(HARD_LIMITS.maxTextLengthPerNode).optional(),
  includeHidden: z.boolean().optional()
}).optional();

const pageInputSchema = {
  url: z.string().url().optional(),
  sessionId: z.string().min(1).max(120).optional(),
  options: parserOptionsSchema
};

const subtreeInputSchema = {
  selector: z.string().min(1).max(500),
  url: z.string().url().optional(),
  sessionId: z.string().min(1).max(120).optional(),
  options: parserOptionsSchema
};

const snapshotDiffInputSchema = {
  beforeSnapshotId: z.string().optional(),
  afterSnapshotId: z.string().optional(),
  beforeSnapshot: z.any().optional(),
  afterSnapshot: z.any().optional()
};

const pageOutlineOutputSchema = z.object({
  snapshotId: z.string(),
  outline: z.unknown(),
  confidence: z.number(),
  warnings: z.array(z.string()),
  stats: z.unknown(),
  truncation: z.record(z.string(), z.boolean())
});

const snapshotOutputSchema = z.object({
  snapshotId: z.string(),
  snapshot: z.unknown(),
  truncation: z.record(z.string(), z.boolean())
});

const snapshotDiffOutputSchema = z.object({
  diff: z.unknown(),
  summary: z.object({
    added: z.number(),
    removed: z.number(),
    changed: z.number(),
    unchangedCount: z.number()
  })
});

function toProjectionOptions(input?: z.infer<typeof parserOptionsSchema>): ProjectionOptions {
  return {
    maxDepth: Math.min(input?.maxDepth ?? DEFAULT_OPTIONS.maxDepth, HARD_LIMITS.maxDepth),
    maxSiblingsPerNode: Math.min(input?.maxSiblingsPerNode ?? DEFAULT_OPTIONS.maxSiblingsPerNode, HARD_LIMITS.maxSiblingsPerNode),
    maxTotalNodes: Math.min(input?.maxTotalNodes ?? DEFAULT_OPTIONS.maxTotalNodes, HARD_LIMITS.maxTotalNodes),
    maxTextLengthPerNode: Math.min(input?.maxTextLengthPerNode ?? DEFAULT_OPTIONS.maxTextLengthPerNode, HARD_LIMITS.maxTextLengthPerNode),
    includeHidden: input?.includeHidden ?? false
  };
}

function truncationFlags(snapshot: ProjectedSnapshot): Record<string, boolean> {
  return {
    truncatedDepth: snapshot.stats.truncatedDepth,
    truncatedNodes: snapshot.stats.truncatedNodes,
    truncatedSiblings: snapshot.stats.truncatedSiblings,
    truncated: snapshot.stats.truncatedDepth || snapshot.stats.truncatedNodes || snapshot.stats.truncatedSiblings
  };
}

function createServer(sessionManager: ParserSessionManager, snapshotStore: SnapshotStore): McpServer {
  const server = new McpServer({
    name: 'parser-mcp-server',
    version: '1.0.0'
  });

  server.registerTool('page_outline', {
    description: 'Returns low-noise page outline for map-first navigation.',
    inputSchema: pageInputSchema,
    outputSchema: pageOutlineOutputSchema
  }, async ({ url, sessionId, options }) => {
    const resolved = await sessionManager.resolvePage({ sessionId, url });
    try {
      const normalized = toProjectionOptions(options);
      const outline = await pageOutline(resolved.page, normalized);
      const fullSnapshot = await subtree(resolved.page, 'body', normalized);
      const saved = snapshotStore.put(fullSnapshot);
      const structuredContent = {
        snapshotId: saved.id,
        outline,
        confidence: outline.confidence,
        warnings: outline.warnings,
        stats: outline.stats,
        truncation: truncationFlags(fullSnapshot)
      };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify({ snapshotId: saved.id, confidence: outline.confidence }) }]
      };
    } finally {
      await resolved.release();
    }
  });

  server.registerTool('subtree', {
    description: 'Projects a bounded subtree snapshot for a CSS selector.',
    inputSchema: subtreeInputSchema,
    outputSchema: snapshotOutputSchema
  }, async ({ selector, url, sessionId, options }) => {
    const resolved = await sessionManager.resolvePage({ sessionId, url });
    try {
      const snapshot = await subtree(resolved.page, selector, toProjectionOptions(options));
      const saved = snapshotStore.put(snapshot);
      const structuredContent = {
        snapshotId: saved.id,
        snapshot,
        truncation: truncationFlags(snapshot)
      };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify({ snapshotId: saved.id, warnings: snapshot.warnings }) }]
      };
    } finally {
      await resolved.release();
    }
  });

  server.registerTool('interactive_elements', {
    description: 'Returns a low-noise snapshot focused on interactive elements.',
    inputSchema: pageInputSchema,
    outputSchema: snapshotOutputSchema
  }, async ({ url, sessionId, options }) => {
    const resolved = await sessionManager.resolvePage({ sessionId, url });
    try {
      const snapshot = await interactiveElements(resolved.page, toProjectionOptions(options));
      const saved = snapshotStore.put(snapshot);
      const structuredContent = {
        snapshotId: saved.id,
        snapshot,
        truncation: truncationFlags(snapshot)
      };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify({ snapshotId: saved.id, confidence: snapshot.confidence }) }]
      };
    } finally {
      await resolved.release();
    }
  });

  server.registerTool('snapshot_diff', {
    description: 'Computes delta between two projected snapshots.',
    inputSchema: snapshotDiffInputSchema,
    outputSchema: snapshotDiffOutputSchema
  }, async ({ beforeSnapshotId, afterSnapshotId, beforeSnapshot, afterSnapshot }) => {
    const before = beforeSnapshotId ? snapshotStore.get(beforeSnapshotId)?.snapshot ?? null : (beforeSnapshot as ProjectedSnapshot | null) ?? null;
    const after = afterSnapshotId ? snapshotStore.get(afterSnapshotId)?.snapshot ?? null : (afterSnapshot as ProjectedSnapshot | null) ?? null;

    if (!after) {
      throw new Error('afterSnapshotId or afterSnapshot must resolve to a snapshot');
    }

    const diff = snapshotDiff(before, after);
    const summary = {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchangedCount: diff.unchangedCount
    };

    return {
      structuredContent: { diff, summary },
      content: [{ type: 'text', text: JSON.stringify(summary) }]
    };
  });

  return server;
}

export async function startParserMcpServer(config: ServerConfig): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = createMcpExpressApp({ host: config.host });
  const sessions = new ParserSessionManager(config.headless, config.navTimeoutMs);
  const snapshotStore = new SnapshotStore(config.maxStoredSnapshots);
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const handleMcpRequest = async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport: StreamableHTTPServerTransport | undefined;

      if (typeof sessionId === 'string' && sessionId.length > 0) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport as StreamableHTTPServerTransport;
          }
        });

        transport.onclose = () => {
          const activeSessionId = transport?.sessionId;
          if (activeSessionId) {
            delete transports[activeSessionId];
          }
        };

        const server = createServer(sessions, snapshotStore);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!transport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Invalid or missing session ID' },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message },
          id: null
        });
      }
    }
  };

  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpRequest);
  app.delete('/mcp', handleMcpRequest);

  const serverHandle = await new Promise<import('node:http').Server>((resolve, reject) => {
    const handle = app.listen(config.port, config.host, () => resolve(handle));
    handle.on('error', reject);
  });

  const addressInfo = serverHandle.address();
  const actualPort =
    typeof addressInfo === 'object' && addressInfo && 'port' in addressInfo ? (addressInfo.port as number) : config.port;
  const url = `http://${config.host}:${actualPort}/mcp`;

  const shutdown = async () => {
    await sessions.close();
    for (const transport of Object.values(transports)) {
      await transport.close();
    }
    await new Promise<void>((resolve) => {
      serverHandle.close(() => resolve());
    });
  };

  return { url, close: shutdown };
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const { url, close } = await startParserMcpServer(config);
  // eslint-disable-next-line no-console
  console.log(`Parser MCP server listening at ${url}`);
  // eslint-disable-next-line no-console
  console.log(`Snapshot store capacity: ${config.maxStoredSnapshots}`);

  const shutdownAndExit = async () => {
    await close();
    process.exit(0);
  };

  process.on('SIGINT', shutdownAndExit);
  process.on('SIGTERM', shutdownAndExit);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main();
}
