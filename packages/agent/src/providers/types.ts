/**
 * Model provider abstraction.
 *
 * Nothing above this layer knows which vendor is in use: the runtime speaks
 * `ModelClient`, and adapters translate to/from the wire format. This is what
 * makes the app model-agnostic and lets tests inject a scripted model.
 */

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as returned by the model. */
  argumentsJson: string;
}

export interface ModelMessage {
  role: ModelRole;
  content: string;
  /** Assistant-only: tool calls requested in this turn. */
  toolCalls?: ModelToolCall[];
  /** Tool-role only: which call this message answers. */
  toolCallId?: string;
  name?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema object describing arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: readonly ToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required';
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Free-form response format hint; adapters ignore unsupported values. */
  responseFormat?: 'text' | 'json';
}

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ModelToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error'; raw?: string }
  | { type: 'error'; message: string; retryable: boolean };

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
}

export interface ModelClient {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  chat(messages: readonly ModelMessage[], options: ChatOptions): AsyncIterable<ModelEvent>;
}
