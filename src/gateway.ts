import { McpRegistry } from "./registry.js";
import {
  McpProvider,
  ToolDefinition,
  TransportType,
} from "./transport/types.js";
import { createTransport } from "./transport/index.js";
import { executeBuiltInTool } from "./server.js";

/**
 * Central coordinator for all MCP operations.
 *
 * The gateway sits between callers (chat session, lifecycle manager, CLI) and
 * the actual transports.  It:
 *  - Consults the registry for provider metadata
 *  - Short-circuits the `"built-in"` provider to in-process execution
 *  - Creates a fresh transport instance for each external provider call
 *    (transports are intentionally stateless)
 *
 * Central coordinator for all MCP operations.
 */
export class McpGateway {
  private registry: McpRegistry;

  constructor(registry: McpRegistry) {
    this.registry = registry;
  }

  // ---------------------------------------------------------------------------
  // Query / listing
  // ---------------------------------------------------------------------------

  /** Return all active providers from the registry. */
  listProviders(): McpProvider[] {
    return this.registry.listActiveProviders();
  }

  /** Return all tools registered for a specific provider. */
  listTools(providerId: string): ToolDefinition[] {
    return this.registry.listTools(providerId);
  }

  // ---------------------------------------------------------------------------
  // Health check (used by lifecycle manager)
  // ---------------------------------------------------------------------------

  /**
   * Perform a health handshake with a provider.
   *
   * The built-in in-process provider is always considered healthy.
   * For external providers the appropriate transport's `checkHealth` is called.
   *
   * @returns `true` if the provider is healthy.
   */
  async handshake(provider: McpProvider): Promise<boolean> {
    // The built-in provider runs in-process — it's always reachable
    if (provider.id === "built-in") return true;

    try {
      const transport = createTransport(provider.transportType);
      return await transport.checkHealth(provider.connectionConfig);
    } catch (err) {
      console.error(
        `[gateway] Health check failed for provider "${provider.id}":`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tool invocation
  // ---------------------------------------------------------------------------

  /**
   * Invoke a tool on a provider.
   *
   * Built-in tools are executed in-process via `executeBuiltInTool`.
   * External providers are reached through the transport configured for them
   * in the registry.
   *
   * @param providerId  The provider that owns the tool.
   * @param toolName    The tool to invoke.
   * @param params      Input parameters for the tool.
   * @returns           The raw tool result (caller is responsible for typing).
   *
   * @throws if the provider is not found or the transport call fails.
   */
  async invokeTool(
    providerId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // Short-circuit: built-in provider is always in-process
    if (providerId === "built-in") {
      return executeBuiltInTool(toolName, params);
    }

    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      throw new Error(
        `[gateway] Provider not found: "${providerId}". ` +
          `Active providers: ${
            this.registry
              .listActiveProviders()
              .map((p) => p.id)
              .join(", ") || "none"
          }`,
      );
    }

    if (!provider.isActive) {
      throw new Error(
        `[gateway] Provider "${providerId}" is registered but not active.`,
      );
    }

    const transport = createTransport(provider.transportType);
    return transport.invokeTools(provider.connectionConfig, toolName, params);
  }

  // ---------------------------------------------------------------------------
  // Convenience: list all tools across all active providers
  // ---------------------------------------------------------------------------

  /**
   * Convenience wrapper around `registry.listAllTools()`.
   * Returns every tool from every active provider, annotated with providerId.
   */
  listAllTools(): Array<{ providerId: string } & ToolDefinition> {
    return this.registry.listAllTools();
  }
}
