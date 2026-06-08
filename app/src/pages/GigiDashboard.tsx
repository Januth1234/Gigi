/**
 * GigiDashboard.tsx
 *
 * Main home screen shown after setup. Shows:
 *   - Wake word status + live indicator
 *   - Quick action tiles (voice, graph, integrations)
 *   - Recent activity / conversation feed
 *   - OpenHuman integrations status
 *   - Jarvis tool registry summary
 */

import { useEffect, useState, useCallback } from 'react';

const API = 'http://127.0.0.1:3142';

// ─── Types ───────────────────────────────────────────────────────────────────

type GigiStatus = {
  name: string;
  version: string;
  wakeWord: string;
  wakeState: 'passive' | 'active' | 'processing';
  startupInstalled: boolean;
  providers: Record<string, boolean>;
};

type McpTool = { name: string; description?: string };

// ─── Wake indicator ───────────────────────────────────────────────────────────

function WakeIndicator({ state, word }: { state: string; word: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex items-center justify-center w-10 h-10 rounded-full ${
        state === 'active' ? 'bg-violet-500/20' :
        state === 'processing' ? 'bg-amber-500/20' :
        'bg-slate-800'
      }`}>
        {state === 'active' && (
          <span className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" />
        )}
        <span className={`text-lg ${
          state === 'active' ? 'text-violet-400' :
          state === 'processing' ? 'text-amber-400' :
          'text-slate-600'
        }`}>
          {state === 'processing' ? '⚡' : '🎙️'}
        </span>
      </div>
      <div>
        <div className={`text-sm font-semibold ${state === 'active' ? 'text-violet-300' : 'text-slate-400'}`}>
          {state === 'active' ? 'Listening…' :
           state === 'processing' ? 'Processing…' :
           'Passive mode'}
        </div>
        <div className="text-xs text-slate-600">
          Say <span className="text-slate-400 font-mono">"{word}"</span> to activate
        </div>
      </div>
    </div>
  );
}

// ─── Provider badge ───────────────────────────────────────────────────────────

function ProviderBadge({ name, connected }: { name: string; connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      connected
        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        : 'bg-slate-800 text-slate-600 border border-slate-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {name}
    </span>
  );
}

// ─── Tool list ────────────────────────────────────────────────────────────────

function ToolList({ tools }: { tools: McpTool[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tools : tools.slice(0, 6);

  return (
    <div className="space-y-1.5">
      {shown.map(tool => (
        <div key={tool.name} className="flex items-start gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
          <span className="text-violet-400 mt-0.5">⚡</span>
          <div>
            <div className="text-xs font-mono text-white">{tool.name}</div>
            {tool.description && (
              <div className="text-[10px] text-slate-500 mt-0.5 leading-tight line-clamp-1">
                {tool.description}
              </div>
            )}
          </div>
        </div>
      ))}
      {tools.length > 6 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[10px] text-violet-400 hover:text-violet-300 px-3"
        >
          {expanded ? 'Show less' : `+${tools.length - 6} more tools`}
        </button>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function GigiDashboard() {
  const [status, setStatus] = useState<GigiStatus | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [ohTools, setOhTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/gigi/status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* daemon not running yet */ }
  }, []);

  const fetchTools = useCallback(async () => {
    try {
      // Jarvis tools via MCP
      const res = await fetch(`${API}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      if (res.ok) {
        const data = await res.json() as { result?: { tools: McpTool[] } };
        setTools(data.result?.tools ?? []);
      }
    } catch { /* daemon not up */ }

    try {
      // OpenHuman tools
      const res = await fetch(`${API}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2,
          method: 'tools/call',
          params: { name: 'openhuman_list_tools', arguments: {} },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { result?: { content?: Array<{ text?: string }> } };
        const text = data.result?.content?.[0]?.text ?? '';
        // Parse the plain-text bullet list
        const lines = text.split('\n').filter(l => l.startsWith('•'));
        setOhTools(lines.map(l => {
          const parts = l.replace('• ', '').split(':');
          return { name: parts[0]?.trim() ?? '', description: parts[1]?.trim() };
        }));
      }
    } catch { /* OpenHuman not running */ }
  }, []);

  useEffect(() => {
    void Promise.all([fetchStatus(), fetchTools()]).finally(() => setLoading(false));
    // Poll status every 3s for wake word state changes
    const interval = setInterval(() => void fetchStatus(), 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchTools]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center">
        <div className="text-slate-600 text-sm font-mono animate-pulse">Connecting to Gigi…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090f] text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-800 flex items-center justify-center">
            <span className="text-white text-sm font-black">G</span>
          </div>
          <span className="font-black text-white tracking-tight">Gigi</span>
          <span className="text-xs text-slate-600 font-mono">v{status?.version ?? '1.0.0'}</span>
        </div>

        <div className="flex items-center gap-4">
          {status && (
            <WakeIndicator
              state={status.wakeState}
              word={status.wakeWord}
            />
          )}
          <a
            href="/settings"
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Settings
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-6">

        {/* Left column — providers + wake */}
        <div className="col-span-1 space-y-6">

          {/* Providers */}
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Providers</h2>
            <div className="flex flex-wrap gap-2">
              {status ? (
                Object.entries(status.providers).map(([name, connected]) => (
                  <ProviderBadge key={name} name={name} connected={connected} />
                ))
              ) : (
                <span className="text-xs text-slate-600">Not connected</span>
              )}
            </div>
            <a
              href="/setup"
              className="block text-center text-xs py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 transition-colors"
            >
              + Add provider
            </a>
          </section>

          {/* Quick actions */}
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick actions</h2>
            {[
              { icon: '🗺️', label: 'Knowledge Graph',  href: '/intelligence' },
              { icon: '🔧', label: 'Skills & Tools',   href: '/skills' },
              { icon: '⚙️', label: 'Settings',         href: '/settings' },
              { icon: '🔁', label: 'Workflows',        href: '/routines' },
            ].map(item => (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 px-3 py-2.5 transition-colors group"
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{item.label}</span>
              </a>
            ))}
          </section>

          {/* Startup status */}
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Auto-start</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                status?.startupInstalled
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-slate-800 text-slate-500'
              }`}>
                {status?.startupInstalled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {!status?.startupInstalled && (
              <a
                href="/setup"
                className="mt-3 block text-center text-xs py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                Enable auto-start
              </a>
            )}
          </section>
        </div>

        {/* Centre column — Jarvis tools */}
        <div className="col-span-1 space-y-6">
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Jarvis Tools
              </h2>
              <span className="text-[10px] text-slate-600 font-mono">{tools.length} active</span>
            </div>
            {tools.length > 0 ? (
              <ToolList tools={tools} />
            ) : (
              <p className="text-xs text-slate-600">Daemon not running. Start Gigi to see tools.</p>
            )}
          </section>
        </div>

        {/* Right column — OpenHuman integrations */}
        <div className="col-span-1 space-y-6">
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Integrations
              </h2>
              <span className="text-[10px] text-slate-600 font-mono">via OpenHuman</span>
            </div>
            {ohTools.length > 0 ? (
              <ToolList tools={ohTools} />
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Start the OpenHuman core on port 9300 to activate 118+ integrations.
                </p>
                <div className="rounded-lg bg-slate-800/40 px-3 py-2 font-mono text-[10px] text-slate-500">
                  openhuman-core mcp --port 9300
                </div>
              </div>
            )}
          </section>

          {/* Knowledge graph mini */}
          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Knowledge Graph</h2>
            <a
              href="/intelligence"
              className="block rounded-xl bg-[#0a0a0f] border border-slate-800 h-32 flex items-center justify-center hover:border-violet-700 transition-colors group"
            >
              <div className="text-center">
                <div className="text-2xl mb-1">🧠</div>
                <div className="text-xs text-slate-600 group-hover:text-slate-400 transition-colors">
                  Open live graph →
                </div>
              </div>
            </a>
          </section>
        </div>

      </main>
    </div>
  );
}
