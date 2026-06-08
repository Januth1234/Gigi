/**
 * OpenHuman Tools — Jarvis as an MCP Client
 *
 * Exposes three tools that let the Jarvis agent reach into a locally-running
 * OpenHuman core server (default: http://127.0.0.1:9300/mcp) via the
 * standard MCP JSON-RPC HTTP transport.
 *
 * Tools:
 *   openhuman_list_tools       — discover all tools OpenHuman currently exposes
 *   openhuman_search_memory    — search OpenHuman's memory tree / Obsidian wiki
 *   openhuman_call_integration — call any Composio integration connected to OpenHuman
 *
 * The endpoint (and optional bearer token) can be overridden via environment
 * variables so this file stays config-free:
 *   OPENHUMAN_MCP_URL    — defaults to http://127.0.0.1:9300/mcp
 *   OPENHUMAN_MCP_TOKEN  — if set, sent as Authorization: Bearer <token>
 */

import type { ToolDefinition } from './registry.ts';

// ─── Transport helpers ─────────────────────────────────────────────────────

const DEFAULT_OPENHUMAN_URL = 'http://127.0.0.1:9300/mcp';

/** Resolve the OpenHuman MCP endpoint from the environment. */
function getOpenHumanUrl(): string {
  return (typeof process !== 'undefined' && process.env?.OPENHUMAN_MCP_URL)
    ? process.env.OPENHUMAN_MCP_URL
    : DEFAULT_OPENHUMAN_URL;
}

/** Build Authorization header value if a token is configured. */
function getAuthHeader(): Record<string, string> {
  const token = typeof process !== 'undefined' ? process.env?.OPENHUMAN_MCP_TOKEN : undefined;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

let _rpcId = 1;

/**
 * Send a single JSON-RPC 2.0 request to the OpenHuman MCP server.
 * Returns the parsed `result` field, or throws on network / protocol errors.
 */
async function rpc(method: string, params: unknown): Promise<unknown> {
  const id = _rpcId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

  let resp: Response;
  try {
    resp = await fetch(getOpenHumanUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...getAuthHeader(),
      },
      body,
      // Short timeout — OpenHuman runs locally
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenHuman MCP unreachable (${getOpenHumanUrl()}): ${msg}`);
  }

  if (!resp.ok) {
    throw new Error(`OpenHuman MCP HTTP ${resp.status}: ${resp.statusText}`);
  }

  let data: JsonRpcResponse;
  try {
    data = (await resp.json()) as JsonRpcResponse;
  } catch {
    throw new Error('OpenHuman MCP returned non-JSON response');
  }

  if (data.error) {
    throw new Error(`OpenHuman MCP error [${data.error.code}]: ${data.error.message}`);
  }

  return data.result;
}

// ─── Tool: openhuman_list_tools ────────────────────────────────────────────

export const openHumanListToolsTool: ToolDefinition = {
  name: 'openhuman_list_tools',
  description:
    'List all tools currently exposed by the local OpenHuman MCP server. ' +
    'Use this to discover available Composio integrations, memory tools, and ' +
    'other capabilities before calling openhuman_call_integration.',
  category: 'openhuman',
  parameters: {},
  execute: async () => {
    let result: unknown;
    try {
      result = await rpc('tools/list', {});
    } catch (err) {
      return `Error contacting OpenHuman: ${err instanceof Error ? err.message : String(err)}`;
    }

    const r = result as { tools?: Array<{ name: string; description?: string }> } | null;
    const tools = r?.tools ?? [];
    if (tools.length === 0) {
      return 'OpenHuman is running but has no tools registered.';
    }

    const lines = tools.map((t) => `• ${t.name}${t.description ? `: ${t.description}` : ''}`);
    return `OpenHuman exposes ${tools.length} tool(s):\n${lines.join('\n')}`;
  },
};

// ─── Tool: openhuman_search_memory ────────────────────────────────────────

export const openHumanSearchMemoryTool: ToolDefinition = {
  name: 'openhuman_search_memory',
  description:
    'Search the local OpenHuman memory tree and Obsidian wiki chunks. ' +
    'Returns ranked passages relevant to the query. Use this when you need ' +
    'to recall something the user has stored in OpenHuman.',
  category: 'openhuman',
  parameters: {
    query: {
      type: 'string',
      description: 'Natural-language search query',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (default 10)',
      required: false,
    },
  },
  execute: async (params) => {
    const query = params.query as string;
    const limit  = (params.limit as number | undefined) ?? 10;

    let result: unknown;
    try {
      // OpenHuman exposes memory search as a tool named `search_memory`
      result = await rpc('tools/call', {
        name: 'search_memory',
        arguments: { query, limit },
      });
    } catch (err) {
      return `Error searching OpenHuman memory: ${err instanceof Error ? err.message : String(err)}`;
    }

    // MCP tools/call returns { content: [...], isError?: boolean }
    const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | null;

    if (r?.isError) {
      const errText = r.content?.map((c) => c.text ?? '').join('\n') ?? 'unknown error';
      return `OpenHuman memory search failed: ${errText}`;
    }

    const text = (r?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();

    return text || 'No results found.';
  },
};

// ─── Tool: openhuman_call_integration ─────────────────────────────────────

export const openHumanCallIntegrationTool: ToolDefinition = {
  name: 'openhuman_call_integration',
  description:
    'Execute any Composio integration tool connected to OpenHuman (e.g. Gmail, ' +
    'Notion, Slack, Google Drive). First call openhuman_list_tools to see what ' +
    'is available, then call this with the exact tool name and its arguments.',
  category: 'openhuman',
  parameters: {
    tool_name: {
      type: 'string',
      description: 'Exact tool name as returned by openhuman_list_tools',
      required: true,
    },
    arguments: {
      type: 'object',
      description: 'Tool arguments as a JSON object (use {} if the tool needs no arguments)',
      required: true,
    },
  },
  execute: async (params) => {
    const toolName = params.tool_name as string;
    const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

    let result: unknown;
    try {
      result = await rpc('tools/call', {
        name: toolName,
        arguments: toolArgs,
      });
    } catch (err) {
      return `Error calling OpenHuman integration "${toolName}": ${err instanceof Error ? err.message : String(err)}`;
    }

    const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | null;

    if (r?.isError) {
      const errText = r.content?.map((c) => c.text ?? '').join('\n') ?? 'unknown error';
      return `OpenHuman tool "${toolName}" returned an error: ${errText}`;
    }

    const text = (r?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();

    return text || `Tool "${toolName}" completed with no text output.`;
  },
};

// ─── Barrel export ─────────────────────────────────────────────────────────

/** All three OpenHuman client tools, ready to spread into NON_BROWSER_TOOLS. */
export const OPENHUMAN_TOOLS: ToolDefinition[] = [
  openHumanListToolsTool,
  openHumanSearchMemoryTool,
  openHumanCallIntegrationTool,
];
