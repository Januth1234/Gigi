/**
 * Gigi Wake Word Engine
 *
 * Listens passively for "Gigi", the short keyword "G", and any user-defined
 * keywords. When triggered, activates the main voice pipeline.
 *
 * Uses the Web Speech API in the browser layer (streamed from the UI) and
 * a simple phonetic matching algorithm so it works without a cloud call.
 *
 * The actual mic capture lives in the frontend (app/src/features/wakeword).
 * This module handles the server-side keyword management and state.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type WakeConfig = {
  /** Primary name — always active. Default: "gigi" */
  name: string;
  /** Short alias — always active. Default: "g" */
  shortAlias: string;
  /** User-defined extra keywords */
  customKeywords: string[];
  /** Minimum confidence 0-1 to trigger (for STT-based detection) */
  confidence: number;
};

const DEFAULT_CONFIG: WakeConfig = {
  name: 'gigi',
  shortAlias: 'g',
  customKeywords: [],
  confidence: 0.7,
};

const CONFIG_PATH = join(homedir(), '.gigi', 'wake.json');

// ─── Persistence ────────────────────────────────────────────────────────────

export function loadWakeConfig(): WakeConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveWakeConfig(config: WakeConfig): void {
  const dir = join(homedir(), '.gigi');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Matching ───────────────────────────────────────────────────────────────

/**
 * Normalise a transcript fragment for matching.
 * Lowercases, strips punctuation, collapses whitespace.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Check whether a transcript fragment contains a wake trigger.
 * Returns the matched keyword or null.
 */
export function detectWakeWord(
  transcript: string,
  config: WakeConfig,
): string | null {
  const norm = normalise(transcript);
  const words = norm.split(' ');

  const keywords = [
    config.name.toLowerCase(),
    config.shortAlias.toLowerCase(),
    ...config.customKeywords.map(k => k.toLowerCase()),
  ];

  for (const kw of keywords) {
    if (kw.length <= 2) {
      // Short keywords: require it as an isolated word to avoid false positives
      if (words.includes(kw)) return kw;
    } else {
      if (norm.includes(kw)) return kw;
    }
  }

  return null;
}

// ─── State ─────────────────────────────────────────────────────────────────

type WakeState = 'passive' | 'active' | 'processing';

export class WakeWordEngine {
  private state: WakeState = 'passive';
  private config: WakeConfig;
  private listeners: Map<string, () => void> = new Map();
  private deactivateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ACTIVE_TIMEOUT_MS = 10_000; // auto-deactivate after 10s silence

  constructor(config?: Partial<WakeConfig>) {
    this.config = { ...loadWakeConfig(), ...config };
  }

  getState(): WakeState {
    return this.state;
  }

  getConfig(): WakeConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<WakeConfig>): void {
    this.config = { ...this.config, ...patch };
    saveWakeConfig(this.config);
  }

  /**
   * Feed a transcript fragment from the STT stream.
   * Returns true if the wake word was detected and state changed to active.
   */
  processTranscript(transcript: string, confidence = 1.0): boolean {
    if (this.state === 'processing') return false;

    const matched = detectWakeWord(transcript, this.config);

    if (matched) {
      if (confidence < this.config.confidence) return false;
      this.activate(matched);
      return true;
    }

    return false;
  }

  private activate(trigger: string): void {
    console.log(`[WakeWord] Triggered by: "${trigger}" → active`);
    this.state = 'active';

    // Clear any pending auto-deactivate
    if (this.deactivateTimer) clearTimeout(this.deactivateTimer);

    // Auto-deactivate after silence window
    this.deactivateTimer = setTimeout(() => {
      this.deactivate();
    }, this.ACTIVE_TIMEOUT_MS);

    // Notify all listeners
    for (const [, cb] of this.listeners) cb();
  }

  deactivate(): void {
    this.state = 'passive';
    if (this.deactivateTimer) {
      clearTimeout(this.deactivateTimer);
      this.deactivateTimer = null;
    }
  }

  setProcessing(): void {
    this.state = 'processing';
    if (this.deactivateTimer) {
      clearTimeout(this.deactivateTimer);
      this.deactivateTimer = null;
    }
  }

  /**
   * Register a callback to be called when the wake word fires.
   * Returns an unsubscribe function.
   */
  onActivate(id: string, callback: () => void): () => void {
    this.listeners.set(id, callback);
    return () => this.listeners.delete(id);
  }
}

// Singleton exported for daemon use
export const wakeWordEngine = new WakeWordEngine();
