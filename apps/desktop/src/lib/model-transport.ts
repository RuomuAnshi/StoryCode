/**
 * `ModelClient` that streams through the Rust proxy.
 *
 * The API key never enters the webview: the frontend sends the request body and
 * a provider id, Rust attaches the Authorization header from the OS keychain.
 * Raw chunks are piped into the shared SSE decoder, so parsing is identical to
 * the fetch-based provider used in dev and tests.
 */

import { ChatCompletionStreamDecoder } from '@storycode/agent';
import type {
  ChatOptions,
  ModelCapabilities,
  ModelClient,
  ModelEvent,
  ModelMessage,
  ToolSchema,
} from '@storycode/agent';
import { desktop, onModelEvents, type UnlistenFn } from './tauri.js';

export interface DesktopModelConfig {
  /** Provider id, also the keyring account name. */
  providerId: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

interface WireMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

function toWireMessage(message: ModelMessage): WireMessage {
  const wire: WireMessage = { role: message.role, content: message.content };
  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.argumentsJson },
    }));
  }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId;
  return wire;
}

function toWireTools(tools: readonly ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/** Builds the request body that gets forwarded verbatim to the provider. */
export function buildRequestBody(
  model: string,
  messages: readonly ModelMessage[],
  options: ChatOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(toWireMessage),
    stream: true,
    temperature: options.temperature ?? 0.8,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.tools && options.tools.length > 0) {
    body.tools = toWireTools(options.tools);
    body.tool_choice = options.toolChoice ?? 'auto';
  }
  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

let requestCounter = 0;

export class DesktopModelClient implements ModelClient {
  readonly id: string;
  readonly capabilities: ModelCapabilities = {
    supportsTools: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
  };

  constructor(private readonly config: DesktopModelConfig) {
    this.id = config.providerId;
  }

  async *chat(
    messages: readonly ModelMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ModelEvent> {
    requestCounter += 1;
    const requestId = `req-${Date.now()}-${requestCounter}`;
    const body = buildRequestBody(this.config.model, messages, options);

    // Bridges the callback-based Tauri events into an async iterator.
    const queue: ModelEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let streamError: { message: string; retryable: boolean } | null = null;

    const wake = () => {
      const pending = notify;
      notify = null;
      pending?.();
    };

    const decoder = new ChatCompletionStreamDecoder();
    // Errors and completion are tracked as flags rather than queued, so each is
    // surfaced exactly once regardless of how many transport callbacks fire.
    const pushEvents = (events: ModelEvent[]) => {
      for (const event of events) {
        if (event.type === 'error') {
          streamError = { message: event.message, retryable: event.retryable };
        } else if (event.type === 'done') {
          finished = true;
        } else {
          queue.push(event);
        }
      }
      wake();
    };

    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await onModelEvents({
        requestId,
        onDelta: (chunk) => pushEvents(decoder.push(chunk)),
        onDone: () => {
          // Flushes the trailing frame, tool calls, usage, and `done`.
          pushEvents(decoder.finish());
          finished = true;
          wake();
        },
        onError: (message, retryable) => {
          streamError = { message, retryable };
          finished = true;
          wake();
        },
        onCancelled: () => {
          finished = true;
          wake();
        },
      });

      const abortHandler = () => {
        void desktop.cancelChat(requestId).catch(() => undefined);
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        await desktop.streamChat({
          request_id: requestId,
          provider_id: this.config.providerId,
          base_url: this.config.baseUrl,
          body: JSON.stringify(body),
          ...(this.config.timeoutMs ? { timeout_ms: this.config.timeoutMs } : {}),
        });
      } catch (error) {
        streamError = {
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
        finished = true;
        wake();
      }

      while (true) {
        if (queue.length > 0) {
          const next = queue.shift() as ModelEvent;
          yield next;
          continue;
        }
        if (streamError) {
          const error = streamError;
          streamError = null;
          finished = true;
          yield { type: 'error', message: error.message, retryable: error.retryable };
          return;
        }
        if (finished) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      unlisten?.();
    }
  }
}
