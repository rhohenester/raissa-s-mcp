import { McpRegistry } from "./registry.js";
import { McpProvider, ToolDefinition, TransportType } from "./transport/types.js";

// ---------------------------------------------------------------------------
// Built-in tool implementations
// ---------------------------------------------------------------------------

/**
 * Evaluate a simple mathematical expression safely.
 *
 * Only digits, standard operators (+  -  *  /  **), parentheses, dots and
 * whitespace are permitted.  The expression is run inside a strict-mode
 * Function so it cannot access outer scope variables.
 */
function safeEval(expression: string): number {
  const sanitized = expression.trim();
  // Whitelist: digits, decimal point, operators, parentheses, spaces
  if (!/^[\d\s+\-*/().%^]+$/.test(sanitized)) {
    throw new Error(
      `calculator: expression contains disallowed characters — ` +
        `only numbers and operators (+, -, *, /, %, **, parentheses) are allowed.`
    );
  }

  // new Function runs in the global scope, not local — cannot access variables
  const fn = new Function(`"use strict"; return (${sanitized})`) as () => unknown;
  const result = fn();

  if (typeof result !== "number") {
    throw new Error(`calculator: expression did not evaluate to a number (got ${typeof result})`);
  }
  if (!isFinite(result)) {
    throw new Error(`calculator: expression evaluated to a non-finite number (${result})`);
  }

  return result;
}

interface WordCountResult {
  wordCount: number;
  charCount: number;
  charCountNoSpaces: number;
  sentenceCount: number;
  paragraphCount: number;
}

function countWords(text: string): WordCountResult {
  const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
  const charCountNoSpaces = text.replace(/\s/g, "").length;
  // Sentences end with . ! or ?  (followed by whitespace or end-of-string)
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Paragraphs are separated by one or more blank lines
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return {
    wordCount: words.length,
    charCount: text.length,
    charCountNoSpaces,
    sentenceCount: sentences.length,
    paragraphCount: Math.max(paragraphs.length, text.trim().length > 0 ? 1 : 0),
  };
}

interface CurrentTimeResult {
  timestamp: string;
  isoUtc: string;
  timezone: string;
}

function getCurrentTime(timezone?: string): CurrentTimeResult {
  const now = new Date();
  const isoUtc = now.toISOString();

  if (timezone) {
    try {
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);

      return { timestamp: formatted, isoUtc, timezone };
    } catch {
      throw new Error(
        `current_time: unknown or invalid timezone "${timezone}". ` +
          `Use an IANA timezone name such as "America/New_York" or "Asia/Tokyo".`
      );
    }
  }

  return { timestamp: isoUtc, isoUtc, timezone: "UTC" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a built-in tool by name with the given parameters.
 *
 * This function is called directly by the gateway for the `"built-in"`
 * provider — no network round-trip or subprocess spawn is needed.
 *
 * @throws if `toolName` is not recognised or if the params are invalid.
 */
export async function executeBuiltInTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "calculator": {
      const expression = params["expression"];
      if (typeof expression !== "string" || expression.trim() === "") {
        throw new Error("calculator: required parameter 'expression' must be a non-empty string.");
      }
      const result = safeEval(expression);
      return { expression, result };
    }

    case "word_count": {
      const text = params["text"];
      if (typeof text !== "string") {
        throw new Error("word_count: required parameter 'text' must be a string.");
      }
      return countWords(text);
    }

    case "current_time": {
      const timezone =
        typeof params["timezone"] === "string" ? params["timezone"] : undefined;
      return getCurrentTime(timezone);
    }

    default:
      throw new Error(
        `Built-in provider does not have a tool named "${toolName}". ` +
          `Available tools: calculator, word_count, current_time.`
      );
  }
}

/**
 * Create an `McpRegistry` pre-loaded with the `"built-in"` provider and its
 * three in-process tools.
 *
 * The provider is marked as using `TransportType.Http` in its metadata (for
 * uniformity with external providers), but the gateway short-circuits
 * invocations to `executeBuiltInTool` so no actual HTTP calls are made.
 */
export function createBuiltInRegistry(): McpRegistry {
  const registry = new McpRegistry();

  const provider: McpProvider = {
    id: "built-in",
    name: "Built-in Tools",
    // Listed as HTTP for metadata consistency; invocations bypass the transport
    transportType: TransportType.Http,
    connectionConfig: {},
    isActive: true,
    healthStatus: "healthy",
  };

  registry.registerProvider(provider);

  const tools: ToolDefinition[] = [
    {
      name: "calculator",
      description:
        "Evaluates a mathematical expression and returns the numeric result. " +
        "Supports +, -, *, /, **, % and parentheses.",
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "The mathematical expression to evaluate, e.g. '(42 + 8) * 3' or '2 ** 10'.",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
    {
      name: "word_count",
      description:
        "Counts words, characters, sentences, and paragraphs in a given text.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to analyse.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: "current_time",
      description:
        "Returns the current date and time, optionally converted to a given timezone.",
      inputSchema: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "Optional IANA timezone name, e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo'. " +
              "Defaults to UTC if omitted.",
          },
        },
        additionalProperties: false,
      },
    },
  ];

  registry.registerTools("built-in", tools);

  return registry;
}
