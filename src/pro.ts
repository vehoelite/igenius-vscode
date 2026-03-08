// ── iGenius Memory — Pro: Continuous Readiness Engine ─────
//
// Instead of reactively detecting summarization, we keep the briefing
// perpetually warm.  Background loop consolidates after N ingests and
// regenerates the briefing cache so that when an agent calls
// `memory_briefing` post-summary, the response is instant (<100ms).
// ──────────────────────────────────────────────────────────

import * as vscode from "vscode";
import { IgeniusApi } from "./api";
import type { BriefingResponse } from "./types";

// ── Options ───────────────────────────────────────────────

export interface ProOptions {
  /** Enable Pro continuous readiness engine */
  enabled: boolean;
  /** Warm-cycle interval in seconds (default 120 = 2 min) */
  warmIntervalSec: number;
  /** Auto-consolidate after this many ingests (default 8) */
  consolidateThreshold: number;
}

const DEFAULTS: ProOptions = {
  enabled: true,
  warmIntervalSec: 120,
  consolidateThreshold: 8,
};

// ── ProMemoryManager ──────────────────────────────────────

export class ProMemoryManager implements vscode.Disposable {
  private readonly api: IgeniusApi;
  private readonly log: vscode.OutputChannel;

  private warmthTimer: ReturnType<typeof setInterval> | undefined;
  private ingestCount = 0;
  private totalIngests = 0;
  private consolidateThreshold: number;
  private warmIntervalMs: number;
  private cachedBriefing: BriefingResponse | null = null;
  private lastWarmTime = 0;
  private running = false;
  private enabled: boolean;

  // Event: fires when the briefing cache is refreshed
  private _onBriefingWarmed = new vscode.EventEmitter<BriefingResponse>();
  readonly onDidWarmBriefing = this._onBriefingWarmed.event;

