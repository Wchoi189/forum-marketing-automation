import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { startParserMcpServer } from '../../mcp/parser-server.js';

function dataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

test('parser MCP server: tools + snapshot_diff', async () => {
  const { url, close } = await startParserMcpServer({
    host: '127.0.0.1',
    port: 0,
    headless: true,
    navTimeoutMs: 15000,
    maxStoredSnapshots: 50
  });

  const client = new Client({ name: 'parser-mcp-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport);

    const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
    const toolNames = tools.tools.map((t) => t.name).sort();
    for (const required of ['interactive_elements', 'page_outline', 'snapshot_diff', 'subtree']) {
      assert(toolNames.includes(required), `Expected tool to be registered: ${required}`);
    }

    const url1 = dataUrl(`
      <!doctype html>
      <html>
        <head><title>Page One</title></head>
        <body>
          <main>
            <h1>Welcome</h1>
            <a href="https://example.com">Example</a>
            <button id="go">Go</button>
            <form>
              <label>Email <input name="email" /></label>
            </form>
          </main>
        </body>
      </html>
    `);

    const url2 = dataUrl(`
      <!doctype html>
      <html>
        <head><title>Page Two</title></head>
        <body>
          <main>
            <h1>Welcome</h1>
            <p>New content</p>
            <button id="go">Go</button>
            <button id="more">More</button>
          </main>
        </body>
      </html>
    `);

    const outlineResult = await client.request(
      {
        method: 'tools/call',
        params: { name: 'page_outline', arguments: { url: url1 } }
      },
      CallToolResultSchema
    );
    const outlineStructured = (outlineResult as unknown as { structuredContent?: any }).structuredContent;
    assert(outlineStructured?.snapshotId, `Expected page_outline to return snapshotId (got: ${JSON.stringify(outlineResult)})`);
    assert(typeof outlineStructured?.confidence === 'number', 'Expected page_outline to return confidence');

    const interactivesResult = await client.request(
      {
        method: 'tools/call',
        params: { name: 'interactive_elements', arguments: { url: url1 } }
      },
      CallToolResultSchema
    );
    const interactiveStructured = (interactivesResult as unknown as { structuredContent?: any }).structuredContent;
    assert(interactiveStructured?.snapshotId, 'Expected interactive_elements to return snapshotId');

    const beforeSubtree = await client.request(
      {
        method: 'tools/call',
        params: { name: 'subtree', arguments: { url: url1, selector: 'body' } }
      },
      CallToolResultSchema
    );
    const beforeStructured = (beforeSubtree as unknown as { structuredContent?: any }).structuredContent;
    assert(beforeStructured?.snapshotId, 'Expected subtree to return snapshotId');

    const afterSubtree = await client.request(
      {
        method: 'tools/call',
        params: { name: 'subtree', arguments: { url: url2, selector: 'body' } }
      },
      CallToolResultSchema
    );
    const afterStructured = (afterSubtree as unknown as { structuredContent?: any }).structuredContent;
    assert(afterStructured?.snapshotId, 'Expected subtree to return snapshotId');

    const diffResult = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'snapshot_diff',
          arguments: {
            beforeSnapshotId: beforeStructured.snapshotId,
            afterSnapshotId: afterStructured.snapshotId
          }
        }
      },
      CallToolResultSchema
    );
    const diffStructured = (diffResult as unknown as { structuredContent?: any }).structuredContent;
    assert(diffStructured?.summary, 'Expected snapshot_diff to return summary');
    assert(typeof diffStructured.summary.added === 'number', 'Expected numeric diff summary counts');
    assert(
      diffStructured.summary.added > 0,
      'Expected second page (extra paragraph + button) to register as added projection nodes vs first page'
    );
  } finally {
    await transport.close().catch(() => null);
    await close();
  }
});

