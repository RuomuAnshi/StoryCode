/**
 * Scripted model used by tests and the offline demo mode.
 *
 * It lets the whole Agent -> tools -> proposal -> commit chain be exercised
 * deterministically without a paid API, which the spec explicitly requires.
 */

import type {
  ChatOptions,
  ModelCapabilities,
  ModelClient,
  ModelEvent,
  ModelMessage,
} from './types.js';

export interface ScriptedTurn {
  /** Text streamed to the UI. */
  text?: string;
  /** Tool calls the model "decides" to make. */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  error?: string;
}

export type ScriptedResponder = (
  messages: readonly ModelMessage[],
  turnIndex: number,
) => ScriptedTurn | Promise<ScriptedTurn>;

export class MockProvider implements ModelClient {
  readonly id = 'mock';
  readonly capabilities: ModelCapabilities = {
    supportsTools: true,
    supportsStreaming: true,
    supportsStructuredOutput: true,
  };

  private turn = 0;
  readonly calls: Array<readonly ModelMessage[]> = [];

  constructor(private readonly responder: ScriptedResponder | ScriptedTurn[]) {}

  reset(): void {
    this.turn = 0;
    this.calls.length = 0;
  }

  async *chat(
    messages: readonly ModelMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ModelEvent> {
    this.calls.push(messages);
    const index = this.turn;
    this.turn += 1;
    const scripted =
      typeof this.responder === 'function'
        ? await this.responder(messages, index)
        : (this.responder[index] ?? { finishReason: 'stop' });

    if (options.signal?.aborted) {
      yield { type: 'error', message: '已取消', retryable: false };
      return;
    }
    if (scripted.error) {
      yield { type: 'error', message: scripted.error, retryable: false };
      return;
    }

    const text = scripted.text ?? '';
    // Stream in small chunks to exercise the same code path as a real provider.
    for (let i = 0; i < text.length; i += 12) {
      if (options.signal?.aborted) {
        yield { type: 'error', message: '已取消', retryable: false };
        return;
      }
      yield { type: 'text-delta', text: text.slice(i, i + 12) };
    }

    const calls = scripted.toolCalls ?? [];
    for (let i = 0; i < calls.length; i += 1) {
      const call = calls[i] as { name: string; arguments: Record<string, unknown> };
      yield {
        type: 'tool-call',
        call: {
          id: `call_${index}_${i}`,
          name: call.name,
          argumentsJson: JSON.stringify(call.arguments),
        },
      };
    }

    yield { type: 'usage', inputTokens: 100, outputTokens: 50 };
    yield {
      type: 'done',
      finishReason: calls.length > 0 ? 'tool_calls' : (scripted.finishReason ?? 'stop'),
    };
  }
}
