import OpenAI from "openai";
import { McpGateway } from "./gateway.js";
import { McpRegistry } from "./registry.js";
import { ToolDefinition } from "./transport/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single turn in the conversation history. */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the tools section of the LLM system prompt.
 *
 * Lists every available tool with its name, description, and JSON input
 * schema, and instructs the model to call tools using a specific JSON format
 * so that `parseToolCall` can reliably extract the call.
 *
 * @returns An empty string if there are no tools (no tool section injected).
 */
export function buildToolsPrompt(
  tools: Array<{ providerId: string } & ToolDefinition>
): string {
  if (tools.length === 0) return "";

  const toolBlocks = tools
    .map((tool) => {
      const schema = JSON.stringify(tool.inputSchema, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");

      return [
        `  Tool: ${tool.name}  (provider: ${tool.providerId})`,
        `  Description: ${tool.description}`,
        `  Input schema:`,
        schema,
      ].join("\n");
    })
    .join("\n\n");

  return `\
## Tool use

You have access to the following tools. When you decide to call a tool, respond
with ONLY the JSON object below — no surrounding text, no markdown fences:

  {"tool": "<toolName>", "params": {<key>: <value>, ...}}

After you receive the tool result, provide your final answer in natural language.

### Available tools

${toolBlocks}`;
}

// ---------------------------------------------------------------------------
// Tool-call extraction
// ---------------------------------------------------------------------------

/**
 * Scan `text` for a JSON object that looks like a tool call.
 *
 * Uses brace-depth counting rather than a regex so it correctly handles
 * nested objects inside `params`.
 *
 * @returns The parsed tool call, or `null` if none was found.
 */
export function parseToolCall(
  text: string
): { toolName: string; params: Record<string, unknown> } | null {
  // Strip markdown code fences that some models wrap around JSON
  const stripped = text.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");

  return extractFirstToolCall(stripped) ?? extractFirstToolCall(text);
}

function extractFirstToolCall(
  text: string
): { toolName: string; params: Record<string, unknown> } | null {
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const braceOpen = text.indexOf("{", searchFrom);
    if (braceOpen === -1) break;

    // Walk forward tracking brace depth to find the matching close brace
    let depth = 0;
    let closeIdx = -1;

    for (let i = braceOpen; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    if (closeIdx !== -1) {
      const candidate = text.slice(braceOpen, closeIdx + 1);
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (
          typeof parsed["tool"] === "string" &&
          parsed["params"] !== null &&
          typeof parsed["params"] === "object" &&
          !Array.isArray(parsed["params"])
        ) {
          return {
            toolName: parsed["tool"],
            params: parsed["params"] as Record<string, unknown>,
          };
        }
      } catch {
        // Not valid JSON or wrong shape — continue scanning
      }
    }

    searchFrom = braceOpen + 1;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper — convert our Message type to OpenAI's param type
// ---------------------------------------------------------------------------

function toOpenAIMessage(m: Message): OpenAI.Chat.ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      return { role: "assistant", content: m.content };
  }
}

// ---------------------------------------------------------------------------
// Chat session
// ---------------------------------------------------------------------------

/**
 * One interactive chat session backed by OpenAI and the MCP gateway.
 *
 * Flow for each turn:
 *  1. Build messages array: system (tools prompt) + history + user message
 *  2. Call OpenAI
 *  3. If the response contains a tool call (detected by `parseToolCall`):
 *     a. Invoke the tool via the gateway
 *     b. Append the tool result as a user message
 *     c. Call OpenAI again to get the final natural-language answer
 *  4. Return the final answer
 */
export class McpChatSession {
  private gateway: McpGateway;
  private registry: McpRegistry;
  private openai: OpenAI;
  private model: string;

  constructor(
    gateway: McpGateway,
    registry: McpRegistry,
    apiKey: string,
    model = "gpt-4o-mini"
  ) {
    this.gateway = gateway;
    this.registry = registry;
    this.openai = new OpenAI({ apiKey });
    this.model = model;
  }

  /**
   * Process one user message, optionally calling a tool, and return the
   * assistant's final answer.
   *
   * @param userMessage  The new message from the user.
   * @param history      Previous turns (not including the current message).
   */
  async chat(userMessage: string, history: Message[]): Promise<string> {
    const allTools = this.registry.listAllTools();
    const toolsPrompt = buildToolsPrompt(allTools);

    const systemContent = [
      "You are a helpful, concise AI assistant.",
      toolsPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");

    const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...history.map(toOpenAIMessage),
      { role: "user", content: userMessage },
    ];

    // --- First completion ------------------------------------------------
    const firstResponse = await this.openai.chat.completions.create({
      model: this.model,
      messages: baseMessages,
      temperature: 0.2,
    });

    const firstText = firstResponse.choices[0]?.message.content ?? "";

    // --- Check for tool call ---------------------------------------------
    const toolCall = parseToolCall(firstText);

    if (!toolCall) {
      // No tool call — return the response directly
      return firstText;
    }

    // Locate which provider owns this tool
    const toolMeta = allTools.find((t) => t.name === toolCall.toolName);

    if (!toolMeta) {
      // Model hallucinated a tool name — return a graceful fallback
      return (
        `I tried to use a tool called "${toolCall.toolName}" but it isn't available. ` +
        `Available tools: ${allTools.map((t) => t.name).join(", ") || "none"}.`
      );
    }

    // --- Execute the tool ------------------------------------------------
    let toolResultText: string;
    try {
      const raw = await this.gateway.invokeTool(
        toolMeta.providerId,
        toolCall.toolName,
        toolCall.params
      );
      toolResultText = JSON.stringify(raw, null, 2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toolResultText = JSON.stringify({ error: msg });
    }

    // --- Second completion with tool result ------------------------------
    const messagesWithResult: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...baseMessages,
      { role: "assistant", content: firstText },
      {
        role: "user",
        content:
          `Tool result for "${toolCall.toolName}":\n\`\`\`json\n${toolResultText}\n\`\`\`\n\n` +
          `Please provide your final answer based on the tool result above.`,
      },
    ];

    const finalResponse = await this.openai.chat.completions.create({
      model: this.model,
      messages: messagesWithResult,
      temperature: 0.2,
    });

    return finalResponse.choices[0]?.message.content ?? "";
  }
}
