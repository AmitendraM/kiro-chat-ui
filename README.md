# Kiro Chat UI

A web-based chat interface for [kiro-cli](https://kiro.dev), providing a modern UI with full access to your Kiro profile, MCP tools, and all configured agents.

## Features

- 💬 **Conversational AI** — Full session persistence via `--resume-id`
- 🤖 **Multi-agent** — Switch between configured agents
- 🧠 **Multi-model** — Choose from Claude Opus, Sonnet, Haiku, and more
- 📷 **Screen capture** — Capture and crop screenshots to send to Kiro
- 📎 **File attachments** — Drag & drop or pick any file (images, code, docs)
- 🎤 **Voice input** — Speech-to-text via browser API
- ⚡ **Tool call visibility** — Collapsible view of MCP tool invocations
- 📋 **Markdown rendering** — Code blocks, tables, lists, links
- 🔍 **Session history** — Searchable sidebar with past conversations
- ⬇️ **Export** — Download conversations as markdown
- 📝 **Prompt templates** — Save and reuse common prompts
- 🌙 **Dark/Light theme** — Toggleable, persists in localStorage
- ⌨️ **Keyboard shortcuts** — Ctrl+K, Ctrl+N, Ctrl+/
- `/commands` — Slash commands for quick actions

## Prerequisites

- **Node.js** v14 or higher
- **kiro-cli** installed and logged in (`kiro-cli login`)

## Quick Start

```bash
git clone https://github.com/<your-username>/kiro-chat-ui.git
cd kiro-chat-ui
npm install
```

### Run

```bash
./kiro-chat.sh start
```

Or manually:
```bash
node server.js
```

Open http://localhost:3000 in your browser.

### Commands

```bash
npm start      # Start the server
npm stop       # Stop the server
npm restart    # Restart
npm run status # Check if running
```

## How It Works

1. The Node.js server spawns `kiro-cli chat` as a child process
2. Browser sends messages via HTTP POST to the server API
3. Server pipes input to kiro-cli's stdin and captures stdout response
4. Server parses kiro-cli's ANSI output into structured JSON
5. Frontend renders markdown, tool calls, and manages sessions

## Architecture

```
Browser (index.html)
    ↕ HTTP POST/GET
Node.js Server (server.js)
    ↕ stdio
kiro-cli chat --resume-id <session>
```

## Project Structure

```
kiro-chat-ui/
├── index.html         # Single-page frontend (vanilla JS + HTML)
├── server.js          # Node.js WebSocket server
├── kiro-chat.sh       # Service management script (start/stop/restart)
├── install.sh         # Setup script
├── manifest.json      # PWA manifest
├── marked.min.js      # Markdown parser (vendored)
└── package.json
```

## Troubleshooting

**Server won't start:**
Ensure `kiro-cli` is in your PATH and authenticated (`kiro-cli login`).

**Blank responses:**
Check `debug.log` for ANSI parsing issues.

**Session not resuming:**
Run `kiro-cli chat --list-sessions` to verify sessions exist.

## License

MIT
