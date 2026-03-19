// ── iGenius Memory — Extension Entry Point ────────────────
import * as vscode from "vscode";
import { IgeniusApi } from "./api";
import { SidebarProvider } from "./SidebarProvider";
import { StatusBar } from "./statusbar";
import { ProMemoryManager } from "./pro";
import { runSetupWizard, getInstructionsFilePath, ensureInstructionsFile } from "./setup";
import type { LLMProvider, ProviderConfig } from "./types";

let statusBar: StatusBar | undefined;
let proManager: ProMemoryManager | undefined;
let paused = false;

export function activate(context: vscode.ExtensionContext) {
  // ── Clean up stale versions from old publisher IDs ──────
  cleanupStaleVersions();

  // ── Resolve settings ────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("igenius");
  const apiUrl = cfg.get<string>("apiUrl", "https://igenius-memory.online/v1");
  const apiKey = cfg.get<string>("apiKey", "");
  const autoRefresh = cfg.get<number>("autoRefreshInterval", 30);
  const showStatusBar = cfg.get<boolean>("showStatusBar", true);

  // ── Project resolution ──────────────────────────────────
  function resolveProject(): string | null {
    const raw = vscode.workspace
      .getConfiguration("igenius")
      .get<string>("project", "auto");
    if (!raw || raw === "") return null; // global scope
    if (raw === "auto") {
      // Auto-detect from first workspace folder name
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        return folders[0].name;
      }
      return null;
    }
    return raw;
  }
  const activeProject = resolveProject();

  // ── AI Provider config ──────────────────────────────────
  const aiCfg = vscode.workspace.getConfiguration("igenius.ai");
  const providerConfig = readProviderConfig(aiCfg);

  // ── API client ──────────────────────────────────────────
  const api = new IgeniusApi(apiUrl, apiKey, providerConfig, activeProject);

  // ── Sidebar ─────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context.extensionUri, api);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Status bar ──────────────────────────────────────────
  if (showStatusBar) {
    statusBar = new StatusBar(api);
    statusBar.startAutoRefresh(autoRefresh);
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });
  }

  // ── Commands ────────────────────────────────────────────

  // Show Briefing — sends to agent chat so the agent reads it
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.showBriefing", async () => {
      if (!ensureApiKey()) return;
      try {
        const briefing = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "iGenius: Generating briefing…",
            cancellable: false,
          },
          () => api.briefing(true)
        );
        const text = briefing.briefing;
        if (!text || text.trim().length === 0) {
          vscode.window.showInformationMessage(
            "iGenius: No briefing data available yet — start a conversation first."
          );
          return;
        }
        // Send the briefing into Copilot Chat so the agent absorbs it
        const prompt =
          "Here is your iGenius Memory briefing. Read it carefully — it contains " +
          "all decisions, preferences, context, and open threads from previous sessions. " +
          "Use this to get fully up to speed before proceeding.\n\n" +
          text;
        try {
          await vscode.commands.executeCommand("workbench.action.chat.open", {
            query: prompt,
          });
        } catch {
          // Fallback: open as document if chat API unavailable
          const doc = await vscode.workspace.openTextDocument({
            content: text,
            language: "markdown",
          });
          await vscode.window.showTextDocument(doc, { preview: true });
          vscode.window.showInformationMessage(
            "Briefing opened in editor — copy it into agent chat to get your agent up to speed."
          );
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Briefing failed: ${err.message}`);
      }
    })
  );

  // Search Memories
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.searchMemories", async () => {
      if (!ensureApiKey()) return;
      const query = await vscode.window.showInputBox({
        prompt: "Search your memories",
        placeHolder: "e.g. database migration, API key, stripe",
      });
      if (!query) return;
      try {
        const results = await api.searchMemories(query);
        if (!results.memories.length) {
          vscode.window.showInformationMessage(
            `No memories found for "${query}"`
          );
          return;
        }
        // Show results in a quick pick
        const items = results.memories.map((m) => ({
          label: `$(${layerIcon(m.layer)}) ${m.title}`,
          description: `${m.layer} • imp:${m.importance} • ${m.category}`,
          detail: m.content?.slice(0, 120),
          memory: m,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `${results.count} result(s) for "${query}"`,
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (picked) {
          await showMemoryDocument(picked.memory);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Search failed: ${err.message}`);
      }
    })
  );

  // Ingest Selected Text
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.ingestSelection", async () => {
      if (!ensureApiKey()) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage("Select some text to ingest.");
        return;
      }
      const text = editor.document.getText(editor.selection);
      const fileName = editor.document.fileName.split(/[/\\]/).pop();
      try {
        const result = await api.ingest(
          `[From ${fileName}]\n${text}`,
          "user"
        );
        vscode.window.showInformationMessage(
          `Ingested → "${result.title}" (imp: ${result.importance})`
        );
        proManager?.notifyIngest();
        sidebarProvider.refresh();
        statusBar?.update();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Ingest failed: ${err.message}`);
      }
    })
  );

  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.refreshMemories", () => {
      sidebarProvider.refresh();
      statusBar?.update();
    })
  );

  // Consolidate
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.consolidate", async () => {
      if (!ensureApiKey()) return;
      const choice = await vscode.window.showWarningMessage(
        "Consolidate merges all interaction extracts into a master briefing. This is typically done before a context reset.",
        "Consolidate",
        "Cancel"
      );
      if (choice !== "Consolidate") return;
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "iGenius: Consolidating memories…",
            cancellable: false,
          },
          () => api.consolidate()
        );
        if (result.consolidated) {
          vscode.window.showInformationMessage(
            "Memories consolidated successfully."
          );
        } else {
          vscode.window.showInformationMessage(
            "Nothing to consolidate right now."
          );
        }
        sidebarProvider.refresh();
        statusBar?.update();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Consolidate failed: ${err.message}`);
      }
    })
  );

  // Open Store
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.openStore", () => {
      vscode.env.openExternal(
        vscode.Uri.parse("https://igenius-memory.store")
      );
    })
  );

  // Set API Key
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your iGenius Memory API key",
        placeHolder: "ig_xxxxxx…",
        password: true,
        validateInput: (v) =>
          v && !v.startsWith("ig_") ? 'API key should start with "ig_"' : null,
      });
      if (key === undefined) return; // cancelled
      if (key === "") {
        // Clear key
        await cfg.update("apiKey", "", vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("API key cleared.");
      } else {
        await cfg.update("apiKey", key, vscode.ConfigurationTarget.Global);
        api.setApiKey(key);
        const reload = await vscode.window.showWarningMessage(
          "API key saved. ⚠️ For best results, fully close and reopen VS Code " +
            "(not just reload). This ensures the brain icon, MCP server, and " +
            "all tools activate correctly.",
          "Close VS Code Now",
          "Reload Window",
          "Skip"
        );
        if (reload === "Close VS Code Now") {
          vscode.commands.executeCommand("workbench.action.quit");
          return;
        }
        if (reload === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
          return;
        }
      }
      sidebarProvider.refresh();
      statusBar?.update();
    })
  );

  // ── Add Long-Term Memory (manual) ────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.addLongTermMemory", async () => {
      if (!ensureApiKey()) return;

      const title = await vscode.window.showInputBox({
        title: "iGenius — Add Long-Term Memory",
        prompt: "Title for this memory",
        placeHolder: "e.g. Database schema decision, API pattern, key insight…",
        ignoreFocusOut: true,
      });
      if (!title) return;

      const content = await vscode.window.showInputBox({
        title: "iGenius — Add Long-Term Memory",
        prompt: "Memory content (the knowledge you want to preserve)",
        placeHolder: "Detailed content for the memory…",
        ignoreFocusOut: true,
      });
      if (!content) return;

      const catPick = await vscode.window.showQuickPick(
        [
          { label: "decision", description: "Architectural or design decision" },
          { label: "knowledge", description: "Technical knowledge or fact" },
          { label: "preference", description: "Personal or team preference" },
          { label: "credential", description: "API key, URL, or config" },
          { label: "procedure", description: "Step-by-step process" },
          { label: "note", description: "General note" },
        ],
        {
          title: "iGenius — Category",
          placeHolder: "Pick a category (or press Esc for 'note')",
        }
      );
      const category = catPick?.label || "note";

      const impPick = await vscode.window.showQuickPick(
        [
          { label: "90", description: "Critical — must never forget" },
          { label: "75", description: "High — important knowledge" },
          { label: "50", description: "Medium — useful context" },
          { label: "25", description: "Low — nice to have" },
        ],
        {
          title: "iGenius — Importance",
          placeHolder: "How important is this? (default: 50)",
        }
      );
      const importance = impPick ? parseInt(impPick.label, 10) : 50;

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "iGenius: Storing long-term memory…",
            cancellable: false,
          },
          () => api.storeMemory(content, "long_term", title, category, importance)
        );
        vscode.window.showInformationMessage(
          `✅ Long-term memory saved: "${result.title || title}"`
        );
        sidebarProvider.refresh();
        statusBar?.update();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Store failed: ${err.message}`);
      }
    })
  );

  // ── Edit Agent Instructions ─────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.editInstructions", async () => {
      const filePath = getInstructionsFilePath();
      ensureInstructionsFile();

      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(filePath)
      );
      await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      });
    })
  );

  // ── Configure MCP Tool Approvals ────────────────────────
  const IGENIUS_MCP_TOOLS = [
    { name: "memory_briefing", desc: "Generate intelligence briefing" },
    { name: "memory_ingest", desc: "Ingest messages into memory" },
    { name: "memory_consolidate", desc: "Merge extracts into briefing" },
    { name: "memory_process", desc: "Process text for trigger words" },
    { name: "memory_store", desc: "Store a memory directly" },
    { name: "memory_search", desc: "Search across all memories" },
    { name: "memory_recall", desc: "Retrieve raw persistent extracts" },
    { name: "memory_summarize", desc: "Compress text using LLM" },
    { name: "memory_delete", desc: "Delete a memory" },
    { name: "memory_update", desc: "Update an existing memory" },
    { name: "memory_review", desc: "List short-term memories for triage" },
    { name: "memory_promote", desc: "Promote short-term → long-term" },
    { name: "memory_triggers_list", desc: "List active trigger patterns" },
    { name: "memory_triggers_add", desc: "Add a new trigger pattern" },
    { name: "visual_report", desc: "Analyze UI/UX of a URL" },
    { name: "visual_screenshot", desc: "Screenshot a URL" },
  ];

  /** Read current tool approval map from VS Code settings */
  function getToolApprovalMap(): Record<string, string> {
    return vscode.workspace
      .getConfiguration("chat.mcp")
      .get<Record<string, string>>("toolApproval", {});
  }

  /** Write tool approval entries for iGenius tools */
  async function setToolApprovals(
    tools: string[],
    action: "allow" | "ask"
  ): Promise<void> {
    const current = { ...getToolApprovalMap() };
    for (const t of tools) {
      if (action === "allow") {
        current[t] = "allow";
      } else {
        delete current[t];
      }
    }
    await vscode.workspace
      .getConfiguration("chat.mcp")
      .update("toolApproval", current, vscode.ConfigurationTarget.Global);
  }

  // Command: granular multi-select quick pick
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.configureMcpApprovals", async () => {
      const current = getToolApprovalMap();

      const items = IGENIUS_MCP_TOOLS.map((t) => ({
        label: t.name,
        description: t.desc,
        picked: current[t.name] === "allow",
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: "iGenius — MCP Tool Approvals",
        placeHolder:
          "Check tools to auto-approve (unchecked = ask before running)",
        canPickMany: true,
      });

      if (picked === undefined) return; // cancelled

      const approved = new Set(picked.map((p) => p.label));
      const toAllow = IGENIUS_MCP_TOOLS
        .filter((t) => approved.has(t.name))
        .map((t) => t.name);
      const toAsk = IGENIUS_MCP_TOOLS
        .filter((t) => !approved.has(t.name))
        .map((t) => t.name);

      await setToolApprovals(toAllow, "allow");
      await setToolApprovals(toAsk, "ask");

      const count = toAllow.length;
      vscode.window.showInformationMessage(
        `✅ ${count} tool(s) auto-approved, ${toAsk.length} set to ask.`
      );
    })
  );

  // Auto-approve all tools when the toggle is ON
  async function applyAutoApprovalSetting(): Promise<void> {
    const autoApprove = vscode.workspace
      .getConfiguration("igenius")
      .get<boolean>("autoApproveMcpTools", false);
    if (autoApprove) {
      await setToolApprovals(
        IGENIUS_MCP_TOOLS.map((t) => t.name),
        "allow"
      );
    }
  }

  // Run on activation
  applyAutoApprovalSetting();

  // ── Toggle Pause (master pause for all background activity) ──
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.togglePause", () => {
      paused = !paused;
      const autoRefresh = vscode.workspace
        .getConfiguration("igenius")
        .get<number>("autoRefreshInterval", 30);

      if (paused) {
        // Stop all background timers
        statusBar?.pause();
        sidebarProvider.stopAutoRefresh();
        proManager?.stop();
        vscode.window.showInformationMessage(
          "⏸ iGenius background activity paused."
        );
      } else {
        // Resume all background timers
        statusBar?.resume(autoRefresh);
        sidebarProvider.startAutoRefresh();
        proManager?.start();
        sidebarProvider.refresh(); // immediate catch-up
        statusBar?.update();
        vscode.window.showInformationMessage(
          "▶ iGenius background activity resumed."
        );
      }

      // Notify sidebar webview of state change
      sidebarProvider.post({ type: "pause-state", paused });
    })
  );

  // ── Set Active Project ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.setProject", async () => {
      const current = resolveProject();
      const value = await vscode.window.showInputBox({
        title: "iGenius — Set Active Project",
        prompt: "Project name for memory isolation (leave empty for global, 'auto' to detect from workspace)",
        value: vscode.workspace.getConfiguration("igenius").get<string>("project", "auto"),
        placeHolder: "e.g. my-app, website, auto",
      });
      if (value === undefined) return; // cancelled
      await vscode.workspace
        .getConfiguration("igenius")
        .update("project", value || "auto", vscode.ConfigurationTarget.Global);
      const newProject = resolveProject();
      api.setProject(newProject);
      sidebarProvider.post({ type: "project-changed", project: newProject });
      sidebarProvider.refresh();
      statusBar?.update();
      vscode.window.showInformationMessage(
        newProject
          ? `📁 Active project set to "${newProject}"`
          : "🌐 Switched to global scope (no project isolation)"
      );
    })
  );

  // ── Visual Tools ─────────────────────────────────────────

  // Visual Report — prompts for URL, opens Copilot Chat with request
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.visualReport", async (url?: string) => {
      const targetUrl = url || await vscode.window.showInputBox({
        prompt: "Enter URL to analyze with iGenius Visual",
        placeHolder: "https://example.com",
        validateInput: (v) => {
          if (!v) { return null; }
          try { new URL(v); return null; } catch { return "Enter a valid URL"; }
        },
      });
      if (!targetUrl) { return; }
      const strictness = vscode.workspace
        .getConfiguration("igenius.pro")
        .get<number>("visualStrictness", 2);
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: `Use the visual_report tool to analyze the UI/UX of ${targetUrl} with strictness=${strictness}`,
        });
      } catch {
        // Fallback: copy prompt to clipboard
        await vscode.env.clipboard.writeText(
          `Use the visual_report tool to analyze the UI/UX of ${targetUrl} with strictness=${strictness}`
        );
        vscode.window.showInformationMessage(
          "Prompt copied to clipboard — paste it in Copilot Chat to run the analysis."
        );
      }
    })
  );

  // Visual Screenshot — prompts for URL, opens Copilot Chat
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.visualScreenshot", async (url?: string) => {
      const targetUrl = url || await vscode.window.showInputBox({
        prompt: "Enter URL to screenshot with iGenius Visual",
        placeHolder: "https://example.com",
        validateInput: (v) => {
          if (!v) { return null; }
          try { new URL(v); return null; } catch { return "Enter a valid URL"; }
        },
      });
      if (!targetUrl) { return; }
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: `Use the visual_screenshot tool to capture a screenshot of ${targetUrl}`,
        });
      } catch {
        await vscode.env.clipboard.writeText(
          `Use the visual_screenshot tool to capture a screenshot of ${targetUrl}`
        );
        vscode.window.showInformationMessage(
          "Prompt copied to clipboard — paste it in Copilot Chat to capture the screenshot."
        );
      }
    })
  );

  // ── Config change listener ──────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("igenius.apiKey")) {
        const newKey = vscode.workspace
          .getConfiguration("igenius")
          .get<string>("apiKey", "");
        api.setApiKey(newKey);
        sidebarProvider.refresh();
        statusBar?.update();
      }
      if (e.affectsConfiguration("igenius.apiUrl")) {
        const newUrl = vscode.workspace
          .getConfiguration("igenius")
          .get<string>("apiUrl", "https://igenius-memory.online/v1");
        api.setBaseUrl(newUrl);
        sidebarProvider.refresh();
        statusBar?.update();
      }
      if (e.affectsConfiguration("igenius.autoRefreshInterval")) {
        const newInterval = vscode.workspace
          .getConfiguration("igenius")
          .get<number>("autoRefreshInterval", 30);
        statusBar?.startAutoRefresh(newInterval);
      }
      if (e.affectsConfiguration("igenius.pro")) {
        const pc = vscode.workspace.getConfiguration("igenius.pro");
        if (proManager) {
          proManager.updateOptions({
            enabled: pc.get<boolean>("enabled", true),
            warmIntervalSec: pc.get<number>("warmIntervalSec", 120),
            consolidateThreshold: pc.get<number>("consolidateThreshold", 8),
          });
        } else if (pc.get<boolean>("enabled", true)) {
          const key = vscode.workspace
            .getConfiguration("igenius")
            .get<string>("apiKey", "");
          if (key) {
            proManager = new ProMemoryManager(api, {
              enabled: true,
              warmIntervalSec: pc.get<number>("warmIntervalSec", 120),
              consolidateThreshold: pc.get<number>("consolidateThreshold", 8),
            });
            proManager.start();
          }
        }
      }
      // ── AI Provider config changes ───────────────────────
      if (e.affectsConfiguration("igenius.ai")) {
        const newAiCfg = vscode.workspace.getConfiguration("igenius.ai");
        api.setProviderConfig(readProviderConfig(newAiCfg));
        sidebarProvider.refresh();
        statusBar?.update();
      }
      if (e.affectsConfiguration("igenius.showStatusBar")) {
        const show = vscode.workspace
          .getConfiguration("igenius")
          .get<boolean>("showStatusBar", true);
        if (show && !statusBar) {
          statusBar = new StatusBar(api);
          statusBar.startAutoRefresh(
            vscode.workspace
              .getConfiguration("igenius")
              .get<number>("autoRefreshInterval", 30)
          );
        } else if (!show && statusBar) {
          statusBar.dispose();
          statusBar = undefined;
        }
      }
      // ── Auto-approve MCP tools toggle ─────────────────────
      if (e.affectsConfiguration("igenius.autoApproveMcpTools")) {
        applyAutoApprovalSetting();
      }
      // ── Project change ────────────────────────────────────
      if (e.affectsConfiguration("igenius.project")) {
        const newProject = resolveProject();
        api.setProject(newProject);
        sidebarProvider.post({ type: "project-changed", project: newProject });
        sidebarProvider.refresh();
        statusBar?.update();
      }
    })
  );

  // ── First-install setup wizard ──────────────────────────
  const INSTALLED_KEY = "igenius.installed";
  if (!context.globalState.get<boolean>(INSTALLED_KEY)) {
    context.globalState.update(INSTALLED_KEY, true);
    // Launch wizard after a brief delay so the window is fully ready
    setTimeout(() => runSetupWizard(context, { isFirstInstall: true }), 1500);
  }

  // ── Setup Wizard command (re-runnable) ──────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("igenius.runSetup", () =>
      runSetupWizard(context)
    )
  );

  // ── Pro: Continuous Readiness Engine ─────────────────────
  const proCfg = vscode.workspace.getConfiguration("igenius.pro");
  if (apiKey) {
    proManager = new ProMemoryManager(api, {
      enabled: proCfg.get<boolean>("enabled", true),
      warmIntervalSec: proCfg.get<number>("warmIntervalSec", 120),
      consolidateThreshold: proCfg.get<number>("consolidateThreshold", 8),
    });
    proManager.start();
    context.subscriptions.push(proManager);

    // Fallback detector (Option D) — monitors output channels & terminals
    // for summarization strings as defense-in-depth
    context.subscriptions.push(proManager.createFallbackWatcher());
  }

  // ── Startup connectivity check ──────────────────────────
  if (apiKey) {
    api.health().catch(() => {
      vscode.window.showWarningMessage(
        "iGenius Memory: Could not connect to API. Check your settings."
      );
    });
  }
}

export function deactivate() {
  proManager?.dispose();
  proManager = undefined;
  statusBar?.dispose();
  statusBar = undefined;
}

// ── Helpers ───────────────────────────────────────────────

function ensureApiKey(): boolean {
  const key = vscode.workspace
    .getConfiguration("igenius")
    .get<string>("apiKey", "");
  if (!key) {
    vscode.window
      .showWarningMessage(
        "Set your iGenius API key first.",
        "Set Key",
        "Get Free Key"
      )
      .then((choice) => {
        if (choice === "Set Key") {
          vscode.commands.executeCommand("igenius.setApiKey");
        } else if (choice === "Get Free Key") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://igenius-memory.store")
          );
        }
      });
    return false;
  }
  return true;
}

function readProviderConfig(
  aiCfg: vscode.WorkspaceConfiguration
): ProviderConfig {
  const provider = aiCfg.get<LLMProvider>("provider", "lmstudio");
  switch (provider) {
    case "anthropic":
      return {
        provider,
        apiKey: aiCfg.get<string>("anthropic.apiKey", ""),
        model: aiCfg.get<string>("anthropic.model", "claude-sonnet-4-20250514"),
      };
    case "google":
      return {
        provider,
        apiKey: aiCfg.get<string>("google.apiKey", ""),
        model: aiCfg.get<string>("google.model", "gemini-2.0-flash"),
      };
    case "openai":
      return {
        provider,
        apiKey: aiCfg.get<string>("openai.apiKey", ""),
        model: aiCfg.get<string>("openai.model", "gpt-4o"),
      };
    case "lmstudio":
    default:
      return {
        provider: "lmstudio",
        baseUrl: aiCfg.get<string>("lmstudio.baseUrl", ""),
        model: aiCfg.get<string>("lmstudio.model", ""),
      };
  }
}

function layerIcon(layer: string): string {
  switch (layer) {
    case "persistent":
      return "pin";
    case "long_term":
      return "database";
    case "short_term":
      return "clock";
    default:
      return "circle";
  }
}

async function showMemoryDocument(memory: {
  id: number;
  title: string;
  content: string;
  layer: string;
  importance: number;
  category: string;
  key_facts?: string[];
  created_at: string;
}) {
  const facts =
    memory.key_facts?.map((f) => `- ${f}`).join("\n") || "_(none)_";
  const md = `# ${memory.title}

