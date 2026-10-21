/**
 * OpenAI-compatible chat-completions adapter with SSE streaming and tool calls.
 *
 * Works against OpenAI, DeepSeek, Moonshot, Together, vLLM/Ollama's OpenAI
 * shim, and any server implementing `/chat/completions`.
 */

import { StoryCodeError } from '@storycode/core';
import type { ProviderError } from '@storycode/core';
import { ChatCompletionStreamDecoder } from './sse-decoder.js';
import type {
  ChatOptions,
  ModelCapabilities,
  ModelClient,
  ModelEvent,
  ModelMessage,
  ToolSchema,
} from './types.js';

export interface OpenAiCompatibleConfig {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra headers for gateways that need them. */
  headers?: Record<string, string>;
}

function toWireMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant': {
      const wire: Record<string, unknown> = { role: 'assistant', content: message.content };
      if (message.toolCalls && message.toolCalls.length > 0) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        }));
      }
      return wire;
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
}

function toWireTools(tools: readonly ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export class OpenAiCompatibleProvider implements ModelClient {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.id = config.id ?? 'openai-compatible';
    this.capabilities = {
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
    };
  }

  get model(): string {
    return this.config.model;
  }

  async *chat(
    messages: readonly ModelMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ModelEvent> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
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

    const timeoutMs = options.timeoutMs ?? 120000;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = options.signal
      ? anySignal([options.signal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (options.signal?.aborted) {
        yield { type: 'error', message: '已取消', retryable: false };
        return;
      }
      if (timeoutController.signal.aborted) {
        yield { type: 'error', message: `请求超时（${timeoutMs}ms）`, retryable: true };
        return;
      }
      yield { type: 'error', message: describeNetworkError(error), retryable: true };
      return;
    }

    try {
      if (!response.ok) {
        const detail = await safeReadText(response);
        yield {
          type: 'error',
          message: describeHttpError(response.status, detail),
          retryable: response.status >= 500 || response.status === 429,
        };
        return;
      }
      if (!response.body) {
        yield { type: 'error', message: '模型返回了空响应体', retryable: true };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const stream = new ChatCompletionStreamDecoder();
      let sawDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of stream.push(decoder.decode(value, { stream: true }))) {
          // Emit everything except `done`; a native stop only ends the transport,
          // the authoritative completion signal comes from `stream.finish()`.
          if (event.type === 'done') {
            sawDone = true;
            continue;
          }
          yield event;
          if (event.type === 'error') return;
        }
      }
      for (const event of stream.push(decoder.decode())) {
        if (event.type === 'done') {
          sawDone = true;
          continue;
        }
        yield event;
        if (event.type === 'error') return;
      }
      void sawDone;
      for (const event of stream.finish()) {
        yield event;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch {
    return '';
  }
}

function describeHttpError(status: number, detail: string): string {
  const hint =
    status === 401
      ? 'API Key 无效或已过期'
      : status === 403
        ? '访问被拒绝，请检查密钥权限'
        : status === 404
          ? '接口地址或模型名称不存在'
          : status === 429
            ? '请求过于频繁或额度不足'
            : status >= 500
              ? '模型服务端错误'
              : '请求失败';
  return `${hint}（HTTP ${status}）${detail ? `: ${detail.slice(0, 300)}` : ''}`;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '请求已取消';
    return `网络错误：${error.message}`;
  }
  return '网络错误：无法连接模型服务';
}

/** Combines several abort signals into one. */
function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/** Validates provider configuration before use. */
export function assertProviderConfig(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): void {
  if (!/^https?:\/\//i.test(config.baseUrl)) {
    throw new StoryCodeError('CONFIG_ERROR', 'Base URL 必须以 http:// 或 https:// 开头');
  }
  if (config.apiKey.trim().length === 0) {
    throw new StoryCodeError('CONFIG_ERROR', 'API Key 不能为空');
  }
  if (config.model.trim().length === 0) {
    throw new StoryCodeError('CONFIG_ERROR', '模型名称不能为空');
  }
}

/** Exported for reuse by the mock provider in tests. */
export type { ProviderError };
