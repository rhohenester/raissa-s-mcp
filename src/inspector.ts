import { TransportType, ToolDefinition } from "./transport/types.js";

/** Result of a successful endpoint inspection. */
export interface InspectionResult {
  /** Detected (or confirmed) transport type. */
  transport: TransportType;
  /** Ready-to-use connection config for the detected transport. */
  config: Record<string, unknown>;
  /**
   * Tools discovered from the endpoint.
   * May be empty for stdio/SSE endpoints that don't self-describe on first
   * contact (tool discovery would happen after establishing the session).
   */
  tools: ToolDefinition[];
}

/**
 * Probe an unknown endpoint and auto-detect the transport type.
 *
 * Detection order:
 *  1. If `hint` is provided, try that transport first.
 *  2. HTTP  — GET the URL; if the JSON body has `{ tools: [...] }`, it's HTTP.
 *  3. Stdio — if the path starts with `./` or `/`, treat it as an executable.
 *  4. SSE   — if the server responds with `Content-Type: text/event-stream`.
 *
 * @throws if no transport can be detected.
 */
export async function inspectEndpoint(
  endpoint: string,
  hint?: TransportType
): Promise<InspectionResult> {
  // --- Hinted probe --------------------------------------------------------
  if (hint !== undefined) {
    const hintResult = await probeWithHint(endpoint, hint);
    if (hintResult) return hintResult;
    console.warn(
      `[inspector] Hinted transport "${hint}" did not match "${endpoint}", falling back to auto-detect.`
    );
  }

  // --- HTTP probe ----------------------------------------------------------
  const httpResult = await tryHttpProbe(endpoint);
  if (httpResult) return httpResult;

  // --- Stdio probe (path-based heuristic) ----------------------------------
  const stdioResult = tryStdioProbe(endpoint);
  if (stdioResult) return stdioResult;

  // --- SSE probe -----------------------------------------------------------
  const sseResult = await trySseProbe(endpoint);
  if (sseResult) return sseResult;

  throw new Error(
    `[inspector] Could not detect a compatible MCP transport for endpoint: ${endpoint}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function probeWithHint(
  endpoint: string,
  hint: TransportType
): Promise<InspectionResult | null> {
  switch (hint) {
    case TransportType.Http:
      return tryHttpProbe(endpoint);
    case TransportType.Stdio:
      return tryStdioProbe(endpoint);
    case TransportType.Sse:
      return trySseProbe(endpoint);
    default: {
      const _: never = hint;
      return null;
    }
  }
}

/**
 * Try to reach the endpoint as an HTTP MCP server.
 * A valid HTTP MCP server responds to GET / with a JSON body that contains
 * a `tools` array.
 */
async function tryHttpProbe(endpoint: string): Promise<InspectionResult | null> {
  // Only attempt HTTP probe for URLs that look like HTTP(S)
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;

    const body = (await response.json()) as Record<string, unknown>;

    if (Array.isArray(body["tools"])) {
      return {
        transport: TransportType.Http,
        config: { baseUrl: endpoint },
        tools: body["tools"] as ToolDefinition[],
      };
    }

    // Server responded with JSON but no tool list — still accept as HTTP
    return {
      transport: TransportType.Http,
      config: { baseUrl: endpoint },
      tools: [],
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic stdio detection: if the endpoint looks like a filesystem path,
 * treat it as a command to spawn.
 */
function tryStdioProbe(endpoint: string): InspectionResult | null {
  if (
    endpoint.startsWith("./") ||
    endpoint.startsWith("../") ||
    endpoint.startsWith("/")
  ) {
    return {
      transport: TransportType.Stdio,
      config: { command: endpoint, args: [] },
      // Tool discovery for stdio happens after spawning the process
      tools: [],
    };
  }
  return null;
}

/**
 * Detect an SSE endpoint by checking whether the server advertises
 * `Content-Type: text/event-stream`.
 */
async function trySseProbe(endpoint: string): Promise<InspectionResult | null> {
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(3_000),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      // Abort the streaming body — we only needed the headers
      await response.body?.cancel();
      return {
        transport: TransportType.Sse,
        config: { url: endpoint },
        tools: [],
      };
    }

    return null;
  } catch {
    return null;
  }
}