**ID:** ${memory.id} | **Layer:** ${memory.layer} | **Importance:** ${memory.importance}
**Category:** ${memory.category} | **Created:** ${memory.created_at}

---

${memory.content}

---

### Key Facts
${facts}
`;
  const doc = await vscode.workspace.openTextDocument({
    content: md,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

// ── Stale version cleanup ───────────────────────────────────
// Old publisher IDs (e.g. "igenius") leave orphan installs that
// shadow the current "igenius-memory" publisher build.
function cleanupStaleVersions() {
  const currentPublisher = "igenius-memory";
  const currentId = `${currentPublisher}.igenius-memory`;
  // Known old publisher IDs that shipped .vsix builds
  const staleIds = ["igenius.igenius-memory"];

  for (const oldId of staleIds) {
    const old = vscode.extensions.getExtension(oldId);
    if (old) {
      vscode.window
        .showWarningMessage(
          `An old iGenius Memory extension ("${oldId}") is still installed and may conflict. Uninstall it?`,
          "Uninstall Old Version",
          "Ignore"
        )
        .then((choice) => {
          if (choice === "Uninstall Old Version") {
            vscode.commands.executeCommand(
              "workbench.extensions.uninstallExtension",
              oldId
            ).then(() => {
              vscode.window.showInformationMessage(
                "Old iGenius extension removed. Please reload VS Code.",
                "Reload"
              ).then((r) => {
                if (r === "Reload") {
                  vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
              });
            });
          }
        });
      break; // Only show one prompt
    }
  }
}
