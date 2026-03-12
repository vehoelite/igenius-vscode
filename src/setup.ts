// ── iGenius Memory — First-Run Setup Wizard ───────────────
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// ── Agent instructions template ────────────────────────────
const INSTRUCTIONS_CONTENT = `---
applyTo: '**'
description: iGenius Memory System — agent instructions for persistent memory
---
# iGenius Memory System — Agent Instructions

You have access to the iGenius Memory System via MCP tools. This gives you persistent,
long-term, and short-term memory that survives across sessions and context resets.

## MANDATORY: Session Start & Post-Summarization

At the START of every new conversation **OR after a context summarization**,
IMMEDIATELY call \`memory_briefing\`. A summarization is detected when you see a
\`<conversation-summary>\` block injected into context — treat this as a new session.

This returns a consolidated intelligence briefing from all previous sessions.
Read it carefully — it contains decisions, preferences, credentials, file paths,
open threads, and context you would otherwise lose.

Do NOT skip this step. Do NOT wait for the user to ask. Call it FIRST.
If you detect a \`<conversation-summary>\`, your VERY FIRST action must be \`memory_briefing\`
before doing anything else — including continuing prior work.

## MANDATORY: Continuous Ingestion

For EVERY user message and EVERY significant agent response, call \`memory_ingest\` with:
- \`message\`: the raw text
- \`role\`: "user" or "agent"

This feeds the AI memory engine which extracts facts, decisions, and context automatically.
You do NOT need to decide what's important — the memory AI handles that.

## When Context Gets Large

When you sense your context window is getting full (approaching summarization):
1. Call \`memory_consolidate\` — this merges all accumulated interaction extracts into a
   master briefing
2. The next session will receive this briefing via \`memory_briefing\`

## Available Memory Tools

| Tool | When to use |
|------|-------------|
| \`memory_briefing\` | **FIRST thing** in every new session |
| \`memory_ingest\` | **Every** user message and significant agent response |
| \`memory_consolidate\` | Before context resets or when context is getting full |
| \`memory_process\` | When text contains trigger words (passwords, URLs, configs, etc.) |
| \`memory_search\` | When you need to find something from past sessions |
| \`memory_review\` | When user wants to review short-term catches for triage |
| \`memory_promote\` | When user confirms a short-term memory should be kept long-term |
| \`memory_store\` | When you want to directly save something to a specific layer |
| \`memory_delete\` | When user wants to discard a memory |
| \`memory_recall\` | When you need raw persistent interaction extracts |
| \`memory_update\` | When you need to modify an existing memory |
| \`memory_summarize\` | When you need to compress text using the LLM |
| \`memory_triggers_list\` | View all active trigger patterns |
| \`memory_triggers_add\` | Add a new trigger word/pattern |

## Key Principles

- Memory works across ALL projects and workspaces — it's stored in MySQL, not local files
- Short-term memory is an aggressive catch-all net (60+ trigger words) — users review and promote or discard
- Persistent memory is ephemeral (8h TTL) — it captures the present session
- Long-term memory persists for 365 days — promoted knowledge and decisions
- The briefing is the crown jewel — a pre-digested intelligence report, not raw data
- Ingesting is cheap — do it aggressively. The AI extracts what matters.
`;

// ── MCP server JSON block ──────────────────────────────────
function buildMcpEntry(apiKey: string): object {
  return {
    command: "igenius-mcp",
    env: { IGENIUS_API_KEY: apiKey },
    type: "stdio",
  };
}

// ── Path helpers ───────────────────────────────────────────
function getVscodeDir(): string {
  const home = os.homedir();
  return process.platform === "win32"
    ? path.join(home, ".vscode")
    : path.join(home, ".vscode");
}

function getMcpJsonPath(): string {
  // VS Code stores user-level mcp.json in .vscode/mcp.json on Windows
  // and ~/.vscode/mcp.json on other platforms
  return path.join(getVscodeDir(), "mcp.json");
}

function getPromptsDir(): string {
  return path.join(getVscodeDir(), "prompts");
}

function getInstructionsPath(): string {
  return path.join(getPromptsDir(), "igenius.instructions.md");
}

/** Public accessor for the agent instructions file path */
export function getInstructionsFilePath(): string {
  return getInstructionsPath();
}

