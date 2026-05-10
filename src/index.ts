import "dotenv/config";
import * as readline from "readline";
import { createBuiltInRegistry } from "./server.js";
import { McpGateway } from "./gateway.js";
import { McpLifecycleManager } from "./lifecycle.js";
import { McpChatSession, Message } from "./chat.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env["OPENAI_API_KEY"];

if (!OPENAI_API_KEY) {
  console.error("❌  OPENAI_API_KEY is not set.");
  console.error("    Copy .env.example → .env and add your key, then re-run.");
  process.exit(1);
}

// After the guard above, OPENAI_API_KEY is definitely a string — capture it
// in a typed const so TypeScript's narrowing carries into the async function.
const apiKey: string = OPENAI_API_KEY;

async function main(): Promise<void> {
  // 1. Registry pre-loaded with built-in tools
  console.log("🔌  Initializing Raissa's MCP...\n");
  const registry = createBuiltInRegistry();

  console.log("✅  Registered built-in provider with tools:");
  for (const tool of registry.listAllTools()) {
    console.log(`    • ${tool.name.padEnd(16)} ${tool.description}`);
  }
  console.log();

  // 2. Gateway
  const gateway = new McpGateway(registry);

  // 3. Lifecycle manager (health checks every 30 s)
  const lifecycle = new McpLifecycleManager(registry, gateway, 30_000);
  lifecycle.start();
  console.log("💓  Lifecycle manager started — health checks every 30 s.\n");

  // 4. Chat session
  const session = new McpChatSession(gateway, registry, apiKey);

  // 5. Graceful shutdown helper
  let shuttingDown = false;
  function shutdown(code = 0): never {
    if (shuttingDown) process.exit(code);
    shuttingDown = true;
    console.log("\n👋  Shutting down...");
    lifecycle.stop();
    rl.close();
    process.exit(code);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  // 6. REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const history: Message[] = [];

  console.log(
    "💬  MCP Chat — type your message and press Enter.  Type 'exit' to quit.\n",
  );
  console.log("    Try asking:");
  console.log("      What is (123 + 456) * 2?");
  console.log(
    "      Count the words in: The quick brown fox jumps over the lazy dog.",
  );
  console.log("      What time is it in Tokyo right now?");
  console.log();

  // Recursive prompt loop — avoids a tight while loop blocking the event loop
  function prompt(): void {
    rl.question("You: ", async (rawInput) => {
      const input = rawInput.trim();

      if (!input) {
        prompt();
        return;
      }

      if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
        shutdown(0);
      }

      // --- Special commands -----------------------------------------------
      if (input === "/tools") {
        const tools = registry.listAllTools();
        if (tools.length === 0) {
          console.log("  (no tools registered)\n");
        } else {
          console.log("\n  Available tools:");
          for (const t of tools) {
            console.log(`    • [${t.providerId}] ${t.name} — ${t.description}`);
          }
          console.log();
        }
        prompt();
        return;
      }

      if (input === "/providers") {
        const providers = gateway.listProviders();
        if (providers.length === 0) {
          console.log("  (no active providers)\n");
        } else {
          console.log("\n  Active providers:");
          for (const p of providers) {
            console.log(
              `    • ${p.id.padEnd(16)} ${p.name}  [${p.transportType}]  health: ${p.healthStatus}`,
            );
          }
          console.log();
        }
        prompt();
        return;
      }

      if (input === "/history") {
        if (history.length === 0) {
          console.log("  (no history yet)\n");
        } else {
          console.log();
          for (const m of history) {
            const label = m.role === "user" ? "You      " : "Assistant";
            console.log(
              `  ${label}: ${m.content.slice(0, 120)}${m.content.length > 120 ? "…" : ""}`,
            );
          }
          console.log();
        }
        prompt();
        return;
      }

      if (input === "/help") {
        console.log("\n  Commands:");
        console.log("    /tools      — list available tools");
        console.log(
          "    /providers  — list active providers and health status",
        );
        console.log("    /history    — show conversation history");
        console.log("    /help       — show this message");
        console.log("    exit / quit — stop the program\n");
        prompt();
        return;
      }

      // --- Chat turn -------------------------------------------------------
      try {
        process.stdout.write("Assistant: ");
        const answer = await session.chat(input, history);
        console.log(answer);
        console.log();

        // Append to history so the LLM has context for follow-up questions
        history.push({ role: "user", content: input });
        history.push({ role: "assistant", content: answer });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n⚠️   Error: ${msg}\n`);
      }

      prompt();
    });
  }

  prompt();
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
