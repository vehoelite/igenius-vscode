// ── iGenius Memory — Status Bar ───────────────────────────
import * as vscode from "vscode";
import { IgeniusApi } from "./api";

export class StatusBar {
  private item: vscode.StatusBarItem;
  private refreshTimer?: ReturnType<typeof setInterval>;

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
    this.update(); // immediate first tick
    this.refreshTimer = setInterval(() => this.update(), intervalSec * 1000);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

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