  constructor(api: IgeniusApi, opts: Partial<ProOptions> = {}) {
    const o = { ...DEFAULTS, ...opts };
    this.api = api;
    this.enabled = o.enabled;
    this.consolidateThreshold = o.consolidateThreshold;
    this.warmIntervalMs = o.warmIntervalSec * 1000;
    this.log = vscode.window.createOutputChannel("iGenius Pro");
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start the continuous-readiness engine.
   * Fires an immediate warm cycle, then repeats on the configured interval.
   */
  start(): void {
    if (!this.enabled) {
      this.log.appendLine("[Pro] Disabled — skipping start");
      return;
    }
    if (this.running) {
      return;
    }
    this.running = true;
    this.log.appendLine(
      `[Pro] Starting — interval ${this.warmIntervalMs / 1000}s, ` +
        `consolidate every ${this.consolidateThreshold} ingests`
    );

    // Immediate first warm cycle
    this.warmCycle();

    // Recurring timer
    this.warmthTimer = setInterval(() => this.warmCycle(), this.warmIntervalMs);
  }

  /** Stop the warmth loop (can be restarted later with start()). */
  stop(): void {
    if (this.warmthTimer) {
      clearInterval(this.warmthTimer);
      this.warmthTimer = undefined;
    }
    this.running = false;
    this.log.appendLine("[Pro] Stopped");
  }

  dispose(): void {
    this.stop();
    this._onBriefingWarmed.dispose();
    this.log.dispose();
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Call after every ingest (sidebar, command, auto-ingest, etc.).
   * Increments counter and triggers immediate consolidation when threshold is reached.
   */
  notifyIngest(): void {
    if (!this.enabled) {
      return;
    }
    this.ingestCount++;
    this.totalIngests++;
    this.log.appendLine(
      `[Pro] Ingest #${this.totalIngests} ` +
        `(${this.ingestCount}/${this.consolidateThreshold} until consolidate)`
    );

    if (this.ingestCount >= this.consolidateThreshold) {
      this.log.appendLine(
        "[Pro] Threshold reached — triggering immediate consolidation"
      );
      this.warmCycle(true);
    }
  }

  /** Returns the pre-cached briefing (instant, no network). */
  getCachedBriefing(): BriefingResponse | null {
    return this.cachedBriefing;
  }

  /** Returns engine telemetry. */
  getStats() {
    return {
      running: this.running,
      enabled: this.enabled,
      totalIngests: this.totalIngests,
      pendingIngests: this.ingestCount,
      consolidateThreshold: this.consolidateThreshold,
      warmIntervalSec: this.warmIntervalMs / 1000,
      lastWarmTime: this.lastWarmTime,
      hasCachedBriefing: this.cachedBriefing !== null,
    };
  }

  /** Live-update options without full restart. */
  updateOptions(opts: Partial<ProOptions>): void {
    let needsRestart = false;

    if (opts.enabled !== undefined && opts.enabled !== this.enabled) {
      this.enabled = opts.enabled;
      if (!this.enabled) {
        this.stop();
        return;
      }
      if (!this.running) {
        needsRestart = true;
      }
    }
    if (opts.consolidateThreshold !== undefined) {
      this.consolidateThreshold = opts.consolidateThreshold;
    }
    if (
      opts.warmIntervalSec !== undefined &&
      opts.warmIntervalSec * 1000 !== this.warmIntervalMs
    ) {
      this.warmIntervalMs = opts.warmIntervalSec * 1000;
      needsRestart = this.running; // restart timer with new interval
    }
    if (needsRestart) {
      this.stop();
      this.start();
    }
  }

  // ── Core warm cycle ─────────────────────────────────────

  private async warmCycle(forceConsolidate = false): Promise<void> {
    const t0 = Date.now();
    try {
      // 1. Consolidate if threshold reached (or forced)
      if (forceConsolidate || this.ingestCount >= this.consolidateThreshold) {
        this.log.appendLine("[Pro] Consolidating…");
        try {
          const res = await this.api.consolidate();
          this.log.appendLine(
            res.consolidated
              ? "[Pro] ✓ Consolidated"
              : "[Pro] ○ Nothing to consolidate"
          );
        } catch (err: any) {
          this.log.appendLine(`[Pro] ✗ Consolidate error: ${err.message}`);
        }
        this.ingestCount = 0; // reset counter regardless
      }

      // 2. Refresh briefing cache
      this.log.appendLine("[Pro] Warming briefing…");
      const briefing = await this.api.briefing();
      this.cachedBriefing = briefing;
      this.lastWarmTime = Date.now();
      this._onBriefingWarmed.fire(briefing);

      const s = briefing.stats;
      const ms = Date.now() - t0;
      this.log.appendLine(
        `[Pro] ✓ Briefing warm in ${ms}ms — ` +
          `${s.total_count} memories (P:${s.persistent_count} L:${s.long_term_count} S:${s.short_term_count})`
      );
    } catch (err: any) {
      this.log.appendLine(`[Pro] ✗ Warm cycle failed: ${err.message}`);
    }
  }

  // ── Fallback: Output Channel Watch (Option D) ───────────
  //
  // Defense-in-depth.  Monitors text document changes across VS Code
  // for strings that indicate Copilot Chat is summarizing the
  // conversation.  When detected, fires an emergency consolidation +
  // warm cycle regardless of timer state.
  //
  // This catches edge cases where a burst of tool calls pushes past
  // the threshold faster than the next warm cycle.
  // ────────────────────────────────────────────────────────

  private static readonly COMPACTION_PATTERNS = [
    "Summarizing conversation history",
    "conversation-summary",
    "Compacting conversation",
    "context window is getting full",
    "summarizeAgentConversation",
  ];

  /** Debounce guard — ignore re-fires within this window. */
  private lastFallbackFire = 0;
  private static readonly FALLBACK_DEBOUNCE_MS = 30_000; // 30s cooldown

  /**
   * Create disposable watchers for the fallback detector.
   * Call once in activate() and push the returned disposable
   * into context.subscriptions.
   */
  createFallbackWatcher(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    // 1. Watch text-document changes (output channels are virtual docs)
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        // Only check output-scheme docs and untitled docs (some output channels use these)
        const scheme = e.document.uri.scheme;
        if (scheme !== "output" && scheme !== "vscode-output") {
          return;
        }
        for (const change of e.contentChanges) {
          if (this.matchesCompaction(change.text)) {
            this.onFallbackTriggered("doc-change");
            return;
          }
        }
      })
    );

    // 2. Watch terminal output (some agents echo summarization to terminal)
    disposables.push(
      vscode.window.onDidWriteTerminalData((e) => {
        if (this.matchesCompaction(e.data)) {
          this.onFallbackTriggered("terminal");
        }
      })
    );

    this.log.appendLine(
      `[Pro:Fallback] Watcher armed — monitoring for ${ProMemoryManager.COMPACTION_PATTERNS.length} patterns`
    );

    return vscode.Disposable.from(...disposables);
  }

  private matchesCompaction(text: string): boolean {
    const lower = text.toLowerCase();
    return ProMemoryManager.COMPACTION_PATTERNS.some((p) =>
      lower.includes(p.toLowerCase())
    );
  }

  private onFallbackTriggered(source: string): void {
    const now = Date.now();
    if (now - this.lastFallbackFire < ProMemoryManager.FALLBACK_DEBOUNCE_MS) {
      this.log.appendLine(
        `[Pro:Fallback] Pattern detected (${source}) but within debounce window — ignoring`
      );
      return;
    }
    this.lastFallbackFire = now;
    this.log.appendLine(
      `[Pro:Fallback] ⚡ Compaction detected via ${source}! Emergency consolidation + warm cycle`
    );
    // Fire-and-forget emergency cycle
    this.warmCycle(true);
  }
}
