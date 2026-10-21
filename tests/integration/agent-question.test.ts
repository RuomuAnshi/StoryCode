import { describe, expect, it } from 'vitest';
import { AgentSession, MockProvider } from '@storycode/agent';
import { createTestProject } from '../fixtures/test-project';

describe('interactive author choices', () => {
  it('pauses on a structured question without executing later tool calls', async () => {
    const p = await createTestProject();
    const session = new AgentSession({
      client: new MockProvider([
        {
          toolCalls: [
            {
              name: 'ask_user',
              arguments: {
                question: '接下来先做什么？',
                options: [
                  { label: '完善设定', description: '先补齐人物动机' },
                  { label: '规划章节', description: '先列出章节目标' },
                ],
              },
            },
            {
              name: 'propose_create_file',
              arguments: { path: 'chapters/001.md', content: '不得提前执行' },
            },
          ],
        },
        { text: '不应继续调用模型' },
      ]),
      project: p.store,
      indexer: p.indexer,
      proposals: p.proposals,
      projectName: '示例',
      config: {},
    });
    const gen = session.run({ mode: 'agent', input: '帮助我决定下一步' });
    let event = await gen.next();
    let questions = 0;
    while (!event.done) {
      if (event.value.type === 'author-question') questions++;
      event = await gen.next();
    }
    expect(questions).toBe(1);
    expect(event.value.authorQuestion?.options).toHaveLength(2);
    expect(event.value.proposal).toBeNull();
    expect(await p.store.exists('chapters/001.md')).toBe(false);
    expect(event.value.toolCalls).toHaveLength(1);
  });
});
