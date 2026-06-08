# Gigi — Your Always-On AI System

> Say **"Gigi"** to start. Say **"G"** as a shortcut. Add any keyword you want.

Gigi is a fully integrated AI assistant built by fusing **J.A.R.V.I.S.** (workflow engine, 1300+ tests, MCP server) with **OpenHuman** (118+ Composio integrations, memory tree, Tauri desktop shell) into a single coherent system.

---

## What Gigi Does

| Feature | Description |
|---|---|
| 🎙️ **Wake word** | Say "Gigi" / "G" / custom keyword → AI activates |
| 🧠 **Knowledge graph** | Crawls your entire disk, builds a live neural-network map of files, apps, projects |
| 🔗 **118+ integrations** | Gmail, Notion, Slack, GitHub, Jira, Linear, and more via OpenHuman/Composio |
| ⚡ **Jarvis tool engine** | Shell execution, browser control, sidecar apps, workflow automation |
| 🤖 **Multi-provider AI** | Anthropic, OpenAI, Groq, Gemini, OpenRouter, Ollama, and 10+ more |
| 🚀 **Startup management** | Registers itself at login, optionally prunes redundant startup apps |
| 🔒 **Local-first** | Knowledge graph and memory stay on your machine |

---

## Architecture

```
gigi/
├── src/                      ← Bun daemon (from Jarvis)
│   ├── daemon/
│   │   ├── api-routes.ts     ← REST API + MCP server + Gigi routes
│   │   ├── gigi-routes.ts    ← NEW: /api/gigi/* routes
│   │   └── mcp-handler.ts    ← JSON-RPC MCP server
│   ├── knowledge/
│   │   └── crawler.ts        ← NEW: disk crawler + knowledge graph builder
│   ├── startup/
│   │   └── manager.ts        ← NEW: macOS/Linux/Windows startup management
│   ├── wakeword/
│   │   └── engine.ts         ← NEW: wake word detection engine
│   ├── actions/tools/
│   │   ├── builtin.ts        ← All Jarvis tools (shell, fs, screen, etc.)
│   │   └── openhuman.ts      ← NEW: OpenHuman MCP client tools
│   └── agents/
│       └── orchestrator.ts   ← Multi-agent orchestration
│
└── app/                      ← React/Tauri frontend (from OpenHuman)
    └── src/
        ├── pages/
        │   ├── GigiSetup.tsx      ← NEW: 5-step onboarding wizard
        │   ├── GigiDashboard.tsx  ← NEW: Main dashboard with live status
        │   └── Intelligence.tsx   ← Extended with Knowledge Graph tab
        ├── components/
        │   └── graph/
        │       └── KnowledgeGraph.tsx ← NEW: Live neural graph canvas
        └── AppRoutes.tsx          ← /setup and /gigi routes added
```

---

## Setup (Development)

### Prerequisites
- **Bun** ≥ 1.0 — `npm install -g bun`
- **Node.js** ≥ 18
- **pnpm** ≥ 8 — `npm install -g pnpm`
- *(For Rust backend)* Rust ≥ 1.93 via rustup

### 1. Install daemon dependencies
```bash
cd gigi
bun install
```

### 2. Install frontend dependencies
```bash
cd gigi/app
pnpm install
```

### 3. Configure your AI provider
Copy the example config and add your API key:
```bash
cp config.example.yaml ~/.gigi/config.yaml
# Edit ~/.gigi/config.yaml and add your key, or use the /setup wizard
```

### 4. Run the daemon
```bash
cd gigi
bun run dev
# Daemon starts on http://127.0.0.1:3142
```

### 5. Run the frontend
```bash
cd gigi/app
pnpm run dev:web
# Frontend starts on http://localhost:5173
# Navigate to /setup for the first-run wizard
```

---

## First Run (End-User Flow)

When users open Gigi for the first time they see the **5-step setup wizard** at `/setup`:

