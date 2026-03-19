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

    // Send initial project state
    const project = vscode.workspace.getConfiguration("igenius").get<string>("project", "auto");
    let resolvedProject: string | null = null;
    if (project === "auto") {
      const folders = vscode.workspace.workspaceFolders;
      resolvedProject = folders && folders.length > 0 ? folders[0].name : null;
    } else if (project && project !== "") {
      resolvedProject = project;
    }
    setTimeout(() => {
      this.post({ type: "project-changed", project: resolvedProject });
    }, 100);

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
      const [shortTerm, longTerm, persistent, pinned] = await Promise.all([
        this.api.getMemoriesByLayer("short_term").catch(() => [] as Memory[]),
        this.api.getMemoriesByLayer("long_term").catch(() => [] as Memory[]),
        this.api.getMemoriesByLayer("persistent").catch(() => [] as Memory[]),
        this.api.getMemoriesByLayer("pinned").catch(() => [] as Memory[]),
      ]);

      this.post({ type: "memories", layer: "short_term", data: shortTerm });
      this.post({ type: "memories", layer: "long_term", data: longTerm });
      this.post({ type: "memories", layer: "persistent", data: persistent });
      this.post({ type: "pinned-memories", data: pinned });

      this.post({
        type: "stats",
        data: {
          persistent_count: persistent.length,
          long_term_count: longTerm.length,
          short_term_count: shortTerm.length,
          total_count: persistent.length + longTerm.length + shortTerm.length + pinned.length,
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

      case "set-project":
        vscode.commands.executeCommand("igenius.setProject");
        break;

      case "store-pin":
        try {
          this.post({ type: "loading", loading: true });
          const pinMsg = msg as any;
          const pinMem = await this.api.storeMemory(
            pinMsg.content,
            "pinned",
            pinMsg.title,
            pinMsg.category,
            80,
            pinMsg.project
          );
          this.post({ type: "pin-stored", memory: pinMem });
        } catch (err: any) {
          this.post({ type: "error", message: `Pin failed: ${err.message}` });
        } finally {
          this.post({ type: "loading", loading: false });
        }
        break;

      case "update-pin":
        try {
          this.post({ type: "loading", loading: true });
          const upMsg = msg as any;
          const updated = await this.api.updateMemory(upMsg.memoryId, {
            title: upMsg.title,
            content: upMsg.content,
          });
          this.post({ type: "pin-updated", memory: updated });
        } catch (err: any) {
          this.post({ type: "error", message: `Update failed: ${err.message}` });
        } finally {
          this.post({ type: "loading", loading: false });
        }
        break;

      case "delete-pin":
        try {
          const delMsg = msg as any;
          await this.api.deleteMemory(delMsg.memoryId);
          this.post({ type: "pin-deleted", memoryId: delMsg.memoryId });
        } catch (err: any) {
          this.post({ type: "error", message: `Delete failed: ${err.message}` });
        }
        break;

      case "get-pinned":
        try {
          const pinned = await this.api.getMemoriesByLayer("pinned");
          this.post({ type: "pinned-memories", data: pinned });
        } catch (err: any) {
          this.post({ type: "error", message: `Load pins failed: ${err.message}` });
        }
        break;
    }
  }

  // ── Webview HTML ─────────────────────────────────────────
  // CSS & JS extracted to webview/sidebar.css and webview/sidebar.js
  // for reuse across VS Code extension and future Tauri desktop app.
  private getHtml(): string {
    const webview = this.view!.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "sidebar.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "sidebar.js")
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${cssUri}">
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
  <div class=\"project-bar\" id=\"project-bar\" onclick=\"msg({type:'set-project'})\" title=\"Click to change active project\">
    <span class=\"project-icon\">📁</span>
    <span class=\"project-name\" id=\"project-name\">Detecting…</span>
    <span class=\"project-edit\">✎</span>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="long_term">Long-term<span class="count" id="count-lt">0</span></button>
    <button class="tab" data-tab="short_term">Short-term<span class="count" id="count-st">0</span></button>
    <button class="tab" data-tab="pinned">📌 Pins<span class="count" id="count-pin">0</span></button>
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

  <!-- Pinned panel -->
  <div class="panel" id="panel-pinned">
    <!-- Add new pin form -->
    <div class="pin-form-section">
      <div class="pin-form-header" onclick="togglePinForm()">
        <span>➕ Add Pinned Fact</span>
        <span id="pin-form-arrow">▸</span>
      </div>
      <div class="pin-form" id="pin-form" style="display:none;">
        <input type="text" id="pin-title" placeholder="Title (e.g. Production DB Host)" />
        <textarea id="pin-content" placeholder="Value or details (e.g. 192.168.1.100)" rows="3"></textarea>
        <div class="pin-form-row">
          <select id="pin-category">
            <option value="credential">🔑 Credential</option>
            <option value="server">🖥️ Server / IP</option>
            <option value="api_key">🔐 API Key</option>
            <option value="config">⚙️ Configuration</option>
            <option value="identity">👤 Identity</option>
            <option value="url">🔗 URL / Endpoint</option>
            <option value="note" selected>📝 Note</option>
          </select>
          <input type="text" id="pin-project" placeholder="Project (optional)" />
        </div>
        <div class="pin-form-actions">
          <button class="pin-save-btn" onclick="savePin()">📌 Pin It</button>
          <button class="pin-cancel-btn" onclick="togglePinForm()">Cancel</button>
        </div>
      </div>
    </div>
    <!-- Pinned memories list -->
    <div id="pin-list"></div>
    <div class="empty-state" id="pin-empty" style="display:none;">
      <div class="emoji">📌</div>
      <div>No pinned facts yet.<br>Pin server IPs, credentials, API keys, and other key details that persist across sessions.</div>
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

<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