/** Ensure the agent instructions file exists, creating from template if needed */
export function ensureInstructionsFile(): void {
  const instrPath = getInstructionsPath();
  ensureDir(getPromptsDir());
  if (!fs.existsSync(instrPath)) {
    fs.writeFileSync(instrPath, INSTRUCTIONS_CONTENT, "utf-8");
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Step 1: API Key ────────────────────────────────────────
async function stepApiKey(): Promise<string | undefined> {
  const choice = await vscode.window.showInformationMessage(
    "🧠 Welcome to iGenius Memory! First, let's set up your API key.",
    "I have a key",
    "Get Free Key",
    "Skip"
  );

  if (choice === "Get Free Key") {
    await vscode.env.openExternal(
      vscode.Uri.parse("https://igenius-memory.online#apikey")
    );
    // Wait for user to come back
    const key = await vscode.window.showInputBox({
      title: "iGenius Memory — API Key",
      prompt:
        "Paste your API key below (starts with ig_). You can get one free at igenius-memory.online",
      placeHolder: "ig_xxxxxx…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v && !v.startsWith("ig_")
          ? 'API key should start with "ig_"'
          : null,
    });
    return key || undefined;
  }

  if (choice === "I have a key") {
    const key = await vscode.window.showInputBox({
      title: "iGenius Memory — API Key",
      prompt: "Paste your iGenius API key (starts with ig_)",
      placeHolder: "ig_xxxxxx…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v && !v.startsWith("ig_")
          ? 'API key should start with "ig_"'
          : null,
    });
    return key || undefined;
  }

  return undefined; // Skip
}

// ── Step 2: MCP Server ─────────────────────────────────────
async function stepMcpServer(apiKey: string | undefined): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    "🔌 Configure the MCP server? This lets Copilot and Claude use your memory tools directly.",
    "Auto-configure",
    "I'll do it manually",
    "Skip"
  );

  if (choice !== "Auto-configure") {
    return false;
  }

  // If user didn't set a key in step 1, ask for one now
  let key = apiKey;
  if (!key) {
    key = await vscode.window.showInputBox({
      title: "iGenius Memory — API Key for MCP",
      prompt: "Paste your API key (starts with ig_) — needed for MCP authentication",
      placeHolder: "ig_xxxxxx…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v && !v.startsWith("ig_")
          ? 'API key should start with "ig_"'
          : null,
    });
    if (!key) return false;
  }

  // Check if igenius-mcp is installed, offer to install
  const installChoice = await vscode.window.showInformationMessage(
    '📦 The MCP server requires the "igenius-mcp" Python package. Install it now?',
    "Install (pip install igenius-mcp)",
    "Already installed",
    "Skip"
  );

  if (installChoice === "Skip") return false;

  if (installChoice === "Install (pip install igenius-mcp)") {
    const terminal = vscode.window.createTerminal("iGenius Setup");
    terminal.show();
    terminal.sendText("pip install igenius-mcp");
    // Give the user a moment to see the install
    await vscode.window.showInformationMessage(
      "⏳ Installing igenius-mcp… Click OK when the install finishes in the terminal.",
      "OK"
    );
  }

  // Read or create mcp.json
  const mcpPath = getMcpJsonPath();
  let mcpConfig: any = {};

  if (fs.existsSync(mcpPath)) {
    try {
      const raw = fs.readFileSync(mcpPath, "utf-8");
      mcpConfig = JSON.parse(raw);
    } catch {
      // If corrupted, start fresh
      mcpConfig = {};
    }
  }

  // Merge our server entry
  if (!mcpConfig.servers) {
    mcpConfig.servers = {};
  }
  mcpConfig.servers["igenius-memory"] = buildMcpEntry(key);

  // Write
  ensureDir(path.dirname(mcpPath));
  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

  vscode.window.showInformationMessage(
    `✅ MCP server configured in ${mcpPath}`
  );
  return true;
}

// ── Step 3: Agent Instructions ─────────────────────────────
async function stepInstructions(): Promise<boolean> {
  const instrPath = getInstructionsPath();
  const alreadyExists = fs.existsSync(instrPath);

  const msg = alreadyExists
    ? "📋 Agent instructions file already exists. Overwrite with latest version?"
    : "📋 Install agent instructions? This teaches Copilot/Claude how to use your memory tools automatically.";

  const options = alreadyExists
    ? ["Overwrite", "Keep existing", "Skip"]
    : ["Install", "Skip"];

  const choice = await vscode.window.showInformationMessage(msg, ...options);

  if (choice === "Install" || choice === "Overwrite") {
    ensureDir(getPromptsDir());
    fs.writeFileSync(instrPath, INSTRUCTIONS_CONTENT, "utf-8");
    vscode.window.showInformationMessage(
      `✅ Agent instructions installed at ${instrPath}`
    );
    return true;
  }

  return false;
}