1. **Welcome** — Introduction to Gigi
2. **AI Provider** — Pick from 12 providers, enter API key
3. **System Scan** — Live knowledge graph crawl with real-time neural visualisation
4. **Startup & Wake Word** — Set wake keyword, enable auto-start, prune startup apps
5. **Done** — Gigi is ready

After setup, users land on the **Gigi Dashboard** (`/gigi`) which shows:
- Wake word status (passive / listening / processing)
- Connected AI providers
- Live Jarvis tool list (via MCP)
- OpenHuman integration status

---

## Wake Word

Gigi listens passively. Triggers:
- **"Gigi"** — primary wake word (always active)
- **"G"** — short alias (always active)
- **Custom keywords** — configured in setup or via `PATCH /api/gigi/wakeword`

The wake word engine receives transcript fragments from the browser's Web Speech API via `POST /api/gigi/wakeword/transcript`.

---

## API Reference

### Gigi System APIs (`/api/gigi/`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/gigi/status` | GET | System status, wake state, providers |
| `/api/gigi/providers` | GET | List of 12 supported AI providers |
| `/api/gigi/providers/key` | POST | Save an API key for a provider |
| `/api/gigi/wakeword` | GET | Current wake word config + state |
| `/api/gigi/wakeword` | PATCH | Update wake words |
| `/api/gigi/wakeword/transcript` | POST | Feed STT transcript for wake detection |
| `/api/gigi/knowledge/crawl` | GET | SSE stream of live crawl progress |
| `/api/gigi/knowledge/crawl` | POST | Start a new disk crawl |
| `/api/gigi/startup` | GET | List startup entries |
| `/api/gigi/startup` | POST | Install Gigi at login or prune entries |

### MCP Server (`/api/mcp`)

| Method | Description |
|---|---|
| `initialize` | Protocol negotiation |
| `tools/list` | All Jarvis + OpenHuman tools |
| `tools/call` | Execute any tool |

OpenHuman connects to Gigi via:
```toml
# ~/.openhuman/users/<id>/config.toml
[[mcp_client.servers]]
name = "gigi"
endpoint = "http://127.0.0.1:3142/api/mcp"
```

---

## Knowledge Graph

The knowledge graph crawls:
- Your home directory (configurable roots)
- Installed applications (macOS `.app`, Linux `.desktop`, Windows registry)
- File metadata, project files, config files
- Extracts text snippets from important files

Nodes are physics-simulated on a dark canvas using Verlet integration.
Node colours indicate kind: apps (violet), projects (emerald), directories (blue), config (amber), etc.

The graph streams live over SSE — nodes appear and connect in real-time as the crawler progresses.

---

## Supported AI Providers

| Provider | Key Format | Notes |
|---|---|---|
| Anthropic | `sk-ant-...` | Claude 3.5 Sonnet, Opus, Haiku |
| OpenAI | `sk-...` | GPT-4o, o1, o3 |
| Groq | `gsk_...` | Ultra-fast Llama, Mixtral |
| Google Gemini | `AIza...` | Gemini 1.5 Pro, Flash |
| OpenRouter | `sk-or-...` | 200+ models in one key |
| Ollama | endpoint URL | Local models, fully private |
| NVIDIA NIM | `nvapi-...` | Enterprise GPU inference |
| Fireworks AI | `fw-...` | Fast open-source models |
| Together AI | `sk-...` | Fine-tuned models |
| LiteLLM | endpoint URL | Proxy for any provider |
| OpenAI-compatible | endpoint URL | Any OpenAI-compatible API |

---

## Tests

```bash
# Full test suite (1359 tests from Jarvis)
cd gigi && bun test

# MCP server unit tests only
bun test src/daemon/mcp.test.ts

# Frontend TypeScript check
cd gigi/app && pnpm exec tsc --noEmit
```

---

## Credits

Built on top of:
- **J.A.R.V.I.S.** — Always-on daemon, tool engine, workflow system
- **OpenHuman** — Tauri desktop shell, Composio integrations, memory system, mascot UI
- **MCP** — Model Context Protocol for bidirectional tool sharing
