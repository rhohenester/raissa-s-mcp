import { McpRegistry } from "./registry.js";
import { McpGateway } from "./gateway.js";

/**
 * Periodic background health checker for all active MCP providers.
 *
 * On each tick it iterates the
 * active providers, calls `gateway.handshake()` for each one, and writes the
 * result back into the registry so the rest of the system sees up-to-date
 * health state.
 *
 * Usage:
 * ```ts
 * const lm = new McpLifecycleManager(registry, gateway, 30_000);
 * lm.start();          // begin health checks every 30 s
 * // …
 * lm.stop();           // stop before process exit
 * ```
 */
export class McpLifecycleManager {
  private registry: McpRegistry;
  private gateway: McpGateway;
  private intervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(registry: McpRegistry, gateway: McpGateway, intervalMs: number) {
    this.registry = registry;
    this.gateway = gateway;
    this.intervalMs = intervalMs;
  }

  /**
   * Start the background health-check loop.
   * Calling `start()` on an already-running manager is a no-op.
   */
  start(): void {
    if (this.intervalId !== null) return;

    this.intervalId = setInterval(() => {
      // Intentionally fire-and-forget: errors are caught inside performHealthCheck
      void this.performHealthCheck();
    }, this.intervalMs);

    // Allow the Node.js process to exit even while this interval is live
    if (typeof this.intervalId === "object" && "unref" in this.intervalId) {
      (this.intervalId as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the background health-check loop.
   * Safe to call multiple times or before `start()`.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Whether the lifecycle manager is currently running. */
  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Run one round of health checks across all active providers.
   *
   * Updates each provider's `healthStatus` in the registry:
   *  - `"healthy"`   if the handshake succeeded
   *  - `"unhealthy"` if it failed or threw
   *
   * This method is also callable directly for testing / manual checks.
   */
  async performHealthCheck(): Promise<void> {
    const providers = this.registry.listActiveProviders();

    if (providers.length === 0) return;

    const checks = providers.map(async (provider) => {
      try {
        const healthy = await this.gateway.handshake(provider);
        this.registry.updateProvider(provider.id, {
          healthStatus: healthy ? "healthy" : "unhealthy",
        });

        if (!healthy) {
          console.warn(
            `[lifecycle] Provider "${provider.id}" failed health check — marked unhealthy.`,
          );
        }
      } catch (err) {
        console.error(
          `[lifecycle] Unexpected error checking provider "${provider.id}":`,
          err instanceof Error ? err.message : err,
        );
        this.registry.updateProvider(provider.id, {
          healthStatus: "unhealthy",
        });
      }
    });

    await Promise.allSettled(checks);
  }
}
