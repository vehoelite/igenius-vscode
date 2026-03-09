// ── iGenius Memory — API Client ───────────────────────────
import * as https from "https";
import * as http from "http";
import type {
  BriefingResponse,
  HealthResponse,
  IngestResponse,
  Memory,
  ProviderConfig,
  SearchResult,
} from "./types";

export class IgeniusApi {
  private baseUrl: string;
  private apiKey: string;
  private providerConfig: ProviderConfig;

  constructor(baseUrl: string, apiKey: string, providerConfig?: ProviderConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.providerConfig = providerConfig ?? { provider: "lmstudio" };
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  setProviderConfig(config: ProviderConfig) {
    this.providerConfig = config;
  }

  // ── Core request helper ──────────────────────────────────
  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = 15000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === "https:";
      const lib = isHttps ? https : http;

      const options: http.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
          "User-Agent": "iGenius-VSCode/0.2.0",
          ...(this.providerConfig.provider && {
            "X-LLM-Provider": this.providerConfig.provider,
          }),
          ...(this.providerConfig.apiKey && {
            "X-LLM-Api-Key": this.providerConfig.apiKey,
          }),
          ...(this.providerConfig.model && {
            "X-LLM-Model": this.providerConfig.model,
          }),
          ...(this.providerConfig.baseUrl && {
            "X-LLM-Base-Url": this.providerConfig.baseUrl,
          }),
        },
        timeout: timeoutMs,
      };

      const req = lib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
            }
          } else {
            let detail = data;
            try {
              const parsed = JSON.parse(data);
              detail = parsed.detail || parsed.message || data;
            } catch {
              // use raw
            }
            reject(new Error(`HTTP ${res.statusCode}: ${detail}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // ── API methods ──────────────────────────────────────────

  health(): Promise<HealthResponse> {
    return this.request("GET", "/health");
  }

  briefing(force: boolean = false): Promise<BriefingResponse> {
    const qs = force ? "?force=true" : "";
    return this.request("GET", `/briefing${qs}`, undefined, 120000);
  }

  async getMemoriesByLayer(layer: string): Promise<Memory[]> {
    const res = await this.request<{ memories: Memory[]; count: number }>(
      "GET",
      `/memories/layer/${layer}`
    );
    return res.memories ?? [];
  }

  async searchMemories(query: string): Promise<SearchResult> {
    const encoded = encodeURIComponent(query);
    const res = await this.request<{ results: Memory[]; count: number }>(
      "GET",
      `/memories/search?q=${encoded}`
    );
    // Server returns {results, count} — normalize to {memories, query, count}
    return { memories: res.results ?? [], query, count: res.count ?? 0 };
  }

  async getReviewQueue(): Promise<Memory[]> {
    const res = await this.request<{ memories: Memory[]; count: number }>(
      "GET",
      "/memories/review"
    );
    return res.memories ?? [];
  }

  ingest(message: string, role: string = "user"): Promise<IngestResponse> {
    return this.request("POST", "/ingest", { message, role });
  }

  storeMemory(
    content: string,
    layer: string,
    title?: string,
    category?: string,
    importance?: number
  ): Promise<Memory> {
    return this.request("POST", "/memories", {
      content,
      layer,
      title,
      category: category || "note",
      importance: importance || 50,
    });
  }

  promoteMemory(memoryId: number): Promise<{ promoted: boolean }> {
    return this.request("POST", `/memories/${memoryId}/promote`, {});
  }

  deleteMemory(memoryId: number): Promise<{ deleted: boolean }> {
    return this.request("DELETE", `/memories/${memoryId}`);
  }

  updateMemory(
    memoryId: number,
    updates: Partial<Pick<Memory, "title" | "content" | "importance">>
  ): Promise<Memory> {
    return this.request("PATCH", `/memories/${memoryId}`, updates);
  }

  consolidate(): Promise<{ consolidated: boolean; briefing: string }> {
    return this.request("POST", "/consolidate", {});
  }
}
