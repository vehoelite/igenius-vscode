// ── iGenius Memory — Sidebar Webview Provider ─────────────
import * as vscode from "vscode";
import { IgeniusApi } from "./api";
import type { FromWebviewMessage, Memory, ToWebviewMessage } from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "igenius.sidebar";
  private view?: vscode.WebviewView;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: IgeniusApi
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      (msg: FromWebviewMessage) => this.handleMessage(msg)
    );

    // Start auto-refresh
    this.startAutoRefresh();

    webviewView.onDidDispose(() => {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
      }
    });
  }

  /** Post a typed message to the webview */
  post(msg: ToWebviewMessage) {
    this.view?.webview.postMessage(msg);
  }

  /** Refresh all data */
  async refresh() {
    const key = vscode.workspace
      .getConfiguration("igenius")
      .get<string>("apiKey", "");
    if (!key) {
      this.post({ type: "no-api-key" });
      return;
    }

    this.post({ type: "loading", loading: true });

    try {
      // Fetch all layers in parallel
      const [shortTerm, longTerm, persistent] = await Promise.all([
        this.api.getMemoriesByLayer("short_term").catch(() => [] as Memory[]),
        this.api.getMemoriesByLayer("long_term").catch(() => [] as Memory[]),
        this.api.getMemoriesByLayer("persistent").catch(() => [] as Memory[]),
      ]);

      this.post({ type: "memories", layer: "short_term", data: shortTerm });
      this.post({ type: "memories", layer: "long_term", data: longTerm });
      this.post({ type: "memories", layer: "persistent", data: persistent });

      this.post({
        type: "stats",
        data: {
          persistent_count: persistent.length,
          long_term_count: longTerm.length,
          short_term_count: shortTerm.length,
          total_count: persistent.length + longTerm.length + shortTerm.length,
        },
      });
    } catch (err: any) {
      this.post({ type: "error", message: err.message || "Failed to load memories" });
    } finally {
      this.post({ type: "loading", loading: false });
    }
  }

  startAutoRefresh() {
    const seconds = vscode.workspace
      .getConfiguration("igenius")
      .get<number>("autoRefreshInterval", 30);
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(() => this.refresh(), seconds * 1000);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async handleMessage(msg: FromWebviewMessage) {
    switch (msg.type) {
      case "ready":
        await this.refresh();
        break;

      case "get-briefing":
        try {
          this.post({ type: "loading", loading: true });
          // Force fresh generation — user clicked the button deliberately
          const b = await this.api.briefing(true);
          this.post({ type: "briefing", data: b });
        } catch (err: any) {
          this.post({ type: "error", message: err.message });
        } finally {
          this.post({ type: "loading", loading: false });
        }
        break;

      case "get-memories":
        try {
          const mems = await this.api.getMemoriesByLayer(msg.layer);
          this.post({ type: "memories", layer: msg.layer, data: mems });
        } catch (err: any) {
          this.post({ type: "error", message: err.message });
        }
        break;

      case "search":
        try {
          this.post({ type: "loading", loading: true });
          const results = await this.api.searchMemories(msg.query);
          this.post({ type: "search-results", data: results });
        } catch (err: any) {
          this.post({ type: "error", message: err.message });
        } finally {
          this.post({ type: "loading", loading: false });
        }
        break;

      case "promote":
        try {
          await this.api.promoteMemory(msg.memoryId);
          this.post({ type: "promote-ok", memoryId: msg.memoryId });
          await this.refresh();
        } catch (err: any) {
          this.post({ type: "error", message: `Promote failed: ${err.message}` });
        }
        break;

      case "delete":
        try {
          await this.api.deleteMemory(msg.memoryId);
          this.post({ type: "delete-ok", memoryId: msg.memoryId });
          await this.refresh();
        } catch (err: any) {
          this.post({ type: "error", message: `Delete failed: ${err.message}` });
        }
        break;

      case "refresh":
        await this.refresh();
        break;

      case "open-settings":
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "igenius"
        );
        break;

      case "open-store":
        vscode.env.openExternal(vscode.Uri.parse("https://igenius-memory.store"));
        break;

      case "set-api-key":
        vscode.commands.executeCommand("igenius.setApiKey");
        break;

      case "visual-report":
        vscode.commands.executeCommand("igenius.visualReport", (msg as any).url);
        break;

      case "visual-screenshot":
        vscode.commands.executeCommand("igenius.visualScreenshot", (msg as any).url);
        break;

      case "add-long-term-memory":
        vscode.commands.executeCommand("igenius.addLongTermMemory");
        break;

      case "edit-instructions":
        vscode.commands.executeCommand("igenius.editInstructions");
        break;

      case "configure-mcp-approvals":
        vscode.commands.executeCommand("igenius.configureMcpApprovals");
        break;

      case "toggle-pause":
        vscode.commands.executeCommand("igenius.togglePause");
        break;
    }
  }

  // ── Webview HTML ─────────────────────────────────────────
  private getHtml(): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-sideBar-foreground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --link: var(--vscode-textLink-foreground);
    --error: var(--vscode-errorForeground);
    --success: #10b981;
    --purple: #8b5cf6;
    --amber: #f59e0b;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--fg);
    background: var(--bg);
    padding: 0;
    overflow-x: hidden;
  }

  /* ── Header ─────────────────── */
  .header {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
  }
  .header .logo { font-size: 1.1rem; }
  .header h2 { font-size: 0.85rem; font-weight: 600; flex: 1; }
  .header-actions { display: flex; gap: 4px; }
  .icon-btn {
    background: none; border: none; color: var(--fg);
    cursor: pointer; padding: 4px; border-radius: 4px;
    font-size: 0.85rem; opacity: 0.7;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:hover { opacity: 1; background: var(--input-bg); }

  /* ── Tabs ────────────────────── */
  .tabs {
    display: flex; border-bottom: 1px solid var(--border);
    background: var(--bg);
    position: sticky; top: 0; z-index: 10;
  }
  .tab {
    flex: 1; padding: 8px 4px; text-align: center;
    font-size: 0.72rem; font-weight: 500; cursor: pointer;
    border-bottom: 2px solid transparent;
    color: var(--fg); opacity: 0.6;
    background: none; border-top: none; border-left: none; border-right: none;
    transition: all 0.15s;
  }
  .tab:hover { opacity: 0.85; }
  .tab.active {
    opacity: 1; border-bottom-color: var(--purple);
    font-weight: 600;
  }
  .tab .count {
    display: inline-block;
    background: var(--badge-bg); color: var(--badge-fg);
    font-size: 0.6rem; padding: 1px 5px; border-radius: 8px;
    margin-left: 4px; min-width: 16px; text-align: center;
  }

  /* ── Search ─────────────────── */
  .search-bar {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  .search-bar input {
    width: 100%; padding: 6px 10px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 4px;
    font-family: inherit; font-size: 0.8rem;
    outline: none;
  }
  .search-bar input:focus { border-color: var(--purple); }

  /* ── Panel content ──────────── */
  .panel { display: none; padding: 0; }
  .panel.active { display: block; }

  /* ── Memory card ────────────── */
  .memory-card {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.1s;
  }
  .memory-card:hover { background: var(--input-bg); }
  .memory-card.expanded { background: var(--input-bg); }

  .card-header {
    display: flex; align-items: flex-start; gap: 8px;
  }
  .card-importance {
    width: 6px; min-height: 24px; border-radius: 3px;
    flex-shrink: 0; margin-top: 2px;
  }
  .imp-high { background: #f43f5e; }
  .imp-med { background: var(--amber); }
  .imp-low { background: var(--success); }

  .card-body { flex: 1; min-width: 0; }
  .card-title {
    font-size: 0.8rem; font-weight: 600;
    line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-meta {
    font-size: 0.68rem; opacity: 0.6; margin-top: 2px;
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .card-meta .layer-badge {
    padding: 1px 6px; border-radius: 4px; font-weight: 500;
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .layer-short_term { background: rgba(245,158,11,0.15); color: var(--amber); }
  .layer-long_term { background: rgba(139,92,246,0.15); color: var(--purple); }
  .layer-persistent { background: rgba(59,130,246,0.15); color: #60a5fa; }

  /* Expanded card content */
  .card-expand {
    display: none; margin-top: 10px;
    padding: 10px; border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .memory-card.expanded .card-expand { display: block; }

  .card-expand .content-text {
    font-size: 0.78rem; line-height: 1.6;
    white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow-y: auto;
    margin-bottom: 8px;
  }
  .card-expand .facts-list {
    list-style: none; margin: 8px 0;
  }
  .card-expand .facts-list li {
    font-size: 0.72rem; padding: 3px 0;
    display: flex; align-items: flex-start; gap: 6px;
  }
  .card-expand .facts-list li::before {
    content: "•"; color: var(--purple); font-weight: bold; flex-shrink: 0;
  }
  .card-actions {
    display: flex; gap: 6px; margin-top: 8px;
  }
  .card-actions button {
    padding: 4px 10px; border-radius: 4px;
    font-size: 0.7rem; font-weight: 500;
    cursor: pointer; border: 1px solid var(--border);
    background: var(--input-bg); color: var(--fg);
    transition: all 0.1s;
  }
  .card-actions button:hover { background: var(--btn-bg); color: var(--btn-fg); }
  .card-actions .promote-btn:hover { background: var(--purple); color: #fff; border-color: var(--purple); }
  .card-actions .delete-btn:hover { background: #f43f5e; color: #fff; border-color: #f43f5e; }

  /* ── Briefing panel ─────────── */
  .briefing-content {
    padding: 14px; font-size: 0.8rem; line-height: 1.7;
    white-space: pre-wrap; word-break: break-word;
  }

  /* ── Empty / loading / error ── */
  .empty-state {
    padding: 32px 14px; text-align: center;
    font-size: 0.8rem; opacity: 0.5;
  }
  .empty-state .emoji { font-size: 2rem; margin-bottom: 8px; }

  .loading-bar {
    height: 2px; background: var(--purple);
    animation: loading 1.2s ease-in-out infinite;
    display: none;
  }
  .loading-bar.active { display: block; }
  @keyframes loading {
    0% { width: 0; margin-left: 0; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0; margin-left: 100%; }
  }

  .error-toast {
    position: fixed; bottom: 8px; left: 8px; right: 8px;
    background: #f43f5e; color: #fff;
    padding: 8px 12px; border-radius: 6px;
    font-size: 0.75rem; z-index: 100;
    display: none; animation: slideUp 0.2s ease-out;
  }
  .error-toast.show { display: block; }
  @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  /* ── No API key state ───────── */
  .no-key-state {
    padding: 24px 14px; text-align: center;
  }
  .no-key-state .emoji { font-size: 2.5rem; margin-bottom: 12px; }
  .no-key-state h3 { font-size: 0.95rem; margin-bottom: 8px; }
  .no-key-state p { font-size: 0.78rem; opacity: 0.7; margin-bottom: 16px; line-height: 1.5; }
  .no-key-state button {
    padding: 8px 16px; border-radius: 6px;
    background: var(--btn-bg); color: var(--btn-fg);
    border: none; cursor: pointer; font-weight: 600;
    font-size: 0.8rem; margin: 4px;
  }
  .no-key-state button:hover { background: var(--btn-hover); }
  .no-key-state .ghost-btn {
    background: transparent; color: var(--link);
    border: 1px solid var(--border);
  }

  /* ── Stats bar ──────────────── */
  .stats-bar {
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between;
    font-size: 0.65rem; opacity: 0.6;
  }

  /* ── Visual tools panel ─────── */
  .visual-section { padding: 14px; }
  .visual-section h3 {
    font-size: 0.82rem; font-weight: 600; margin-bottom: 10px;
    display: flex; align-items: center; gap: 6px;
  }
  .visual-section p {
    font-size: 0.75rem; opacity: 0.7; line-height: 1.5; margin-bottom: 12px;
  }
  .visual-input-row {
    display: flex; gap: 6px; margin-bottom: 10px;
  }
  .visual-input-row input {
    flex: 1; padding: 7px 10px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 4px;
    font-family: inherit; font-size: 0.78rem; outline: none;
  }
  .visual-input-row input:focus { border-color: var(--purple); }
  .visual-btns { display: flex; gap: 6px; }
  .visual-btns button {
    flex: 1; padding: 8px 10px; border-radius: 6px;
    font-size: 0.75rem; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); transition: all 0.15s;
  }
  .visual-btns .btn-analyze {
    background: var(--btn-bg); color: var(--btn-fg); border: none;
  }
  .visual-btns .btn-analyze:hover { background: var(--btn-hover); }
  .visual-btns .btn-screenshot {
    background: var(--input-bg); color: var(--fg);
  }
  .visual-btns .btn-screenshot:hover { background: var(--purple); color: #fff; border-color: var(--purple); }
  .visual-info {
    margin-top: 14px; padding: 10px 12px; border-radius: 6px;
    background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.15);
    font-size: 0.7rem; line-height: 1.6; opacity: 0.8;
  }
  .visual-info code { color: var(--purple); font-family: var(--vscode-editor-font-family); }

  /* ── Context menu ────────────── */
  .ctx-menu {
    position: fixed; z-index: 200;
    background: var(--vscode-menu-background, var(--input-bg));
    color: var(--vscode-menu-foreground, var(--fg));
    border: 1px solid var(--vscode-menu-border, var(--border));
    border-radius: 6px; padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    min-width: 180px; display: none;
  }
  .ctx-menu.show { display: block; }
  .ctx-menu-item {
    padding: 6px 14px; font-size: 0.78rem;
    cursor: pointer; display: flex; align-items: center; gap: 8px;
    transition: background 0.1s;
  }
  .ctx-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--btn-bg));
    color: var(--vscode-menu-selectionForeground, var(--btn-fg));
  }
  .ctx-menu-sep {
    height: 1px; background: var(--border); margin: 4px 0;
  }

  /* ── Agent Instructions button ── */
  .instr-btn {
    background: none; border: none; color: var(--fg);
    cursor: pointer; padding: 4px; border-radius: 4px;
    font-size: 0.78rem; opacity: 0.7;
    display: flex; align-items: center; justify-content: center;
  }
  .instr-btn:hover { opacity: 1; background: var(--input-bg); }

  /* ── Pause banner ── */
  .pause-banner {
    display: none;
    padding: 6px 14px;
    background: rgba(245, 158, 11, 0.12);
    border-bottom: 1px solid rgba(245, 158, 11, 0.25);
    font-size: 0.75rem;
    color: var(--amber);
    text-align: center;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .pause-banner.show { display: block; }
  .icon-btn.paused { color: var(--amber); opacity: 1; }
</style>
</head>
<body>

<div class="loading-bar" id="loading"></div>

<!-- No API key state -->
<div id="no-key" style="display:none;">
  <div class="no-key-state">
    <div class="emoji">🔑</div>
    <h3>Connect Your Memory</h3>
    <p>Add your iGenius API key to browse and manage your AI's memories.</p>
    <button onclick="msg({type:'set-api-key'})">Set API Key</button>
    <button class="ghost-btn" onclick="msg({type:'open-store'})">Get Free Key</button>
  </div>
</div>

<!-- Main UI (hidden until API key is set) -->
<div id="main" style="display:none;">
  <div class="header">
    <span class="logo">🧠</span>
    <h2>iGenius Memory</h2>
    <div class="header-actions">
      <button class="icon-btn" id="pause-btn" onclick="msg({type:'toggle-pause'})" title="Pause all background activity">⏸</button>
      <button class="icon-btn" onclick="msg({type:'edit-instructions'})" title="Edit Agent Instructions">📋</button>
      <button class="icon-btn" onclick="msg({type:'refresh'})" title="Refresh">↻</button>
      <button class="icon-btn" onclick="msg({type:'open-settings'})" title="Settings">⚙</button>
    </div>
  </div>
  <div class="pause-banner" id="pause-banner">⏸ Background activity paused</div>

  <div class="stats-bar" id="stats-bar">
    <span id="stat-total">—</span>
    <span id="stat-persistent">P: —</span>
    <span id="stat-long">LT: —</span>
    <span id="stat-short">ST: —</span>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="long_term">Long-term<span class="count" id="count-lt">0</span></button>
    <button class="tab" data-tab="short_term">Short-term<span class="count" id="count-st">0</span></button>
    <button class="tab" data-tab="briefing">Briefing</button>
    <button class="tab" data-tab="search">Search</button>
    <button class="tab" data-tab="visual">👁️</button>
  </div>

  <!-- Long-term panel (hero) -->
  <div class="panel active" id="panel-long_term">
    <div id="lt-list"></div>
    <div class="empty-state" id="lt-empty" style="display:none;">
      <div class="emoji">📦</div>
      <div>No long-term memories yet.<br>Promote short-term catches to build your knowledge base.</div>
    </div>
  </div>

  <!-- Short-term panel -->
  <div class="panel" id="panel-short_term">
    <div id="st-list"></div>
    <div class="empty-state" id="st-empty" style="display:none;">
      <div class="emoji">🕐</div>
      <div>No short-term memories.<br>They'll appear as your agent captures context.</div>
    </div>
  </div>

  <!-- Briefing panel -->
  <div class="panel" id="panel-briefing">
    <div style="padding: 8px 14px;">
      <button onclick="msg({type:'get-briefing'})" style="
        width:100%; padding:8px; border-radius:6px;
        background: var(--btn-bg); color: var(--btn-fg);
        border:none; cursor:pointer; font-weight:600; font-size:0.78rem;
      ">Generate Briefing</button>
    </div>
    <div class="briefing-content" id="briefing-text">
      <div class="empty-state">
        <div class="emoji">📋</div>
        <div>Click above to generate an intelligence briefing from all your memories.</div>
      </div>
    </div>
  </div>

  <!-- Search panel -->
  <div class="panel" id="panel-search">
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="Search memories…" />
    </div>
    <div id="search-results"></div>
    <div class="empty-state" id="search-empty">
      <div class="emoji">🔍</div>
      <div>Type to search across all memory layers.</div>
    </div>
  </div>

  <!-- Visual Tools panel -->
  <div class="panel" id="panel-visual">
    <div class="visual-section">
      <h3>👁️ Visual Tools</h3>
      <p>Render any URL, take a pixel-perfect screenshot, and analyze the UI/UX with a local vision model.</p>

      <div class="visual-input-row">
        <input type="text" id="visual-url" placeholder="https://example.com" />
      </div>
      <div class="visual-btns">
        <button class="btn-analyze" onclick="visualAction('report')">📊 Analyze UI</button>
        <button class="btn-screenshot" onclick="visualAction('screenshot')">📸 Screenshot</button>
      </div>

      <div class="visual-info">
        <strong>How it works:</strong><br>
        1. Enter a URL and click <strong>Analyze</strong> or <strong>Screenshot</strong><br>
        2. Copilot Chat opens with the MCP tool request<br>
        3. The MCP server renders, screenshots, and (optionally) analyzes the page<br><br>
        <strong>Requires:</strong> <code>pip install "igenius-mcp[visual]"</code> + Playwright + a vision model in LM Studio.
      </div>

      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
        <h3 style="font-size:0.78rem;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          ⚡ Pro Auto-Analyze
        </h3>
        <p style="font-size:0.7rem;opacity:0.7;line-height:1.5;margin-bottom:8px;">
          Set a URL in settings to auto-analyze on an interval while you code.
        </p>
        <button onclick="msg({type:'open-settings'})" style="
          width:100%;padding:7px;border-radius:6px;font-size:0.72rem;font-weight:600;
          background:rgba(139,92,246,0.12);color:var(--purple);border:1px solid rgba(139,92,246,0.2);
          cursor:pointer;
        ">Configure Auto-Analyze →</button>
      </div>
    </div>
  </div>
</div>

<div class="error-toast" id="error-toast"></div>

<!-- Right-click context menu -->
<div class="ctx-menu" id="ctx-menu">
  <div class="ctx-menu-item" onclick="ctxAction('add-memory')">➕ Add Memory</div>
  <div class="ctx-menu-sep"></div>
  <div class="ctx-menu-item" onclick="ctxAction('refresh')">↻ Refresh</div>
</div>

<script>
  // ── VS Code API ─────────────────────────────────
  const vscode = acquireVsCodeApi();
  function msg(m) { vscode.postMessage(m); }

  // State
  let memories = { short_term: [], long_term: [], persistent: [] };
  let currentTab = 'long_term';

  // ── Tab switching ───────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      currentTab = id;
      document.getElementById('panel-' + id)?.classList.add('active');
    });
  });

  // ── Search ──────────────────────────────────────
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length >= 2) {
      searchTimeout = setTimeout(() => msg({ type: 'search', query: q }), 300);
    }
  });

  // ── Render memory cards ─────────────────────────
  function renderCards(layer, container) {
    const list = memories[layer] || [];
    const el = document.getElementById(container);
    const emptyEl = document.getElementById(layer === 'long_term' ? 'lt-empty' : 'st-empty');

    if (!list.length) {
      el.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    el.innerHTML = list.map(m => cardHtml(m, layer)).join('');

    // Attach click handlers
    el.querySelectorAll('.memory-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-actions')) return;
        card.classList.toggle('expanded');
      });
    });
  }

  function cardHtml(m, layer) {
    const imp = m.importance >= 80 ? 'high' : m.importance >= 50 ? 'med' : 'low';
    const date = new Date(m.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const facts = (m.key_facts || [])
      .map(f => '<li>' + esc(f) + '</li>').join('');

    const actions = [];
    if (layer === 'short_term') {
      actions.push('<button class="promote-btn" onclick="event.stopPropagation();msg({type:\\'promote\\',memoryId:' + m.id + '})">⬆ Promote</button>');
    }
    actions.push('<button class="delete-btn" onclick="event.stopPropagation();msg({type:\\'delete\\',memoryId:' + m.id + '})">✕ Delete</button>');

    return '<div class="memory-card" data-id="' + m.id + '">'
      + '<div class="card-header">'
      + '<div class="card-importance imp-' + imp + '"></div>'
      + '<div class="card-body">'
      + '<div class="card-title">' + esc(m.title || 'Untitled') + '</div>'
      + '<div class="card-meta">'
      + '<span class="layer-badge layer-' + m.layer + '">' + m.layer.replace('_', '-') + '</span>'
      + '<span>' + esc(m.category || '') + '</span>'
      + '<span>imp:' + m.importance + '</span>'
      + '<span>' + date + '</span>'
      + '</div></div></div>'
      + '<div class="card-expand">'
      + '<div class="content-text">' + esc(m.content || m.summary || '') + '</div>'
      + (facts ? '<ul class="facts-list">' + facts + '</ul>' : '')
      + '<div class="card-actions">' + actions.join('') + '</div>'
      + '</div></div>';
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Search results ──────────────────────────────
  function renderSearchResults(data) {
    const el = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    const list = data.memories || [];
    if (!list.length) {
      el.innerHTML = '';
      emptyEl.style.display = '';
      emptyEl.querySelector('.emoji').textContent = '🔍';
      emptyEl.querySelector('div:last-child').textContent = 'No results for "' + (data.query || '') + '"';
      return;
    }
    emptyEl.style.display = 'none';
    el.innerHTML = list.map(m => cardHtml(m, m.layer)).join('');
    el.querySelectorAll('.memory-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-actions')) return;
        card.classList.toggle('expanded');
      });
    });
  }

  // ── Message handler ─────────────────────────────
  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'memories':
        memories[m.layer] = m.data || [];
        if (m.layer === 'long_term') renderCards('long_term', 'lt-list');
        if (m.layer === 'short_term') renderCards('short_term', 'st-list');
        break;

      case 'stats':
        document.getElementById('stat-total').textContent = 'Total: ' + m.data.total_count;
        document.getElementById('stat-persistent').textContent = 'P: ' + m.data.persistent_count;
        document.getElementById('stat-long').textContent = 'LT: ' + m.data.long_term_count;
        document.getElementById('stat-short').textContent = 'ST: ' + m.data.short_term_count;
        document.getElementById('count-lt').textContent = m.data.long_term_count;
        document.getElementById('count-st').textContent = m.data.short_term_count;
        break;

      case 'briefing':
        document.getElementById('briefing-text').innerHTML =
          '<div style="white-space:pre-wrap;line-height:1.7;">' + esc(m.data.briefing || 'No briefing available.') + '</div>';
        break;

      case 'search-results':
        renderSearchResults(m.data);
        break;

      case 'loading':
        document.getElementById('loading').classList.toggle('active', m.loading);
        break;

      case 'error':
        showError(m.message);
        break;

      case 'no-api-key':
        document.getElementById('no-key').style.display = '';
        document.getElementById('main').style.display = 'none';
        break;

      case 'promote-ok':
        showToast('Memory #' + m.memoryId + ' promoted to long-term ✓', false);
        break;

      case 'delete-ok':
        showToast('Memory #' + m.memoryId + ' deleted ✓', false);
        break;

      case 'store-ok':
        showToast('Memory saved: "' + (m.memory?.title || 'Untitled') + '" ✓', false);
        break;

      case 'pause-state': {
        const btn = document.getElementById('pause-btn');
        const banner = document.getElementById('pause-banner');
        if (m.paused) {
          btn.textContent = '▶';
          btn.title = 'Resume background activity';
          btn.classList.add('paused');
          banner.classList.add('show');
        } else {
          btn.textContent = '⏸';
          btn.title = 'Pause all background activity';
          btn.classList.remove('paused');
          banner.classList.remove('show');
        }
        break;
      }
    }
  });

  function showError(text) {
    const el = document.getElementById('error-toast');
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 4000);
  }

  function showToast(text, isError) {
    const el = document.getElementById('error-toast');
    el.textContent = text;
    el.style.background = isError ? '#f43f5e' : '#10b981';
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); el.style.background = ''; }, 3000);
  }

  // ── Visual tools ─────────────────────────────────
  function visualAction(action) {
    const url = document.getElementById('visual-url').value.trim();
    if (!url) {
      showError('Enter a URL to analyze');
      return;
    }
    try { new URL(url); } catch {
      showError('Enter a valid URL (e.g. https://example.com)');
      return;
    }
    msg({ type: 'visual-' + action, url: url });
  }

  // ── Context menu (right-click on Long-term tab) ──────────
  const ctxMenu = document.getElementById('ctx-menu');

  // Attach right-click to the Long-term tab
  document.querySelectorAll('.tab').forEach(tab => {
    if (tab.dataset.tab === 'long_term') {
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ctxMenu.style.left = e.pageX + 'px';
        ctxMenu.style.top = e.pageY + 'px';
        ctxMenu.classList.add('show');
      });
    }
  });

  // Also allow right-click on the Long-term panel itself
  document.getElementById('panel-long_term').addEventListener('contextmenu', (e) => {
    // Don't override context menu on memory cards
    if (e.target.closest('.memory-card')) return;
    e.preventDefault();
    ctxMenu.style.left = e.pageX + 'px';
    ctxMenu.style.top = e.pageY + 'px';
    ctxMenu.classList.add('show');
  });

  // Hide context menu on click anywhere
  document.addEventListener('click', () => ctxMenu.classList.remove('show'));
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.tab[data-tab="long_term"]') && !e.target.closest('#panel-long_term')) {
      ctxMenu.classList.remove('show');
    }
  });

  function ctxAction(action) {
    ctxMenu.classList.remove('show');
    if (action === 'add-memory') {
      msg({ type: 'add-long-term-memory' });
    } else if (action === 'refresh') {
      msg({ type: 'refresh' });
    }
  }

  // ── Init ────────────────────────────────────────
  document.getElementById('main').style.display = '';
  msg({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
