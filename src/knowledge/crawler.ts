/**
 * Gigi Knowledge Crawler
 *
 * Crawls the user's entire disk, extracts meaning from files and installed
 * apps, and builds a live knowledge graph streamed to the UI in real-time.
 *
 * The graph has nodes (files, apps, people, concepts) and typed edges.
 * All heavy work runs in small async batches so the UI stays responsive.
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

// ─── Types ─────────────────────────────────────────────────────────────────

export type NodeKind =
  | 'file'
  | 'directory'
  | 'app'
  | 'person'
  | 'concept'
  | 'domain'
  | 'project'
  | 'config';

export type KnowledgeNode = {
  id: string;
  kind: NodeKind;
  label: string;
  path?: string;
  metadata?: Record<string, unknown>;
  weight: number; // importance 0-1
  x?: number;
  y?: number;
};

export type EdgeKind =
  | 'contains'
  | 'references'
  | 'related_to'
  | 'authored_by'
  | 'part_of'
  | 'configures'
  | 'depends_on';

export type KnowledgeEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
};

export type KnowledgeGraph = {
  nodes: Map<string, KnowledgeNode>;
  edges: Map<string, KnowledgeEdge>;
};

export type CrawlProgress = {
  phase: 'scanning' | 'reading' | 'linking' | 'done';
  scanned: number;
  total: number;
  currentPath: string;
  nodesAdded: number;
  edgesAdded: number;
  newNode?: KnowledgeNode;
  newEdge?: KnowledgeEdge;
};

export type CrawlOptions = {
  roots?: string[];
  maxDepth?: number;
  maxFiles?: number;
  onProgress: (progress: CrawlProgress) => void;
};

// ─── Constants ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.cache',
  'dist', 'build', 'out', '.next', '.nuxt', 'vendor',
  'Library', 'System', 'proc', 'sys', 'dev', 'run',
  '.Trash', 'Trash', '$RECYCLE.BIN',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.org',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.cs', '.swift', '.kt',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf',
  '.html', '.css', '.scss', '.sql', '.sh', '.bash', '.zsh',
  '.xml', '.csv', '.log',
]);

const IMPORTANT_FILENAMES = new Set([
  'README.md', 'package.json', 'Cargo.toml', 'go.mod', 'requirements.txt',
  '.env', 'config.yaml', 'config.toml', 'docker-compose.yml', 'Makefile',
  'CHANGELOG.md', 'TODO.md', 'NOTES.md',
]);

let _nodeCounter = 0;
let _edgeCounter = 0;

function nodeId(): string { return `n${++_nodeCounter}`; }
function edgeId(): string { return `e${++_edgeCounter}`; }

// ─── App discovery ─────────────────────────────────────────────────────────

function discoverInstalledApps(): KnowledgeNode[] {
  const apps: KnowledgeNode[] = [];
  const os = platform();

  try {
    if (os === 'darwin') {
      const appDirs = ['/Applications', join(homedir(), 'Applications')];
      for (const dir of appDirs) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
          if (entry.endsWith('.app')) {
            apps.push({
              id: nodeId(),
              kind: 'app',
              label: entry.replace('.app', ''),
              path: join(dir, entry),
              weight: 0.8,
              metadata: { platform: 'macOS' },
            });
          }
        }
      }
    } else if (os === 'linux') {
      // Read .desktop files
      const desktopDirs = [
        '/usr/share/applications',
        join(homedir(), '.local/share/applications'),
      ];
      for (const dir of desktopDirs) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith('.desktop')) continue;
          try {
            const content = readFileSync(join(dir, entry), 'utf-8');
            const nameLine = content.split('\n').find(l => l.startsWith('Name=') && !l.startsWith('Name['));
            if (nameLine) {
              apps.push({
                id: nodeId(),
                kind: 'app',
                label: nameLine.replace('Name=', '').trim(),
                path: join(dir, entry),
                weight: 0.7,
                metadata: { platform: 'Linux' },
              });
            }
          } catch { /* skip unreadable */ }
        }
      }
    } else if (os === 'win32') {
      // Read from registry via PowerShell
      try {
        const result = execSync(
          'powershell -Command "Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName | ConvertTo-Json -Compress"',
          { timeout: 10000, encoding: 'utf-8' }
        );
        const items = JSON.parse(result) as Array<{ DisplayName?: string }>;
        for (const item of (Array.isArray(items) ? items : [items])) {
          if (item.DisplayName) {
            apps.push({
              id: nodeId(),
              kind: 'app',
              label: item.DisplayName,
              weight: 0.7,
              metadata: { platform: 'Windows' },
            });
          }
        }
      } catch { /* PowerShell not available or no results */ }
    }
  } catch { /* app discovery is best-effort */ }

  return apps;
}

// ─── File content extraction ───────────────────────────────────────────────

/** Extract up to 500 chars of meaningful text from a file. */
function extractSnippet(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return null;

  try {
    const stat = statSync(filePath);
    if (stat.size > 1_000_000) return null; // skip files > 1 MB

    const content = readFileSync(filePath, 'utf-8');
    // Strip common noise
    const clean = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/<!--[\s\S]*?-->/g, '')  // HTML comments
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    return clean || null;
  } catch {
    return null;
  }
}