// ── Step 4: Visual Tools ───────────────────────────────────
async function stepVisualTools(): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    "👁️ Enable iGenius Visual? This gives your agent eyes — it can render UI, " +
      "screenshot it with Playwright, and send it to a local vision model for " +
      "instant visual feedback. Like a syntax check, but for UI.",
    "Yes, set it up",
    "What does it need?",
    "Skip"
  );

  if (choice === "What does it need?") {
    const info = await vscode.window.showInformationMessage(
      "iGenius Visual requires:\n\n" +
        "1. igenius-mcp[visual] — adds Playwright browser engine\n" +
        "2. Chromium — headless browser for rendering\n" +
        "3. A vision model in LM Studio (e.g. Qwen3.5-9B Vision)\n\n" +
        "The pipeline: Your agent builds UI → Playwright renders & screenshots → " +
        "Vision model analyzes the screenshot → Agent gets a detailed report with fixes.",
      "Install now",
      "Skip"
    );
    if (info !== "Install now") return false;
  } else if (choice !== "Yes, set it up") {
    return false;
  }

  // Install igenius-mcp[visual] + playwright chromium
  const terminal = vscode.window.createTerminal("iGenius Visual Setup");
  terminal.show();
  terminal.sendText('pip install "igenius-mcp[visual]" && python -m playwright install chromium');

  const done = await vscode.window.showInformationMessage(
    "⏳ Installing Playwright + Chromium browser…\n\n" +
      "This downloads ~170 MB for the headless browser. " +
      "Click OK when the terminal shows it's finished.",
    "OK",
    "Cancel"
  );

  if (done !== "OK") return false;

  // Remind about vision model
  await vscode.window.showInformationMessage(
    "🧠 Almost there! Make sure you have a vision-capable model loaded in LM Studio.\n\n" +
      "Recommended: Qwen3.5-9B Vision (or any model with image understanding).\n" +
      "Keep LM Studio running — the visual tools connect to it automatically.",
    "Got it"
  );

  vscode.window.showInformationMessage(
    "✅ iGenius Visual installed! Your agent can now use visual_report and visual_screenshot tools."
  );
  return true;
}

// ── Step 5: Completion ─────────────────────────────────────
async function stepComplete(
  apiKeySet: boolean,
  mcpConfigured: boolean,
  instructionsInstalled: boolean,
  visualInstalled: boolean
): Promise<void> {
  const parts: string[] = [];
  if (apiKeySet) parts.push("✅ API key saved");
  if (mcpConfigured) parts.push("✅ MCP server configured");
  if (instructionsInstalled) parts.push("✅ Agent instructions installed");
  if (visualInstalled) parts.push("👁️ Visual tools installed");

  if (parts.length === 0) {
    vscode.window.showInformationMessage(
      "🧠 iGenius Memory is ready! You can run setup anytime via 'iGenius: Run Setup Wizard' in the command palette."
    );
    return;
  }

  const summary = parts.join("  •  ");

  const choice = await vscode.window.showInformationMessage(
    `🧠 iGenius Memory setup complete!\n\n${summary}`,
    "Open Sidebar",
    "Read Docs",
    "Done"
  );

  if (choice === "Open Sidebar") {
    vscode.commands.executeCommand("igenius.sidebar.focus");
  } else if (choice === "Read Docs") {
    vscode.env.openExternal(
      vscode.Uri.parse("https://igenius-memory.info")
    );
  }
}

// ── Main Wizard Runner ─────────────────────────────────────
export async function runSetupWizard(
  context: vscode.ExtensionContext,
  options: { isFirstInstall?: boolean } = {}
): Promise<void> {
  let apiKeySet = false;
  let mcpConfigured = false;
  let instructionsInstalled = false;
  let visualInstalled = false;

  // Step 1: API Key
  const apiKey = await stepApiKey();
  if (apiKey) {
    await vscode.workspace
      .getConfiguration("igenius")
      .update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
    apiKeySet = true;
  }

  // Step 2: MCP Server
  mcpConfigured = await stepMcpServer(apiKey);

  // Step 3: Agent Instructions
  instructionsInstalled = await stepInstructions();

  // Step 4: Visual Tools (Playwright + Vision Model)
  visualInstalled = await stepVisualTools();

  // Step 5: Summary
  await stepComplete(apiKeySet, mcpConfigured, instructionsInstalled, visualInstalled);

  // Full restart is required for first install (activity bar, MCP, etc.)
  if (apiKeySet || mcpConfigured || visualInstalled) {
    const isFirst = options.isFirstInstall === true;
    const restartMsg = isFirst
      ? "⚠️ Important: For the first install, you need to fully CLOSE VS Code " +
        "and reopen it (not just reload). This activates the brain icon in the " +
        "Activity Bar, the MCP server connection, and all visual tools."
      : "Restart VS Code to activate all changes? For best results, " +
        "fully close and reopen VS Code (not just reload).";

    const restart = await vscode.window.showWarningMessage(
      restartMsg,
      "Close VS Code Now",
      "I'll restart later"
    );
    if (restart === "Close VS Code Now") {
      // workbench.action.quit fully closes VS Code
      vscode.commands.executeCommand("workbench.action.quit");
    }
  }
}
