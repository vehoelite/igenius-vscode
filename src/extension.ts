// ── iGenius Memory — Extension Entry Point ────────────────
import * as vscode from "vscode";
import { IgeniusApi } from "./api";
import { SidebarProvider } from "./SidebarProvider";
import { StatusBar } from "./statusbar";
import { ProMemoryManager } from "./pro";
import { runSetupWizard } from "./setup";
import type { LLMProvider, ProviderConfig } from "./types";

let statusBar: StatusBar | undefined;
let proManager: ProMemoryManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  // ── Resolve settings ────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("igenius");
  const apiUrl = cfg.get<string>("apiUrl", "https://igenius-memory.online/v1");
  const apiKey = cfg.get<string>("apiKey", "");
  const autoRefresh = cfg.get<number>("autoRefreshInterval", 30);
  const showStatusBar = cfg.get<boolean>("showStatusBar", true);

  // ── AI Provider config ──────────────────────────────────
  const aiCfg = vscode.workspace.getConfiguration("igenius.ai");
  const providerConfig = readProviderConfig(aiCfg);

  // ── API client ──────────────────────────────────────────
  const api = new IgeniusApi(apiUrl, apiKey, providerConfig);

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

  // Show Briefing
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
        const doc = await vscode.workspace.openTextDocument({
          content: briefing.briefing,
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
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
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: `Use the visual_report tool to analyze the UI/UX of ${targetUrl}`,
        });
      } catch {
        // Fallback: copy prompt to clipboard
        await vscode.env.clipboard.writeText(
          `Use the visual_report tool to analyze the UI/UX of ${targetUrl}`
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
        baseUrl: aiCfg.get<string>("lmstudio.baseUrl", "http://localhost:1234/v1"),
        model: aiCfg.get<string>("lmstudio.model", "local-model"),
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
