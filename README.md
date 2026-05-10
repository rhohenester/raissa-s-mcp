# raissa-s-mcp

A minimal, self-contained implementation of the **Model Context Protocol (MCP)** in TypeScript/Node.js — built from scratch as a learning project.

---

## What is MCP?

The **Model Context Protocol** is an open standard that lets large language models (LLMs) call external tools and services in a structured way. Instead of generating a plain-text answer, an LLM can:

1. Receive a catalogue of available tools (names, descriptions, and JSON input schemas)
2. Decide to call a tool by emitting a structured JSON message
3. Receive the tool's result back in the conversation
4. Use the result to produce its final, grounded answer

MCP standardises the interface between the LLM and the tools, so any MCP-compatible server can plug into any MCP-compatible client without custom glue code.

---

## Architecture

The project is split into focused layers, each with a single responsibility:

| Layer | File | Responsibility |
|---|---|---|
| Transport | `src/transport/` | How to physically talk to a tool server |
| Registry | `src/registry.ts` | In-memory catalogue of providers and tools |
| Gateway | `src/gateway.ts` | Routes tool calls to the right provider/transport |
| Inspector | `src/inspector.ts` | Auto-detects an endpoint's transport type |
| Lifecycle manager | `src/lifecycle.ts` | Periodic background health checks |
| Chat integration | `src/chat.ts` | Bridges the LLM and MCP tools |
| Built-in server | `src/server.ts` | In-process demo tools (no network needed) |

### Transport Layer (`src/transport/`)

Defines how to communicate with MCP tool servers. Every transport implements three operations:

- `invokeTools(config, toolName, params)` — call a named tool
- `checkHealth(config)` — ping the server
- `transportType()` — identify itself

Concrete transports:

- **HTTP** (`http.ts`): RESTful JSON over HTTP — `POST /tools/:name`
- **Stdio** (`stdio.ts`): spawns a subprocess and communicates over stdin/stdout
- **SSE** (stub): server-sent events — not yet fully implemented

A `createTransport(type)` factory in `transport/index.ts` instantiates the right class.

### Registry (`src/registry.ts`)

An in-memory store for provider and tool metadata. Tracks which providers are registered, whether they're active, their health status, and what tools each one exposes.

### Gateway (`src/gateway.ts`)

The central coordinator. Routes tool invocations to the right provider's transport. The built-in provider is handled entirely in-process (no network round-trip), while external providers go through their respective transports.

### Inspector (`src/inspector.ts`)

Auto-detects an endpoint's transport type by probing it: tries HTTP first (looks for a `{ tools: [...] }` JSON body), then stdio (path-based heuristic), then SSE (checks `Content-Type: text/event-stream`).

### Lifecycle Manager (`src/lifecycle.ts`)

Runs periodic background health checks on all active providers, updating each provider's `healthStatus` field in the registry based on whether `gateway.handshake()` succeeds.

### Chat Integration (`src/chat.ts`)

Bridges the LLM and MCP tools:

1. `buildToolsPrompt(tools)` — builds a system-prompt block listing every tool with its description and input schema, and tells the LLM the exact JSON format to use when calling one
2. `parseToolCall(text)` — extracts a `{ "tool": "...", "params": {...} }` JSON object from anywhere in the LLM's response
3. `McpChatSession.chat(userMessage, history)` — sends the message to OpenAI, detects a tool call in the response, executes it via the gateway, then sends the result back to get a final natural-language answer

### Built-in Server (`src/server.ts`)

Registers an in-process `"built-in"` provider pre-loaded with three tools:

| Tool | Input | What it does |
|---|---|---|
| `calculator` | `{ expression: string }` | Evaluates a maths expression safely |
| `word_count` | `{ text: string }` | Returns word, character, and sentence counts |
| `current_time` | `{ timezone?: string }` | Returns the current timestamp (optionally localised) |

---

## Project Structure

```
raissa-s-mcp/
├── src/
│   ├── transport/
│   │   ├── types.ts       # Interfaces, enums (TransportType, Transport, ToolDefinition, …)
│   │   ├── http.ts        # HTTP transport (fetch-based)
│   │   ├── stdio.ts       # Stdio transport (child_process.spawn)
│   │   └── index.ts       # createTransport() factory + re-exports
│   ├── registry.ts        # In-memory provider/tool registry
│   ├── inspector.ts       # Endpoint auto-detection
│   ├── lifecycle.ts       # Background health-check loop
│   ├── gateway.ts         # Central coordinator / router
│   ├── chat.ts            # LLM ↔ tool-call bridge (OpenAI)
│   ├── server.ts          # Built-in in-process tool server
│   └── index.ts           # Entry point — interactive REPL
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Add your OpenAI API key
cp .env.example .env
#    then edit .env and set OPENAI_API_KEY=sk-...

# 3. Start the interactive session
npm start
```

---

## Example Session

```
🔌 Initializing Raissa's MCP server...

✅ Registered built-in provider with tools:
   - calculator: Evaluates a mathematical expression and returns the result.
   - word_count: Counts words, characters, and sentences in a given text.
   - current_time: Returns the current timestamp, optionally in a specified timezone.

💓 Lifecycle manager started (health checks every 30s)

💬 MCP Chat Session started. Type 'exit' to quit.

You can ask me to:
  - Calculate expressions (e.g. 'What is 42 * 17?')
  - Count words (e.g. 'Count the words in: Hello world foo bar')
  - Get the current time (e.g. 'What time is it in Tokyo?')

You: What is 123 * 456?
Assistant: 123 × 456 = 56,088

You: How many words are in "the quick brown fox jumps over the lazy dog"?
Assistant: That sentence contains 9 words, 44 characters, and 1 sentence.

You: What time is it right now in Tokyo?
Assistant: The current time in Tokyo is Thursday, January 9, 2025 at 10:30:00 AM Japan Standard Time.

You: exit
👋 Shutting down...
```

---

## Adding Your Own Tools

1. Add a new entry to the `tools` array in `src/server.ts` with a name, description, and JSON Schema
2. Add a `case` for it in the `executeBuiltInTool` switch statement
3. That's it — the gateway, chat integration, and LLM prompt all pick it up automatically

To connect an **external** MCP server instead, register a new provider in `src/index.ts` with the appropriate `transportType` and `connectionConfig`, then use `inspectEndpoint` to discover its tools.
