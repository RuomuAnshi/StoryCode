/**
 * Incremental decoder for OpenAI-compatible chat-completion SSE streams.
 *
 * The transport differs between environments (fetch in Node/tests, Tauri IPC
 * events in the desktop app) but the wire format does not, so the parsing lives
 * here and both transports feed it raw text chunks.
 */

import type { ModelEvent, ModelToolCall } from './types.js';

interface WireToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface WireDelta {
  content?: string | null;
  tool_calls?: WireToolCall[];
  reasoning_content?: string | null;
}

interface WireChunk {
  choices?: Array<{
    index?: number;
    delta?: WireDelta;
    message?: WireDelta;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

export class ChatCompletionStreamDecoder {
  private buffer = '';
  private readonly toolCalls = new Map<
    number,
    { id: string; name: string; argumentsJson: string }
  >();
  private finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
  private usage: { input: number; output: number } | null = null;
  private sawDone = false;
  private fatalError: string | null = null;

  /** Feeds a raw text chunk, returning any complete events it produced. */
  push(chunk: string): ModelEvent[] {
    if (this.fatalError) return [];
    this.buffer += chunk;
    const events: ModelEvent[] = [];

    // SSE frames are separated by a blank line; tolerate CRLF.
    let boundary = this.buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      const separatorLength = this.buffer[boundary] === '\r' ? 4 : 2;
      this.buffer = this.buffer.slice(boundary + separatorLength);
      events.push(...this.consumeFrame(frame));
      if (this.fatalError) return events;
      boundary = this.buffer.search(/\r?\n\r?\n/);
    }
    return events;
  }

  /** Signals end of stream; flushes the trailing frame and any tool calls. */
  finish(): ModelEvent[] {
    if (this.fatalError) return [];
    const events: ModelEvent[] = [];
    if (this.buffer.trim().length > 0) {
      events.push(...this.consumeFrame(this.buffer));
      this.buffer = '';
    }
    if (this.fatalError) return events;

    if (this.usage) {
      events.push({
        type: 'usage',
        inputTokens: this.usage.input,
        outputTokens: this.usage.output,
      });
    }
    if (this.toolCalls.size > 0) {
      for (const [index, call] of [...this.toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        if (call.name.trim().length === 0) continue;
        const resolved: ModelToolCall = {
          id: call.id.length > 0 ? call.id : `call_${index}_${Date.now()}`,
          name: call.name,
          argumentsJson: call.argumentsJson.trim().length > 0 ? call.argumentsJson : '{}',
        };
        events.push({ type: 'tool-call', call: resolved });
      }
    }
    events.push({
      type: 'done',
      finishReason: this.toolCalls.size > 0 ? 'tool_calls' : this.finishReason,
    });
    return events;
  }

  /** True once the server sent `[DONE]`. */
  get completed(): boolean {
    return this.sawDone;
  }

  private consumeFrame(frame: string): ModelEvent[] {
    const events: ModelEvent[] = [];
    for (const data of parseSseFrame(frame)) {
      if (data === '[DONE]') {
        this.sawDone = true;
        continue;
      }
      let chunk: WireChunk;
      try {
        chunk = JSON.parse(data) as WireChunk;
      } catch {
        // A partial or non-JSON keepalive frame; ignore it.
        continue;
      }
      if (chunk.error?.message) {
        this.fatalError = chunk.error.message;
        events.push({ type: 'error', message: chunk.error.message, retryable: false });
        return events;
      }
      if (chunk.usage) {
        this.usage = {
          input: chunk.usage.prompt_tokens ?? 0,
          output: chunk.usage.completion_tokens ?? 0,
        };
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? choice.message;
        if (delta?.content) {
          events.push({ type: 'text-delta', text: delta.content });
        }
        if (delta?.tool_calls) {
          for (const call of delta.tool_calls) {
            const index = call.index ?? 0;
            const existing = this.toolCalls.get(index) ?? { id: '', name: '', argumentsJson: '' };
            if (call.id) existing.id = call.id;
            if (call.function?.name) existing.name = call.function.name;
            if (call.function?.arguments) existing.argumentsJson += call.function.arguments;
            this.toolCalls.set(index, existing);
          }
        }
        if (choice.finish_reason === 'tool_calls') this.finishReason = 'tool_calls';
        else if (choice.finish_reason === 'length') this.finishReason = 'length';
      }
    }
    return events;
  }
}

/** Extracts `data:` payloads from one raw SSE frame. */
export function parseSseFrame(frame: string): string[] {
  const events: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data.length > 0) events.push(data);
  }
  return events;
}
