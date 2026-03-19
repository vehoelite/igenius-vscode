// ── iGenius Memory — Type definitions ──────────────────────

export type LLMProvider = "lmstudio" | "openai" | "anthropic" | "google";

export interface ProviderConfig {
  provider: LLMProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface Memory {
  id: number;
  layer: "persistent" | "short_term" | "long_term" | "pinned";
  title: string;
  content: string;
  category: string;
  importance: number;
  key_facts: string[];
  source: string;
  project: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface BriefingResponse {
  briefing: string;
  stats: {
    persistent_count: number;
    long_term_count: number;
    short_term_count: number;
    total_count: number;
    recent_memories: Memory[];
  };
}

export interface MemoryStats {
  persistent_count: number;
  long_term_count: number;
  short_term_count: number;
  total_count: number;
}

export interface IngestResponse {
  ingested: boolean;
  memory_id: number;
  title: string;
  summary: string;
  category: string;
  importance: number;
  key_facts: string[];
}

export interface SearchResult {
  memories: Memory[];
  query: string;
  count: number;
}

export interface HealthResponse {
  status: string;
  provider: string;
}

/** Messages from extension → webview */
export type ToWebviewMessage =
  | { type: "briefing"; data: BriefingResponse }
  | { type: "memories"; layer: string; data: Memory[] }
  | { type: "search-results"; data: SearchResult }
  | { type: "error"; message: string }
  | { type: "loading"; loading: boolean }
  | { type: "stats"; data: MemoryStats }
  | { type: "promote-ok"; memoryId: number }
  | { type: "delete-ok"; memoryId: number }
  | { type: "store-ok"; memory: Memory }
  | { type: "pinned-memories"; data: Memory[] }
  | { type: "pin-stored"; memory: Memory }
  | { type: "pin-updated"; memory: Memory }
  | { type: "pin-deleted"; memoryId: number }
  | { type: "no-api-key" }
  | { type: "pause-state"; paused: boolean }
  | { type: "project-changed"; project: string | null };

/** Messages from webview → extension */
export type FromWebviewMessage =
  | { type: "ready" }
  | { type: "get-briefing" }
  | { type: "get-memories"; layer: string }
  | { type: "search"; query: string }
  | { type: "promote"; memoryId: number }
  | { type: "delete"; memoryId: number }
  | { type: "refresh" }
  | { type: "open-settings" }
  | { type: "open-store" }
  | { type: "set-api-key" }
  | { type: "add-long-term-memory" }
  | { type: "edit-instructions" }
  | { type: "configure-mcp-approvals" }
  | { type: "visual-report"; url: string }
  | { type: "visual-screenshot"; url: string }
  | { type: "toggle-pause" }
  | { type: "set-project" };
  | { type: "store-pin"; title: string; content: string; category: string; project: string | null }
  | { type: "update-pin"; memoryId: number; title: string; content: string; category: string }
  | { type: "delete-pin"; memoryId: number }
  | { type: "get-pinned" };
