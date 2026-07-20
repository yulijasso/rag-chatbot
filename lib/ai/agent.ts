import { makeTools, type ToolScope } from "./tools";

/**
 * The AI Decision Support Assistant — a LangChain.js tool-calling agent.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  TODO(you): IMPLEMENT THIS WITH LANGCHAIN.JS                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Everything around this is wired for you:
 *   - `makeTools(scope)` gives org/client-scoped hybrid-retrieval tools.
 *   - The chat route (app/(chat)/api/chat/route.ts) will call `streamAssistant`
 *     and pipe the result to the client via the AI SDK's `LangChainAdapter`.
 *
 * Suggested implementation:
 *
 *   import { ChatAnthropic } from "@langchain/anthropic";
 *   import { createReactAgent } from "langchain/agents"; // or LangGraph
 *
 *   const model = new ChatAnthropic({ model: "claude-sonnet-5" });
 *   // wrap makeTools(scope) entries as LangChain tools (Zod schemas)
 *   // build the agent, then return `agent.stream(...)`.
 *
 * Return a stream LangChainAdapter can consume (e.g. an IterableReadableStream
 * of message chunks, or a LangChain `.stream()` result).
 */

export type AssistantInput = {
  scope: ToolScope;
  messages: { role: "user" | "assistant"; content: string }[];
};

// biome-ignore lint/suspicious/useAwait: stub — the real LangChain agent stream will be async
export async function streamAssistant(input: AssistantInput) {
  // `makeTools(input.scope)` gives the org/client-scoped retrieval tools to
  // hand your LangChain agent.
  makeTools(input.scope);

  // TODO(you): build + return the LangChain agent stream.
  throw new Error(
    "streamAssistant is not implemented yet — build the LangChain.js agent here."
  );
}
