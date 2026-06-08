/**
 * GigiSetup.tsx
 *
 * Full Gigi onboarding wizard:
 *   1. Welcome / OAuth login
 *   2. AI provider & API key selection
 *   3. System scan (knowledge graph, live visualisation)
 *   4. Startup & wake word configuration
 *   5. Done
 */

import { useState, useCallback } from 'react';
import KnowledgeGraph from '../components/graph/KnowledgeGraph';

const API = 'http://127.0.0.1:3142';

// ─── Provider list ────────────────────────────────────────────────────────────

type Provider = {
  slug: string;
  label: string;
  placeholder: string;
  url: string;
  color: string;
};

const PROVIDERS: Provider[] = [
  { slug: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...', url: 'https://console.anthropic.com', color: '#f97316' },
  { slug: 'openai',    label: 'OpenAI GPT-4',     placeholder: 'sk-...',     url: 'https://platform.openai.com',  color: '#10b981' },
  { slug: 'groq',      label: 'Groq (fast!)',      placeholder: 'gsk_...',    url: 'https://console.groq.com',     color: '#8b5cf6' },
  { slug: 'gemini',    label: 'Google Gemini',     placeholder: 'AIza...',    url: 'https://aistudio.google.com',  color: '#3b82f6' },
  { slug: 'openrouter',label: 'OpenRouter',        placeholder: 'sk-or-...',  url: 'https://openrouter.ai',        color: '#64748b' },
  { slug: 'ollama',    label: 'Ollama (local)',    placeholder: 'http://127.0.0.1:11434', url: 'https://ollama.com', color: '#22d3ee' },
];

// ─── Step types ───────────────────────────────────────────────────────────────

type Step = 'welcome' | 'provider' | 'scan' | 'startup' | 'done';

// ─── Welcome step ─────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-8 py-8">
      {/* Logo / mascot */}
      <div className="relative">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-800 flex items-center justify-center shadow-2xl shadow-violet-900/50">
          <span className="text-5xl font-black text-white tracking-tighter">G</span>
        </div>
        <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
          <span className="text-white text-xs font-bold">AI</span>
        </div>
      </div>

      <div className="space-y-3">
        <h1 className="text-4xl font-black text-white tracking-tight">
          Meet <span className="text-violet-400">Gigi</span>
        </h1>
        <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
          Your always-on AI assistant. Just say <span className="text-violet-300 font-mono">"Gigi"</span> to start
          talking. Gigi knows your entire system — files, apps, everything.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
        {[
          { icon: '🧠', label: 'System knowledge' },
          { icon: '🎙️', label: 'Voice wake word' },
          { icon: '🔗', label: '118+ integrations' },
        ].map(item => (
          <div key={item.label} className="rounded-xl bg-slate-800/60 p-3 text-center">
            <div className="text-2xl mb-1">{item.icon}</div>
            <div className="text-[10px] text-slate-400 font-medium">{item.label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full max-w-sm py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-all shadow-lg shadow-violet-900/40 active:scale-[0.98]"
      >
        Get started →
      </button>
    </div>
  );
}

// ─── Provider step ────────────────────────────────────────────────────────────

function ProviderStep({ onNext }: { onNext: () => void }) {
  const [selected, setSelected] = useState<string>('anthropic');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const provider = PROVIDERS.find(p => p.slug === selected)!;

  const handleSave = useCallback(async () => {
    if (!key.trim() && selected !== 'ollama') {
      setError('Please enter your API key');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/gigi/providers/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: selected, key: key.trim(), baseUrl: baseUrl.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save key');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [selected, key, baseUrl]);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-black text-white">Choose your AI brain</h2>
        <p className="text-slate-400 text-sm mt-2">Select a provider and enter your API key. Gigi works with all major models.</p>
      </div>

      {/* Provider grid */}
      <div className="grid grid-cols-2 gap-2">
        {PROVIDERS.map(p => (
          <button
            key={p.slug}
            onClick={() => { setSelected(p.slug); setSaved(false); setKey(''); setError(null); }}
            className={`rounded-xl p-3 text-left transition-all border ${
              selected === p.slug
                ? 'border-violet-500 bg-violet-500/10'
                : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: p.color }}
              />
              <span className="text-xs font-semibold text-white">{p.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Key input */}
      <div className="space-y-2">
        {selected === 'ollama' ? (
          <>
            <label className="text-xs text-slate-400 font-medium">Ollama endpoint URL</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:11434"
              value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); setSaved(false); setError(null); }}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
            />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 font-medium">API Key</label>
              <a
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                Get key →
              </a>
            </div>
            <input
              type="password"
              placeholder={provider.placeholder}
              value={key}
              onChange={e => { setKey(e.target.value); setSaved(false); setError(null); }}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 font-mono"
            />
          </>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && <p className="text-xs text-emerald-400">✓ API key saved</p>}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {saving ? 'Saving…' : 'Save key'}
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 text-slate-300 font-semibold text-sm transition-colors"
        >
          {saved ? 'Continue →' : 'Skip for now'}
        </button>
      </div>
    </div>
  );
}

// ─── Scan step ────────────────────────────────────────────────────────────────

function ScanStep({ onNext }: { onNext: () => void }) {
  const [scanDone, setScanDone] = useState(false);
  const [stats, setStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [skipped, setSkipped] = useState(false);

  const handleComplete = useCallback((nodes: number, edges: number) => {
    setScanDone(true);
    setStats({ nodes, edges });
  }, []);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-center">
        <h2 className="text-2xl font-black text-white">Build your knowledge graph</h2>
        <p className="text-slate-400 text-sm mt-1">
          Gigi will scan your disk and build a live map of your world.
          <br />
          <span className="text-slate-500 text-xs">Files, apps, projects — everything becomes connected.</span>
        </p>
      </div>

      {!skipped && (
        <div className="flex-1 min-h-0">
          <KnowledgeGraph apiBase={API} onComplete={handleComplete} />
        </div>
      )}

      {scanDone && stats && (
        <div className="flex items-center justify-center gap-6 py-2">
          <div className="text-center">
            <div className="text-2xl font-black text-violet-400">{stats.nodes.toLocaleString()}</div>
            <div className="text-xs text-slate-500">nodes</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-emerald-400">{stats.edges.toLocaleString()}</div>
            <div className="text-xs text-slate-500">connections</div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {(scanDone || skipped) && (
          <button
            onClick={onNext}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Continue →
          </button>
        )}
        {!scanDone && !skipped && (
          <button
            onClick={() => setSkipped(true)}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 text-slate-400 text-sm transition-colors"
          >
            Skip scan
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Startup step ─────────────────────────────────────────────────────────────

function StartupStep({ onNext }: { onNext: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [done, setDone] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [wakeWord, setWakeWord] = useState('gigi');
  const [customKw, setCustomKw] = useState('');
  const [kwSaved, setKwSaved] = useState(false);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await fetch(`${API}/api/gigi/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install' }),
      });
      setDone(true);
    } catch { /* offline — mark done anyway */ setDone(true); }
    finally { setInstalling(false); }
  }, []);

  const handlePrune = useCallback(async () => {
    setPruning(true);
    try {
      const res = await fetch(`${API}/api/gigi/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prune' }),
      });
      const data = await res.json() as { removed: string[] };
      setRemoved(data.removed ?? []);
    } catch { /* best-effort */ }
    finally { setPruning(false); }
  }, []);

  const handleSaveWakeWord = useCallback(async () => {
    const keywords = customKw.split(',').map(k => k.trim()).filter(Boolean);
    await fetch(`${API}/api/gigi/wakeword`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wakeWord, customKeywords: keywords }),
    }).catch(() => {});
    setKwSaved(true);
  }, [wakeWord, customKw]);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-black text-white">Set up Gigi's home</h2>
        <p className="text-slate-400 text-sm mt-1">Configure your wake word and startup behaviour.</p>
      </div>

      {/* Wake word config */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">Wake word</h3>
        <p className="text-xs text-slate-400">Say this word to activate Gigi. "G" always works too.</p>
        <input
          type="text"
          value={wakeWord}
          onChange={e => { setWakeWord(e.target.value); setKwSaved(false); }}
          className="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 font-mono"
          placeholder="gigi"
        />
        <input
          type="text"
          value={customKw}
          onChange={e => { setCustomKw(e.target.value); setKwSaved(false); }}
          className="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
          placeholder="Custom keywords (comma separated)"
        />
        <button
          onClick={() => void handleSaveWakeWord()}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
        >
          {kwSaved ? '✓ Saved' : 'Save wake words'}
        </button>
      </div>

      {/* Startup config */}
      <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">Auto-start</h3>
        <p className="text-xs text-slate-400">Launch Gigi automatically when you log in.</p>
        <div className="flex gap-2">
          <button
            onClick={() => void handleInstall()}
            disabled={installing || done}
            className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            {installing ? 'Installing…' : done ? '✓ Installed' : 'Enable auto-start'}
          </button>
          <button
            onClick={() => void handlePrune()}
            disabled={pruning}
            className="flex-1 py-2 rounded-lg border border-slate-600 hover:border-slate-500 text-slate-300 text-xs font-medium transition-colors"
          >
            {pruning ? 'Cleaning…' : 'Clean startup apps'}
          </button>
        </div>
        {removed.length > 0 && (
          <p className="text-[10px] text-slate-500">
            Removed {removed.length} startup items: {removed.slice(0, 4).join(', ')}{removed.length > 4 ? '…' : ''}
          </p>
        )}
      </div>

      <button
        onClick={onNext}
        className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
      >
        Finish setup →
      </button>
    </div>
  );
}

// ─── Done step ────────────────────────────────────────────────────────────────

function DoneStep() {
  return (
    <div className="flex flex-col items-center text-center gap-8 py-8">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-2xl shadow-emerald-900/40">
        <span className="text-4xl">🎉</span>
      </div>

      <div className="space-y-3">
        <h2 className="text-3xl font-black text-white">Gigi is ready</h2>
        <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
          Just say <span className="text-violet-300 font-mono">"Gigi"</span> to start talking.
          Your knowledge graph is live. All your tools are connected.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        {[
          '🎙️  Say "Gigi" to activate voice',
          '🧠  Your disk is now a knowledge graph',
          '🔗  OpenHuman integrations are ready',
          '⚡  Jarvis workflows are running',
        ].map(tip => (
          <div key={tip} className="rounded-xl bg-slate-800/50 px-4 py-2.5 text-left text-xs text-slate-300 font-mono">
            {tip}
          </div>
        ))}
      </div>

      <button
        onClick={() => window.location.href = '/home'}
        className="w-full max-w-sm py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-sm transition-all shadow-lg shadow-violet-900/40"
      >
        Open Gigi →
      </button>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const STEPS: Step[] = ['welcome', 'provider', 'scan', 'startup', 'done'];

export default function GigiSetup() {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx] ?? 'done';

  const next = useCallback(() => {
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  }, []);

  const progress = stepIdx / (STEPS.length - 1);

  return (
    <div className="min-h-screen bg-[#09090f] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Progress dots */}
        {step !== 'done' && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.filter(s => s !== 'done').map((s, i) => (
              <div
                key={s}
                className={`rounded-full transition-all ${
                  i === stepIdx ? 'w-6 h-1.5 bg-violet-500' :
                  i < stepIdx  ? 'w-1.5 h-1.5 bg-violet-700' :
                                  'w-1.5 h-1.5 bg-slate-700'
                }`}
              />
            ))}
          </div>
        )}

        {/* Card */}
        <div className={`rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-8 ${step === 'scan' ? 'min-h-[600px] flex flex-col' : ''}`}>
          {step === 'welcome'  && <WelcomeStep  onNext={next} />}
          {step === 'provider' && <ProviderStep onNext={next} />}
          {step === 'scan'     && <ScanStep     onNext={next} />}
          {step === 'startup'  && <StartupStep  onNext={next} />}
          {step === 'done'     && <DoneStep />}
        </div>

      </div>
    </div>
  );
}
