import { McpProvider, ToolDefinition } from "./transport/types.js";

/**
 * In-memory registry for MCP providers and their tools.
 *
 * Keeps everything in plain `Map` objects for simplicity.
 * Swap this class out for a persistence layer (SQLite, Postgres, …)
 * by implementing the same interface.
 */
export class McpRegistry {
  /** All registered providers, keyed by their stable `id`. */
  private providers: Map<string, McpProvider> = new Map();

  /**
   * Tool lists for each provider, keyed by `providerId`.
   * A provider may expose zero or more tools.
   */
  private tools: Map<string, ToolDefinition[]> = new Map();

  // ---------------------------------------------------------------------------
  // Provider management
  // ---------------------------------------------------------------------------

  /** Register a new provider.  Overwrites any existing provider with the same id. */
  registerProvider(provider: McpProvider): void {
    this.providers.set(provider.id, { ...provider });
  }

  /**
   * Partially update a registered provider.
   * Silently ignores the call if the provider id is not found.
   */
  updateProvider(id: string, updates: Partial<McpProvider>): void {
    const existing = this.providers.get(id);
    if (existing) {
      this.providers.set(id, { ...existing, ...updates });
    }
  }

  /** Retrieve a provider by id, or `undefined` if not found. */
  getProvider(id: string): McpProvider | undefined {
    return this.providers.get(id);
  }

  /** Return every provider that has `isActive === true`. */
  listActiveProviders(): McpProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isActive);
  }

  // ---------------------------------------------------------------------------
  // Tool management
  // ---------------------------------------------------------------------------

  /**
   * Replace the complete tool list for a provider.
   * Called after a successful inspector probe or on startup for built-in tools.
   */
  registerTools(providerId: string, tools: ToolDefinition[]): void {
    this.tools.set(
      providerId,
      tools.map((t) => ({ ...t })),
    );
  }

  /** Return all tools registered for a specific provider (empty array if none). */
  listTools(providerId: string): ToolDefinition[] {
    return this.tools.get(providerId) ?? [];
  }

  /**
   * Return every tool from every registered provider, annotated with the
   * provider id.  Useful for building the LLM system prompt.
   */
  listAllTools(): Array<{ providerId: string } & ToolDefinition> {
    const result: Array<{ providerId: string } & ToolDefinition> = [];

    for (const [providerId, toolList] of this.tools) {
      // Only include tools for active providers
      const provider = this.providers.get(providerId);
      if (!provider?.isActive) continue;

      for (const tool of toolList) {
        result.push({ providerId, ...tool });
      }
    }

    return result;
  }
}
