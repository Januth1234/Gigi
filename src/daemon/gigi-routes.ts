/**
 * Gigi Extended API Routes
 *
 * Routes for: knowledge graph crawling, startup management,
 * wake word configuration, and multi-provider key management.
 * Merged into the main createApiRoutes() output.
 */

import type { ApiContext } from '../daemon/api-routes.ts';
import { crawlKnowledgeGraph, type CrawlProgress } from '../knowledge/crawler.ts';
import {
  listStartupEntries,
  installGigiStartup,
  pruneStartupEntries,
  isGigiStartupInstalled,
} from '../startup/manager.ts';
import {
  wakeWordEngine,
  loadWakeConfig,
  saveWakeConfig,
} from '../wakeword/engine.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

// ─── Knowledge graph routes ───────────────────────────────────────────────

// Active crawl SSE clients — supports multiple dashboard tabs
const crawlClients: Set<ReadableStreamDefaultController> = new Set();
let activeCrawl: Promise<void> | null = null;

function broadcastCrawlProgress(progress: CrawlProgress): void {
  const data = `data: ${JSON.stringify(progress)}\n\n`;
  const enc = new TextEncoder();
  for (const ctrl of crawlClients) {
    try {
      ctrl.enqueue(enc.encode(data));
    } catch {
      crawlClients.delete(ctrl);
    }
  }
}