/** Infer node kind from file path and name. */
function inferNodeKind(filePath: string): NodeKind {
  const name = basename(filePath).toLowerCase();
  if (name === 'package.json' || name === 'cargo.toml' || name === 'go.mod') return 'project';
  if (name.includes('config') || name.endsWith('.env') || name.endsWith('.conf')) return 'config';
  if (name.endsWith('.md') || name.endsWith('.txt')) return 'concept';
  return 'file';
}

// ─── Main crawler ─────────────────────────────────────────────────────────

export async function crawlKnowledgeGraph(options: CrawlOptions): Promise<KnowledgeGraph> {
  const {
    roots = [homedir()],
    maxDepth = 6,
    maxFiles = 10000,
    onProgress,
  } = options;

  const graph: KnowledgeGraph = {
    nodes: new Map(),
    edges: new Map(),
  };

  let scanned = 0;
  let total = 100; // updated as we discover

  function addNode(node: KnowledgeNode): void {
    graph.nodes.set(node.id, node);
    onProgress({
      phase: 'scanning',
      scanned,
      total,
      currentPath: node.path ?? node.label,
      nodesAdded: graph.nodes.size,
      edgesAdded: graph.edges.size,
      newNode: node,
    });
  }

  function addEdge(src: string, tgt: string, kind: EdgeKind, weight = 0.5): void {
    const edge: KnowledgeEdge = { id: edgeId(), source: src, target: tgt, kind, weight };
    graph.edges.set(edge.id, edge);
    onProgress({
      phase: 'scanning',
      scanned,
      total,
      currentPath: '',
      nodesAdded: graph.nodes.size,
      edgesAdded: graph.edges.size,
      newEdge: edge,
    });
  }

  // Phase 1 — discover installed apps
  onProgress({ phase: 'scanning', scanned: 0, total, currentPath: 'Discovering installed apps…', nodesAdded: 0, edgesAdded: 0 });
  const appNodes = discoverInstalledApps();
  for (const app of appNodes) {
    addNode(app);
    await new Promise(r => setTimeout(r, 2)); // yield to event loop
  }

  // Phase 2 — crawl file system
  async function crawlDir(dirPath: string, depth: number, parentId?: string): Promise<void> {
    if (depth > maxDepth || scanned >= maxFiles) return;

    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return; // permission denied or gone
    }

    const dirNode: KnowledgeNode = {
      id: nodeId(),
      kind: 'directory',
      label: basename(dirPath),
      path: dirPath,
      weight: depth <= 2 ? 0.6 : 0.3,
    };
    addNode(dirNode);
    if (parentId) addEdge(parentId, dirNode.id, 'contains');

    for (const entry of entries) {
      if (scanned >= maxFiles) break;
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;

      const fullPath = join(dirPath, entry);
      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(fullPath); } catch { continue; }

      scanned++;
      total = Math.max(total, scanned + 10);

      if (stat.isDirectory()) {
        await crawlDir(fullPath, depth + 1, dirNode.id);
      } else {
        const isImportant = IMPORTANT_FILENAMES.has(entry);
        const node: KnowledgeNode = {
          id: nodeId(),
          kind: inferNodeKind(fullPath),
          label: entry,
          path: fullPath,
          weight: isImportant ? 0.8 : 0.4,
          metadata: { size: stat.size, mtime: stat.mtime.getTime() },
        };

        // For important files, extract snippet
        if (isImportant || TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
          const snippet = extractSnippet(fullPath);
          if (snippet) (node.metadata as Record<string, unknown>).snippet = snippet;
        }

        addNode(node);
        addEdge(dirNode.id, node.id, 'contains');

        // Yield every 20 files so the UI gets updates
        if (scanned % 20 === 0) {
          await new Promise(r => setTimeout(r, 1));
        }
      }
    }
  }

  for (const root of roots) {
    if (existsSync(root)) {
      await crawlDir(root, 0);
    }
  }

  // Phase 3 — build semantic links between related nodes
  onProgress({ phase: 'linking', scanned, total, currentPath: 'Building semantic links…', nodesAdded: graph.nodes.size, edgesAdded: graph.edges.size });

  const nodeArr = Array.from(graph.nodes.values());

  // Link project files to their apps
  const projectNodes = nodeArr.filter(n => n.kind === 'project');
  const appNodesList = nodeArr.filter(n => n.kind === 'app');

  for (const proj of projectNodes) {
    const projName = basename(dirname(proj.path ?? '')).toLowerCase();
    for (const app of appNodesList) {
      if (app.label.toLowerCase().includes(projName) || projName.includes(app.label.toLowerCase())) {
        addEdge(proj.id, app.id, 'related_to', 0.7);
      }
    }
    await new Promise(r => setTimeout(r, 1));
  }

  onProgress({ phase: 'done', scanned, total: scanned, currentPath: '', nodesAdded: graph.nodes.size, edgesAdded: graph.edges.size });

  return graph;
}
