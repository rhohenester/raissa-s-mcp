import { Transport, TransportType } from "./types.js";

/**
 * HTTP transport: speaks to an MCP provider over plain HTTP/HTTPS.
 *
 * Expected provider config shape:
 * ```
 * { baseUrl: "https://example.com/mcp" }
 * ```
 *
 * Health check  → GET  {baseUrl}/health
 * Tool invoke   → POST {baseUrl}/tools/{toolName}  body: { params }
 */
export class HttpTransport implements Transport {
  transportType(): TransportType {
    return TransportType.Http;
  }

  async checkHealth(config: Record<string, unknown>): Promise<boolean> {
    const baseUrl = config["baseUrl"] as string;
    if (!baseUrl) return false;

    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async invokeTools(
    config: Record<string, unknown>,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const baseUrl = config["baseUrl"] as string;
    if (!baseUrl) {
      throw new Error("HttpTransport: missing required config field 'baseUrl'");
    }

    const url = `${baseUrl}/tools/${encodeURIComponent(toolName)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HttpTransport: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`
      );
    }

    return response.json() as Promise<unknown>;
  }
}
