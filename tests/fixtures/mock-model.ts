/**
 * Helpers for driving the agent with the scripted mock provider.
 */

import { MockProvider, type ScriptedTurn } from '@storycode/agent';

/** A model that writes one chapter file via a tool call, then summarises. */
export function chapterProposalScript(chapterPath = 'chapters/001.md'): ScriptedTurn[] {
  return [
    {
      text: '我来为你创建第一章。',
      toolCalls: [
        {
          name: 'propose_create_file',
          arguments: {
            path: chapterPath,
            content: [
              '---',
              'id: chapter-001',
              'title: 归来',
              'order: 1',
              'type: chapter',
              'status: draft',
              '---',
              '',
              '# 第一章 归来',
              '',
              '示例主角推开白塔学院的大门，冷风灌进长袍。',
              '',
              '她回来了。',
              '',
            ].join('\n'),
            summary: '第一章：林岚返回白塔学院',
          },
        },
      ],
      finishReason: 'tool_calls',
    },
    {
      text: '第一章提案已生成，请审阅后确认写入。',
      finishReason: 'stop',
    },
  ];
}

export function makeMockProvider(script: ScriptedTurn[]): MockProvider {
  return new MockProvider(script);
}
