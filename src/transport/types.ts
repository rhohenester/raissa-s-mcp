// ---------------------------------------------------------------------------
// Core transport-layer types shared across the entire MCP implementation.
// ---------------------------------------------------------------------------

/** The wire protocol used to reach an MCP provider. */
export enum TransportType {
  Http = "http",
  Stdio = "stdio",
  Sse = "sse",
}

/**
 * Every concrete transport (HTTP, stdio, SSE, …) must implement this interface.
 * A transport knows how to talk to one class of MCP server; it is stateless —
 * all connection details are passed in via `config` at call time.
 */
export interface Transport {
  /** Return the type tag for this transport implementation. */
  transportType(): TransportType;

  /**
   * Invoke a named tool on the remote provider.
   *
   * @param config   Connection-specific settings (e.g. `{ baseUrl }` for HTTP,
   *                 `{ command, args }` for stdio).
   * @param toolName The tool to invoke.
   * @param params   Arbitrary key/value input for the tool.
   * @returns        The tool's raw result (caller is responsible for typing).
   */
  invokeTools(
    config: Record<string, unknown>,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown>;

  /**
   * Check whether the provider is reachable and healthy.
   *
   * @param config  Same connection settings as `invokeTools`.
   * @returns       `true` if the provider responded successfully.
   */
  checkHealth(config: Record<string, unknown>): Promise<boolean>;
}

/** JSON-Schema–style description of a single tool exposed by an MCP provider. */
export interface ToolDefinition {
  /** Machine-readable tool identifier, e.g. `"calculator"`. */
  name: string;
  /** Human-readable explanation of what the tool does. */
  description: string;
  /**
   * JSON Schema object describing the tool's input parameters.
   * Follows standard JSON Schema draft-07 conventions.
   */
  inputSchema: Record<string, unknown>;
}

/** Metadata for a registered MCP provider. */
export interface McpProvider {
  /** Stable, unique identifier for this provider (e.g. `"built-in"`, `"weather-api"`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Which wire protocol to use when talking to this provider. */
  transportType: TransportType;
  /**
   * Transport-specific connection settings passed directly to the transport's
   * `invokeTools` / `checkHealth` methods.
   */
  connectionConfig: Record<string, unknown>;
  /** Whether the provider should be included in active tool-routing. */
  isActive: boolean;
  /** Last known health state, updated by the lifecycle manager. */
  healthStatus: "healthy" | "unhealthy" | "unknown";
}

/** Result returned after executing a tool call (used for logging / structured responses). */
export interface ToolCallResult {
  /** The tool that was invoked. */
  toolName: string;
  /** Raw value returned by the tool on success. */
  result: unknown;
  /** Error message if the invocation failed. */
  error?: string;
}
