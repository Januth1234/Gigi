/**
 * KnowledgeGraph.tsx
 *
 * Live neural-network-style knowledge graph visualisation.
 * Nodes appear and connect in real time as the crawler discovers the disk.
 * Uses d3-force for physics simulation and canvas for performance.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeKind = 'file' | 'directory' | 'app' | 'person' | 'concept' | 'domain' | 'project' | 'config';

type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
};

type CrawlProgress = {
  phase: 'scanning' | 'reading' | 'linking' | 'done';
  scanned: number;
  total: number;
  currentPath: string;
  nodesAdded: number;
  edgesAdded: number;
  newNode?: GraphNode;
  newEdge?: { id: string; source: string; target: string; weight: number };
};

type KnowledgeGraphProps = {
  apiBase?: string;
  onComplete?: (nodeCount: number, edgeCount: number) => void;
};

// ─── Colour palette ───────────────────────────────────────────────────────────

const KIND_COLOR: Record<NodeKind, string> = {
  app:       '#a78bfa', // violet
  project:   '#34d399', // emerald
  directory: '#60a5fa', // blue
  file:      '#94a3b8', // slate
  config:    '#fbbf24', // amber
  concept:   '#f472b6', // pink
  person:    '#fb923c', // orange
  domain:    '#38bdf8', // sky
};

// ─── Physics simulation (simple Verlet) ──────────────────────────────────────

const REPULSION = 800;
const ATTRACTION = 0.004;
const DAMPING = 0.88;
const IDEAL_EDGE_LEN = 120;

function simTick(nodes: Map<string, GraphNode>, edges: GraphEdge[], w: number, h: number): void {
  const nodeArr = Array.from(nodes.values());

  // Repulsion between all pairs
  for (let i = 0; i < nodeArr.length; i++) {
    for (let j = i + 1; j < nodeArr.length; j++) {
      const a = nodeArr[i]!;
      const b = nodeArr[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy + 1;
      const force = REPULSION / dist2;
      const dist = Math.sqrt(dist2);
      a.vx -= (dx / dist) * force;
      a.vy -= (dy / dist) * force;
      b.vx += (dx / dist) * force;
      b.vy += (dy / dist) * force;
    }
  }

  // Attraction along edges
  for (const edge of edges) {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (!src || !tgt) continue;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const stretch = dist - IDEAL_EDGE_LEN;
    const force = ATTRACTION * stretch * edge.weight;
    src.vx += dx * force;
    src.vy += dy * force;
    tgt.vx -= dx * force;
    tgt.vy -= dy * force;
  }

  // Centre gravity
  const cx = w / 2, cy = h / 2;
  for (const n of nodeArr) {
    n.vx += (cx - n.x) * 0.0003;
    n.vy += (cy - n.y) * 0.0003;
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }
}

// ─── Canvas renderer ─────────────────────────────────────────────────────────

function renderGraph(
  ctx: CanvasRenderingContext2D,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  w: number,
  h: number,
  hovered: string | null,
): void {
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, w, h);

  // Subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Edges
  for (const edge of edges) {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (!src || !tgt) continue;

    const alpha = edge.weight * 0.35;
    ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
    ctx.lineWidth = edge.weight * 1.5;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.stroke();
  }

  // Nodes
  for (const node of nodes.values()) {
    const r = 4 + node.weight * 10;
    const color = KIND_COLOR[node.kind] ?? '#94a3b8';
    const isHovered = node.id === hovered;

    // Glow
    if (isHovered || node.weight > 0.7) {
      const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
      grad.addColorStop(0, color + '55');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Node circle
    ctx.fillStyle = isHovered ? '#ffffff' : color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, isHovered ? r + 2 : r, 0, Math.PI * 2);
    ctx.fill();

    // Label for important/hovered nodes
    if (node.weight > 0.6 || isHovered) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = isHovered ? '600 11px monospace' : '10px monospace';
      ctx.textAlign = 'center';
      const maxLen = 18;
      const label = node.label.length > maxLen ? node.label.slice(0, maxLen) + '…' : node.label;
      ctx.fillText(label, node.x, node.y - r - 5);
    }
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KnowledgeGraph({ apiBase = 'http://127.0.0.1:3142', onComplete }: KnowledgeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, GraphNode>>(new Map());
  const edgesRef = useRef<GraphEdge[]>([]);
  const rafRef = useRef<number>(0);
  const hoveredRef = useRef<string | null>(null);

  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [phase, setPhase] = useState<string>('idle');
  const [isRunning, setIsRunning] = useState(false);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function loop() {
      const w = canvas!.width;
      const h = canvas!.height;
      simTick(nodesRef.current, edgesRef.current, w, h);
      renderGraph(ctx!, nodesRef.current, edgesRef.current, w, h, hoveredRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    });
    obs.observe(canvas);
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    return () => obs.disconnect();
  }, []);

  // Mouse hover detection
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let closest: string | null = null;
    let minDist = 20;
    for (const node of nodesRef.current.values()) {
      const d = Math.hypot(node.x - mx, node.y - my);
      if (d < minDist) { minDist = d; closest = node.id; }
    }
    hoveredRef.current = closest;
  }, []);

  // Start crawl
  const startCrawl = useCallback(async () => {
    setIsRunning(true);
    setPhase('scanning');
    nodesRef.current.clear();
    edgesRef.current = [];

    // Start the SSE stream for live progress
    const source = new EventSource(`${apiBase}/api/gigi/knowledge/crawl`);

    source.onmessage = (e) => {
      try {
        const prog: CrawlProgress = JSON.parse(e.data);
        setProgress(prog);
        setPhase(prog.phase);

        if (prog.newNode) {
          const canvas = canvasRef.current;
          const w = canvas?.width ?? 800;
          const h = canvas?.height ?? 600;
          const existing = nodesRef.current.get(prog.newNode.id);
          if (!existing) {
            nodesRef.current.set(prog.newNode.id, {
              ...prog.newNode,
              x: w / 2 + (Math.random() - 0.5) * 200,
              y: h / 2 + (Math.random() - 0.5) * 200,
              vx: (Math.random() - 0.5) * 2,
              vy: (Math.random() - 0.5) * 2,
            });
          }
        }

        if (prog.newEdge) {
          edgesRef.current.push(prog.newEdge);
        }

        if (prog.phase === 'done') {
          source.close();
          setIsRunning(false);
          onComplete?.(prog.nodesAdded, prog.edgesAdded);
        }
      } catch { /* parse error — skip */ }
    };

    source.onerror = () => {
      source.close();
      setIsRunning(false);
    };

    // Trigger the crawl
    await fetch(`${apiBase}/api/gigi/knowledge/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxFiles: 8000 }),
    }).catch(() => { /* server may not be up yet — SSE handles error */ });
  }, [apiBase, onComplete]);

  const phaseLabel: Record<string, string> = {
    idle: 'Ready to scan',
    scanning: 'Scanning your system…',
    reading: 'Reading files…',
    linking: 'Building connections…',
    done: 'Knowledge graph complete',
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${phase === 'done' ? 'text-emerald-400' : 'text-violet-400'}`}>
            {phaseLabel[phase] ?? phase}
          </span>
          {progress && (
            <>
              <span className="text-xs text-slate-500">
                {progress.nodesAdded.toLocaleString()} nodes
              </span>
              <span className="text-xs text-slate-500">
                {progress.edgesAdded.toLocaleString()} edges
              </span>
            </>
          )}
        </div>
        {!isRunning && (
          <button
            onClick={() => void startCrawl()}
            className="text-xs px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
          >
            {phase === 'done' ? 'Rescan' : 'Start scan'}
          </button>
        )}
      </div>

      {/* Current path ticker */}
      {progress?.currentPath && (
        <div className="text-[10px] text-slate-600 font-mono truncate px-1">
          {progress.currentPath}
        </div>
      )}

      {/* Progress bar */}
      {isRunning && progress && (
        <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${Math.min(100, (progress.scanned / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        className="flex-1 rounded-xl cursor-crosshair"
        style={{ background: '#0a0a0f', minHeight: 400 }}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {Object.entries(KIND_COLOR).map(([kind, color]) => (
          <div key={kind} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
            <span className="text-[10px] text-slate-500">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
