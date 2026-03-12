// ── iGenius Memory — Status Bar ───────────────────────────
import * as vscode from "vscode";
import { IgeniusApi } from "./api";

export class StatusBar {
  private item: vscode.StatusBarItem;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private _paused = false;

  constructor(private readonly api: IgeniusApi) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50
    );
    this.item.command = "igenius.showBriefing";
    this.item.tooltip = "iGenius Memory — click for briefing";
    this.item.text = "$(brain) iGenius";
    this.item.show();
  }

  /** Start periodic refresh */
  startAutoRefresh(intervalSec: number) {
    this.stopAutoRefresh();
    if (this._paused) { return; }
    this.update(); // immediate first tick
    this.refreshTimer = setInterval(() => this.update(), intervalSec * 1000);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** Pause the status bar — stops auto-refresh and shows paused indicator */
  pause() {
    this._paused = true;
    this.stopAutoRefresh();
    this.item.text = "$(brain) iGenius ⏸";
    this.item.tooltip = "iGenius Memory — PAUSED (click to show briefing)";
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }

  /** Resume the status bar — restarts auto-refresh */
  resume(intervalSec: number) {
    this._paused = false;
    this.item.backgroundColor = undefined;
    this.startAutoRefresh(intervalSec);
  }

  get paused() { return this._paused; }

  async update() {
    const key = vscode.workspace
      .getConfiguration("igenius")
      .get<string>("apiKey", "");
    if (!key) {
      this.item.text = "$(brain) iGenius: No Key";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      return;
    }

    try {
      const health = await this.api.health();
      if (health.status === "ok") {
        // Try to get quick stats by fetching each layer count
        const [persistent, longTerm, shortTerm] = await Promise.all([
          this.api.getMemoriesByLayer("persistent").catch(() => []),
          this.api.getMemoriesByLayer("long_term").catch(() => []),
          this.api.getMemoriesByLayer("short_term").catch(() => []),
        ]);
        const total = persistent.length + longTerm.length + shortTerm.length;
        this.item.text = `$(brain) ${total} memories`;
        this.item.tooltip = `iGenius Memory — ${persistent.length}P / ${longTerm.length}LT / ${shortTerm.length}ST\nClick for briefing`;
        this.item.backgroundColor = undefined;
      }
    } catch {
      this.item.text = "$(brain) iGenius ✗";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    }
  }

  dispose() {
    this.stopAutoRefresh();
    this.item.dispose();
  }
}
