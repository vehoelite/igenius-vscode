# iGenius Memory for VS Code

> Persistent AI memory for your coding agents. Browse, search, promote, and manage short-term and long-term memories right from VS Code.

![iGenius Memory](https://igenius-memory.com/og-preview.png)

## Features

### 🧠 Memory Browser Sidebar
Click the brain icon in the Activity Bar to open the Memory Browser. Browse all three memory layers:

- **Long-term** — Your curated knowledge base (365-day retention). Importance badges, category tags, and expandable cards.
- **Short-term** — Auto-captured facts, decisions, and context. Promote what matters, discard the rest.
- **Persistent** — Ephemeral session memories (8h TTL). Current working context.

### 📋 Intelligence Briefing
Generate an AI-powered briefing that distills your entire memory state into a concise report. Press `Ctrl+Shift+B` or click "Generate Briefing" in the sidebar.

### 🔍 Memory Search
Search across all memory layers with `Ctrl+Shift+M`. Results show in a quick pick with layer badges and importance scores.

### ☁️ Ingest from Editor
Select any text and press `Ctrl+Shift+I` (or right-click → "Ingest Selected Text") to send it to your memory. The AI engine extracts facts, assigns importance, and categorizes automatically.

### 📊 Status Bar
Real-time memory count in the status bar showing Persistent / Long-term / Short-term breakdown.

### ⬆️ Promote & 🗑️ Delete
Manage memories directly from the sidebar. Promote short-term catches to long-term, or delete what you don't need.

### 🔧 Setup Wizard
First-time users get a guided setup wizard that:
1. Configures your API key
2. Installs the MCP server (`pip install igenius-mcp`) and writes `mcp.json`
3. Installs agent instructions for Copilot / Claude

Re-run anytime via **iGenius: Run Setup Wizard** in the command palette.

## Getting Started

1. **Install** the extension from the VS Code Marketplace (or `.vsix`)
2. **Run the setup wizard** — it launches automatically on first install, or run `iGenius: Run Setup Wizard`
3. **Get a free API key** at [igenius-memory.online](https://igenius-memory.online#apikey)
4. **Open the sidebar** — click the 🧠 brain icon in the Activity Bar

### MCP Server (Optional)

For full agent integration (Copilot Chat, Claude, etc.), install the MCP bridge:

```bash
pip install igenius-mcp
```

The setup wizard can auto-configure this, or manually add to `~/.vscode/mcp.json`:

```json
{
  "servers": {
    "igenius-memory": {
      "command": "igenius-mcp",
      "env": { "IGENIUS_API_KEY": "ig_your_key" },
      "type": "stdio"
    }
  }
}
```

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `iGenius: Show Briefing` | `Ctrl+Shift+B` | Generate intelligence briefing |
| `iGenius: Search Memories` | `Ctrl+Shift+M` | Search across all layers |
| `iGenius: Ingest Selected Text` | `Ctrl+Shift+I` | Ingest editor selection |
| `iGenius: Refresh Memories` | — | Refresh sidebar data |
| `iGenius: Consolidate Memories` | — | Merge extracts into master briefing |
| `iGenius: Set API Key` | — | Configure your API key |
| `iGenius: Open Store` | — | Upgrade your plan |
| `iGenius: Run Setup Wizard` | — | Re-run first-time setup |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `igenius.apiKey` | `""` | Your API key (starts with `ig_`) |
| `igenius.apiUrl` | `https://igenius-memory.online/v1` | API base URL |
| `igenius.autoRefreshInterval` | `30` | Refresh interval (seconds) |
| `igenius.showStatusBar` | `true` | Show memory count in status bar |

### AI Provider Settings

The extension supports multiple AI providers for server-side processing:

| Setting | Description |
|---------|-------------|
| `igenius.ai.provider` | `lmstudio`, `openai`, `anthropic`, or `google` |
| `igenius.ai.openai.apiKey` | OpenAI API key |
| `igenius.ai.anthropic.apiKey` | Anthropic API key |
| `igenius.ai.google.apiKey` | Google AI API key |

## Plans

| Feature | Starter (Free) | Pro ($19/mo) | Enterprise |
|---------|----------------|--------------|------------|
| Memories | 50 | Unlimited | Custom |
| API keys | 1 | 5 | Unlimited |
| All 14 tools | ✓ | ✓ | ✓ |
| Briefing engine | ✓ | ✓ | ✓ |
| Priority support | — | ✓ | ✓ |
| Encryption | — | ✓ | ✓ |

Get your free key or upgrade at [igenius-memory.store](https://igenius-memory.store).

## Architecture

```
VS Code Extension ←→ HTTPS ←→ igenius-memory.online/v1 ←→ AI + MySQL
         ↕
   MCP Server (igenius-mcp) ←→ Copilot / Claude agents
```

- No data stored locally — all memories live in your encrypted cloud account
- API key authenticates every request
- Works across all VS Code instances, machines, and projects
- MCP server gives agents direct tool access to all 14 memory operations

## Links

- 🌐 [igenius-memory.com](https://igenius-memory.com) — Landing page
- 📚 [igenius-memory.info](https://igenius-memory.info) — Documentation
- 🔌 [igenius-memory.online](https://igenius-memory.online) — API portal
- 🛒 [igenius-memory.store](https://igenius-memory.store) — Plans & pricing
- 📦 [igenius-mcp](https://github.com/vehoelite/igenius-mcp) — MCP server package

## License

MIT © iGenius
