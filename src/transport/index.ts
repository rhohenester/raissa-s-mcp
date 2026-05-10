// Re-export everything from the transport layer so consumers can import from
// a single path: `import { Transport, createTransport, … } from "./transport/index.js"`
export * from "./types.js";
export { HttpTransport } from "./http.js";
export { StdioTransport } from "./stdio.js";

import { Transport, TransportType } from "./types.js";
import { HttpTransport } from "./http.js";
import { StdioTransport } from "./stdio.js";

/**
 * Instantiate the correct transport implementation for the given type.
 *
 * Transports are stateless — a new instance is returned each time.
 * SSE support is stubbed; a real implementation would be added here.
 *
 * @throws if `type` is `TransportType.Sse` (not yet implemented) or unknown.
 */
export function createTransport(type: TransportType): Transport {
  switch (type) {
    case TransportType.Http:
      return new HttpTransport();

    case TransportType.Stdio:
      return new StdioTransport();

    case TransportType.Sse:
      throw new Error(
        "SSE transport is not yet implemented. " +
          "Connect an SSE-based MCP provider by implementing SseTransport."
      );

    default: {
      // Exhaustiveness check — TypeScript will error here if a new enum member
      // is added to TransportType without a corresponding case above.
      const _unreachable: never = type;
      throw new Error(`createTransport: unknown transport type "${String(_unreachable)}"`);
    }
  }
}
