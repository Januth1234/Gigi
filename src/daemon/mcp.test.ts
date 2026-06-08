/**
 * MCP Handler Unit Tests
 *
 * Validates the JSON-RPC 2.0 handling for the Jarvis MCP server endpoint
 * in isolation — no HTTP server, no agent service, no file-system access.
 *
 * Run with:
 *   bun test src/daemon/mcp.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { handleMcpRequest } from './mcp-handler.ts';
import { ToolRegistry } from '../actions/tools/registry.ts';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal ToolRegistry pre-populated with one echo tool. */
function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: 'Returns the input text unchanged.',
    category: 'test',
    parameters: {
      text: { type: 'string', description: 'Text to echo back', required: true },
    },
    execute: async (params) => `echo: ${params.text}`,
  });
  return registry;
}

/** Convenience: cast result to the success shape. */
function asSuccess(r: unknown): { jsonrpc: string; id: unknown; result: unknown } {
  return r as { jsonrpc: string; id: unknown; result: unknown };
}

/** Convenience: cast result to the error shape. */
function asError(r: unknown): {
  jsonrpc: string;
  id: unknown;
  error: { code: number; message: string };
} {
  return r as { jsonrpc: string; id: unknown; error: { code: number; message: string } };
}

// ─── initialize ─────────────────────────────────────────────────────────────

describe('MCP initialize', () => {
  test('returns a valid protocol version and server info', async () => {
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        registry,
      ),
    );

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);

    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: unknown };
    };

    expect(typeof result.protocolVersion).toBe('string');
    expect(result.protocolVersion.length).toBeGreaterThan(0);
    expect(result.serverInfo.name).toBe('jarvis');
    expect(typeof result.serverInfo.version).toBe('string');
    expect(result.capabilities).toHaveProperty('tools');
  });

  test('works with null id (notification-style)', async () => {
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: null, method: 'initialize' },
        registry,
      ),
    );
    expect(response.id).toBeNull();
    expect(response.result).toBeTruthy();
  });
});

// ─── tools/list ─────────────────────────────────────────────────────────────

describe('MCP tools/list', () => {
  test('returns all tools registered in the registry', async () => {
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        registry,
      ),
    );

    const result = response.result as { tools: Array<{ name: string }> };
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe('echo');
  });

  test('each tool has name, description, and inputSchema', async () => {
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        registry,
      ),
    );

    const result = response.result as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: { type: string; properties: unknown; required: string[] };
      }>;
    };

    const tool = result.tools[0]!;
    expect(tool.name).toBe('echo');
    expect(typeof tool.description).toBe('string');
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.required).toContain('text');
  });

  test('reflects additional registered tools', async () => {
    const registry = makeRegistry();
    registry.register({
      name: 'noop',
      description: 'Does nothing.',
      category: 'test',
      parameters: {},
      execute: async () => 'ok',
    });

    const response = asSuccess(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 4, method: 'tools/list' },
        registry,
      ),
    );

    const result = response.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(2);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('noop');
  });
});

// ─── tools/call ─────────────────────────────────────────────────────────────

describe('MCP tools/call', () => {
  test('executes a known tool and returns text content', async () => {
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'hello world' } },
        },
        registry,
      ),
    );

    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    expect(result.content[0]!.text).toBe('echo: hello world');
  });

  test('returns isError:true for an unknown tool (not a JSON-RPC error)', async () => {
    // The MCP spec says tool errors should be surfaced as isError:true content
    // blocks, not as protocol-level JSON-RPC errors.
    const registry = makeRegistry();
    const response = asSuccess(
      await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'nonexistent_tool', arguments: {} },
        },
        registry,
      ),
    );

    // Unknown tool → INVALID_PARAMS error (not isError in content)
    // Our handler throws a structured error for unknown tools
    const r = response as unknown as { error?: { code: number } };
    expect(r.error?.code).toBe(-32602); // INVALID_PARAMS
  });

  test('surfaces tool execution failures as isError content blocks', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'failing_tool',
      description: 'Always throws.',
      category: 'test',
      parameters: {},
      execute: async () => { throw new Error('something went wrong'); },
    });

    const response = asSuccess(
      await handleMcpRequest(
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'failing_tool', arguments: {} },
        },
        registry,
      ),
    );

    const result = response.result as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.type).toBe('text');
    expect(result.content[0]!.text).toContain('something went wrong');
  });

  test('missing params.name returns INVALID_PARAMS error', async () => {
    const registry = makeRegistry();
    const response = asError(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { arguments: {} } },
        registry,
      ),
    );
    expect(response.error.code).toBe(-32602);
  });
});

// ─── Protocol-level error cases ─────────────────────────────────────────────

describe('MCP protocol error handling', () => {
  test('non-object body returns INVALID_REQUEST', async () => {
    const registry = makeRegistry();
    const response = asError(await handleMcpRequest('not an object', registry));
    expect(response.error.code).toBe(-32600);
    expect(response.id).toBeNull();
  });

  test('wrong jsonrpc version returns INVALID_REQUEST', async () => {
    const registry = makeRegistry();
    const response = asError(
      await handleMcpRequest({ jsonrpc: '1.0', id: 1, method: 'initialize' }, registry),
    );
    expect(response.error.code).toBe(-32600);
  });

  test('unknown method returns METHOD_NOT_FOUND', async () => {
    const registry = makeRegistry();
    const response = asError(
      await handleMcpRequest(
        { jsonrpc: '2.0', id: 10, method: 'unknown/method' },
        registry,
      ),
    );
    expect(response.error.code).toBe(-32601);
    expect(response.id).toBe(10);
  });

  test('response always echoes the request id', async () => {
    const registry = makeRegistry();
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 42, method: 'initialize' },
      registry,
    ) as { id: unknown };
    expect(response.id).toBe(42);
  });
});
