/**
 * MCP Handler — Jarvis as an MCP Server
 *
 * Stateless JSON-RPC 2.0 handler that implements the Model Context Protocol
 * server surface over the live Jarvis ToolRegistry. Mounted at POST /api/mcp
 * by api-routes.ts.
 *
 * Supported methods:
 *   initialize        — negotiate protocol version and advertise capabilities
 *   tools/list        — enumerate tools from the live ToolRegistry
 *   tools/call        — execute a tool via ToolRegistry.execute()
 *
 * Reference: https://spec.modelcontextprotocol.io/specification/
 */

import type { ToolRegistry } from '../actions/tools/registry.ts';
import { isToolResult } from '../actions/tools/registry.ts';

// ─── JSON-RPC 2.0 types ────────────────────────────────────────────────────

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
};

type JsonRpcError = {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
};

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// JSON-RPC error codes
const PARSE_ERROR      = -32700;
const INVALID_REQUEST  = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS   = -32602;
const INTERNAL_ERROR   = -32603;

// MCP protocol version this server implements
const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME          = 'jarvis';
const SERVER_VERSION       = '0.5.0';

// ─── MCP content block helpers ─────────────────────────────────────────────

/**
 * Coerce an arbitrary tool result into an array of MCP content blocks.
 * Jarvis tools can return a string, a ToolResult { content: [...] }, or
 * any other value — we normalise all of them here.
 */
function resultToContentBlocks(raw: unknown): Array<{ type: string; text?: string; [k: string]: unknown }> {
  if (isToolResult(raw)) {
    // Already an array of ContentBlock — map to MCP shape
    return raw.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: (block as { type: 'text'; text: string }).text };
      }
      if (block.type === 'image') {
        const img = block as { type: 'image'; source: { type: string; media_type: string; data: string } };
        return {
          type: 'image',
          mimeType: img.source.media_type,
          data: img.source.data,
        };
      }
      // Fallback: serialise
      return { type: 'text', text: JSON.stringify(block) };
    });
  }

  if (typeof raw === 'string') {
    return [{ type: 'text', text: raw }];
  }

  return [{ type: 'text', text: JSON.stringify(raw) }];
}

// ─── Method handlers ───────────────────────────────────────────────────────

function handleInitialize(_params: unknown): unknown {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    capabilities: {
      tools: { listChanged: false },
    },
  };
}

function handleToolsList(registry: ToolRegistry): unknown {
  const tools = registry.list().map((tool) => {
    // Build a JSON Schema `inputSchema` from Jarvis ToolParameter map
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const [paramName, param] of Object.entries(tool.parameters)) {
      properties[paramName] = { type: param.type, description: param.description };
      if (param.required) required.push(paramName);
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
    };
  });

  return { tools };
}

async function handleToolsCall(
  registry: ToolRegistry,
  params: unknown,
): Promise<unknown> {
  if (
    typeof params !== 'object' ||
    params === null ||
    typeof (params as Record<string, unknown>).name !== 'string'
  ) {
    throw { code: INVALID_PARAMS, message: 'params.name (string) is required' };
  }

  const p = params as { name: string; arguments?: Record<string, unknown> };
  const toolName = p.name;
  const toolArgs  = p.arguments ?? {};

  if (!registry.has(toolName)) {
    throw { code: INVALID_PARAMS, message: `Unknown tool: ${toolName}` };
  }

  let raw: unknown;
  try {
    raw = await registry.execute(toolName, toolArgs);
  } catch (err) {
    // Surface tool execution errors as MCP `isError: true` responses,
    // not as JSON-RPC errors — this matches the MCP spec guidance.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text', text: msg }],
    };
  }

  return {
    content: resultToContentBlocks(raw),
  };
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Handle a single MCP JSON-RPC request.
 *
 * @param body    Raw request body (parsed from JSON).
 * @param registry The live ToolRegistry from the AgentService orchestrator.
 * @returns       A JSON-RPC 2.0 response object ready to serialise.
 */
export async function handleMcpRequest(
  body: unknown,
  registry: ToolRegistry,
): Promise<JsonRpcResponse> {
  // ── Validate envelope ────────────────────────────────────────────────────
  if (typeof body !== 'object' || body === null) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: INVALID_REQUEST, message: 'Request body must be a JSON object' },
    };
  }

  const req = body as Partial<JsonRpcRequest>;

  if (req.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: INVALID_REQUEST, message: 'jsonrpc must be "2.0"' },
    };
  }

  if (typeof req.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: INVALID_REQUEST, message: 'method must be a string' },
    };
  }

  const id = req.id ?? null;

  // ── Dispatch ─────────────────────────────────────────────────────────────
  try {
    let result: unknown;

    switch (req.method) {
      case 'initialize':
        result = handleInitialize(req.params);
        break;

      case 'tools/list':
        result = handleToolsList(registry);
        break;

      case 'tools/call':
        result = await handleToolsCall(registry, req.params);
        break;

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: METHOD_NOT_FOUND, message: `Method not found: ${req.method}` },
        };
    }

    return { jsonrpc: '2.0', id, result };

  } catch (err) {
    // Structured errors thrown by handlers
    if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
      const e = err as { code: number; message: string; data?: unknown };
      return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message, data: e.data } };
    }

    // Unexpected errors
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: INTERNAL_ERROR, message: `Internal error: ${msg}` },
    };
  }
}
