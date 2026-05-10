import { spawn } from "child_process";
import { Transport, TransportType } from "./types.js";

/**
 * Stdio transport: communicates with an MCP provider via a subprocess.
 *
 * Expected provider config shape:
 * ```
 * { command: "/path/to/mcp-server", args: ["--flag"] }
 * ```
 *
 * Health check → spawn command ["--health"], expect exit code 0
 * Tool invoke  → spawn command [args…], write { tool, params } JSON line to
 *                stdin, read JSON response from stdout
 */
export class StdioTransport implements Transport {
  transportType(): TransportType {
    return TransportType.Stdio;
  }

  async checkHealth(config: Record<string, unknown>): Promise<boolean> {
    const command = config["command"] as string;
    if (!command) return false;

    return new Promise<boolean>((resolve) => {
      const proc = spawn(command, ["--health"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async invokeTools(
    config: Record<string, unknown>,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const command = config["command"] as string;
    if (!command) {
      throw new Error("StdioTransport: missing required config field 'command'");
    }
    const args = Array.isArray(config["args"])
      ? (config["args"] as string[])
      : [];

    return new Promise<unknown>((resolve, reject) => {
      const proc = spawn(command, args, { stdio: "pipe" });

      // Guard: stdio: "pipe" always creates these streams, but TypeScript types
      // them as nullable — verify before use.
      if (!proc.stdin || !proc.stdout) {
        reject(new Error("StdioTransport: failed to open stdio streams"));
        return;
      }

      let stdout = "";
      let stderr = "";

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `StdioTransport: process exited with code ${code ?? "unknown"}` +
                (stderr ? `\nstderr: ${stderr}` : "")
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch {
          // If the output isn't JSON, return it as a plain string
          resolve(stdout);
        }
      });

      proc.on("error", (err) => reject(err));

      // Write a newline-delimited JSON request to stdin
      const request = JSON.stringify({ tool: toolName, params });
      proc.stdin.write(request + "\n");
      proc.stdin.end();
    });
  }
}