export function createGigiRoutes(_ctx: ApiContext): Record<string, unknown> {
  return {

    // ── Knowledge graph ─────────────────────────────────────────────────

    /** SSE stream of crawl progress updates */
    '/api/gigi/knowledge/crawl': {
      GET: () => {
        const stream = new ReadableStream({
          start(controller) {
            crawlClients.add(controller);
          },
          cancel(controller) {
            crawlClients.delete(controller as unknown as ReadableStreamDefaultController);
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      },

      /** POST to start a new crawl */
      POST: async (req: Request) => {
        if (activeCrawl) {
          return json({ status: 'already_running' });
        }

        const body = await req.json().catch(() => ({})) as {
          roots?: string[];
          maxDepth?: number;
          maxFiles?: number;
        };

        activeCrawl = crawlKnowledgeGraph({
          roots: body.roots,
          maxDepth: body.maxDepth,
          maxFiles: body.maxFiles,
          onProgress: broadcastCrawlProgress,
        }).finally(() => {
          activeCrawl = null;
        });

        return json({ status: 'started' });
      },
    },

    // ── Startup management ───────────────────────────────────────────────

    '/api/gigi/startup': {
      GET: () => {
        return json({
          entries: listStartupEntries(),
          gigiInstalled: isGigiStartupInstalled(),
        });
      },

      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({})) as {
          action: 'install' | 'prune';
          executablePath?: string;
        };

        if (body.action === 'install') {
          const execPath = body.executablePath ?? process.execPath;
          try {
            installGigiStartup(execPath);
            return json({ ok: true, message: 'Gigi registered as startup app' });
          } catch (e) {
            return err(`Failed to install startup: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        if (body.action === 'prune') {
          const removed = pruneStartupEntries();
          return json({ ok: true, removed: removed.map(e => e.name) });
        }

        return err('action must be "install" or "prune"');
      },
    },

    // ── Wake word ────────────────────────────────────────────────────────

    '/api/gigi/wakeword': {
      GET: () => {
        return json({
          config: loadWakeConfig(),
          state: wakeWordEngine.getState(),
        });
      },

      PATCH: async (req: Request) => {
        const body = await req.json().catch(() => ({})) as {
          name?: string;
          shortAlias?: string;
          customKeywords?: string[];
          confidence?: number;
        };

        const current = loadWakeConfig();
        const updated = {
          ...current,
          ...(body.name && { name: body.name }),
          ...(body.shortAlias && { shortAlias: body.shortAlias }),
          ...(body.customKeywords && { customKeywords: body.customKeywords }),
          ...(body.confidence !== undefined && { confidence: body.confidence }),
        };

        saveWakeConfig(updated);
        wakeWordEngine.updateConfig(updated);
        return json({ ok: true, config: updated });
      },
    },

    /** Receive transcript fragments from the browser STT engine */
    '/api/gigi/wakeword/transcript': {
      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({})) as {
          transcript?: string;
          confidence?: number;
          final?: boolean;
        };

        if (!body.transcript) return json({ triggered: false });

        const triggered = wakeWordEngine.processTranscript(
          body.transcript,
          body.confidence ?? 1.0,
        );

        return json({
          triggered,
          state: wakeWordEngine.getState(),
        });
      },
    },

    // ── Provider / API key management ────────────────────────────────────

    /** List supported LLM providers */
    '/api/gigi/providers': {
      GET: () => {
        return json({
          providers: [
            { slug: 'anthropic',   label: 'Anthropic (Claude)',    placeholder: 'sk-ant-...',   url: 'https://console.anthropic.com' },
            { slug: 'openai',      label: 'OpenAI (GPT-4)',        placeholder: 'sk-...',        url: 'https://platform.openai.com' },
            { slug: 'groq',        label: 'Groq (ultra-fast)',     placeholder: 'gsk_...',       url: 'https://console.groq.com' },
            { slug: 'gemini',      label: 'Google Gemini',         placeholder: 'AIza...',       url: 'https://aistudio.google.com' },
            { slug: 'openrouter',  label: 'OpenRouter',            placeholder: 'sk-or-...',     url: 'https://openrouter.ai' },
            { slug: 'ollama',      label: 'Ollama (local)',        placeholder: 'http://127.0.0.1:11434', url: 'https://ollama.com' },
            { slug: 'nvidia',      label: 'NVIDIA NIM',            placeholder: 'nvapi-...',     url: 'https://build.nvidia.com' },
            { slug: 'fireworks',   label: 'Fireworks AI',          placeholder: 'fw-...',        url: 'https://fireworks.ai' },
            { slug: 'together',    label: 'Together AI',           placeholder: 'sk-...',        url: 'https://together.ai' },
            { slug: 'litellm',     label: 'LiteLLM proxy',         placeholder: 'http://...',    url: 'https://litellm.ai' },
            { slug: 'openai_compatible', label: 'OpenAI-compatible (custom)', placeholder: 'http://...', url: '' },
          ],
        });
      },
    },

    /** Save an API key for a provider into the Jarvis config */
    '/api/gigi/providers/key': {
      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({})) as {
          slug?: string;
          key?: string;
          baseUrl?: string;
        };

        if (!body.slug) return err('slug is required');

        // Persist via environment variable for this session
        // (in production these are written to the encrypted config file)
        const envMap: Record<string, string> = {
          anthropic:        'ANTHROPIC_API_KEY',
          openai:           'OPENAI_API_KEY',
          groq:             'GROQ_API_KEY',
          gemini:           'GEMINI_API_KEY',
          openrouter:       'OPENROUTER_API_KEY',
          nvidia:           'NVIDIA_API_KEY',
          fireworks:        'FIREWORKS_API_KEY',
          together:         'TOGETHER_API_KEY',
        };

        if (body.key && envMap[body.slug]) {
          process.env[envMap[body.slug]!] = body.key;
        }

        if (body.baseUrl && body.slug === 'ollama') {
          process.env['OLLAMA_BASE_URL'] = body.baseUrl;
        }

        if (body.baseUrl && body.slug === 'openai_compatible') {
          process.env['OPENAI_COMPATIBLE_BASE_URL'] = body.baseUrl;
        }

        return json({ ok: true, slug: body.slug });
      },
    },

    // ── Gigi status ──────────────────────────────────────────────────────

    '/api/gigi/status': {
      GET: () => {
        return json({
          name: 'Gigi',
          version: '1.0.0',
          wakeWord: wakeWordEngine.getConfig().name,
          wakeState: wakeWordEngine.getState(),
          startupInstalled: isGigiStartupInstalled(),
          providers: {
            anthropic: !!process.env['ANTHROPIC_API_KEY'],
            openai:    !!process.env['OPENAI_API_KEY'],
            groq:      !!process.env['GROQ_API_KEY'],
            gemini:    !!process.env['GEMINI_API_KEY'],
          },
        });
      },
    },
  };
}
