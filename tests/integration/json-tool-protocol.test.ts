import { describe, expect, it, vi } from 'vitest';
import { AgentSession, JsonToolClient, MockProvider } from '@storycode/agent';
import { createTestProject } from '../fixtures/test-project';

async function run(
  text: string,
  mode: 'ask' | 'agent' = 'agent',
  finalText = '{"answer":"等待作者审核"}',
) {
  const project = await createTestProject();
  const mock = new MockProvider((messages, index) => ({
    text:
      index === 0
        ? text
        : messages.at(-1)?.content.startsWith('格式校验失败')
          ? (messages.at(-2)?.content ?? text)
          : finalText,
  }));
  const client = new JsonToolClient(mock);
  const session = new AgentSession({
    client,
    project: project.store,
    indexer: project.indexer,
    proposals: project.proposals,
    projectName: '测试',
    config: {},
  });
  const generator = session.run({ mode, input: '测试兼容工具协议' });
  let next = await generator.next();
  while (!next.done) next = await generator.next();
  return { result: next.value, project, mock };
}

describe('explicit JSON tool compatibility', () => {
  it('repairs malformed structured output at most twice before executing a valid call', async () => {
    const mock = new MockProvider([
      { text: '{"tool":"list_project_files","arguments":' },
      { text: '{"tool":"list_project_files","arguments":{}}' },
    ]);
    const events = [];
    for await (const event of new JsonToolClient(mock).chat([], {
      tools: [{ name: 'list_project_files', description: '', parameters: {} }],
    }))
      events.push(event);
    expect(mock.calls).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(1);
  });
  it('returns actionable diagnostics after exhausting repair attempts', async () => {
    const mock = new MockProvider([{ text: '{' }, { text: '{' }, { text: '{' }]);
    const events = [];
    for await (const event of new JsonToolClient(mock).chat([], {})) events.push(event);
    expect(mock.calls).toHaveLength(3);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('2 次格式修复') }),
    );
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
  });
  it('reports cancellation even when the compatibility adapter stops without another event', async () => {
    const project = await createTestProject();
    const client = new JsonToolClient(
      new MockProvider(() => {
        session.cancel();
        return { text: '{"answer":"不能继续"}' };
      }),
    );
    const session: AgentSession = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: '测试',
      config: {},
    });
    const gen = session.run({ mode: 'agent', input: '测试取消' });
    let next = await gen.next();
    while (!next.done) next = await gen.next();
    expect(next.value.status).toBe('cancelled');
    expect(next.value.proposal).toBeNull();
  });
  it('does not send native tool parameters or tool roles to the endpoint', async () => {
    const mock = new MockProvider([{ text: '{"answer":"你好"}' }]);
    const spy = vi.spyOn(mock, 'chat');
    const client = new JsonToolClient(mock);
    for await (const event of client.chat([{ role: 'user', content: '你好' }], {
      tools: [],
      toolChoice: 'auto',
    }))
      void event;
    expect(spy.mock.calls[0]?.[1]).not.toHaveProperty('tools');
    expect(spy.mock.calls[0]?.[1]).not.toHaveProperty('toolChoice');
  });
  it('never executes a truncated response even when the prefix is valid JSON', async () => {
    const mock = new MockProvider([
      { text: '{"tool":"list_project_files"}', finishReason: 'length' },
    ]);
    const client = new JsonToolClient(mock);
    const events = [];
    for await (const event of client.chat([], {
      tools: [{ name: 'list_project_files', description: '', parameters: {} }],
    }))
      events.push(event);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'tool-call')).toBe(false);
  });
  it('propagates provider failures without trying to parse or execute content', async () => {
    const client = new JsonToolClient(new MockProvider([{ error: '网络已断开' }]));
    const events = [];
    for await (const event of client.chat([], {})) events.push(event);
    expect(events).toEqual([{ type: 'error', message: '网络已断开', retryable: false }]);
  });

  it('turns validated text calls into proposals without writing novel files', async () => {
    const { result, project, mock } = await run(
      JSON.stringify({
        tool: 'propose_create_file',
        arguments: { path: 'chapters/001.md', content: '# 归来\n\n测试正文。' },
      }),
    );
    expect(result.status).toBe('completed');
    expect(result.proposal?.changes).toHaveLength(1);
    expect(await project.store.exists('chapters/001.md')).toBe(false);
    expect(mock.calls[1]?.some((message) => message.role === 'tool')).toBe(false);
    expect(mock.calls[1]?.some((message) => message.content.includes('工具结果'))).toBe(true);
    await project.proposals.commit(result.proposal!, { acceptAll: true });
    expect(await project.store.readFile('chapters/001.md')).toContain('测试正文');
  });
  it('accepts a prose final answer after a validated proposal call', async () => {
    const { result } = await run(
      JSON.stringify({
        tool: 'propose_create_file',
        arguments: { path: 'chapters/001.md', content: '# 测试' },
      }),
      'agent',
      '章节变更已提出，等待作者审核。',
    );
    expect(result.proposal?.changes).toHaveLength(1);
    expect(result.finalText).toContain('等待作者审核');
  });
  it('keeps validated pending changes reviewable when the final response is malformed', async () => {
    const { result, project } = await run(
      JSON.stringify({
        tool: 'propose_create_file',
        arguments: { path: 'chapters/001.md', content: '# 测试' },
      }),
      'agent',
      '{"invalid":true}',
    );
    expect(result.status).toBe('failed');
    expect(result.proposal?.changes).toHaveLength(1);
    expect(await project.store.exists('chapters/001.md')).toBe(false);
    expect(await project.proposals.list()).toHaveLength(1);
  });
  it('keeps Ask mode read-only', async () => {
    const { result } = await run(
      '{"tool":"propose_create_file","arguments":{"path":"chapters/001.md","content":"x"}}',
      'ask',
    );
    expect(result.status).toBe('failed');
    expect(result.proposal).toBeNull();
  });
  it.each([
    '{"tool":"unknown","arguments":{}}',
    '{"tool":"list_project_files","arguments":',
    '示例：```json\n{"tool":"list_project_files"}\n```',
  ])('rejects invalid, quoted, or unsafe calls: %s', async (text) => {
    const { result } = await run(text);
    expect(result.proposal).toBeNull();
    expect(result.status).toBe('failed');
  });
  it('rejects unsafe paths through the existing dispatcher', async () => {
    const { result, project } = await run(
      '{"tool":"propose_create_file","arguments":{"path":"../escape.md","content":"x"}}',
    );
    expect(result.proposal).toBeNull();
    expect(result.toolCalls[0]?.status).toBe('failed');
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });
  it('executes a whole fenced no-argument read request', async () => {
    const { result } = await run('```json\n{"tool":"list_project_files"}\n```', 'ask');
    expect(result.toolCalls[0]?.status).toBe('done');
  });
  it('rejects invalid tool arguments before dispatch', async () => {
    const { result } = await run('{"tool":"propose_create_file","arguments":{}}');
    expect(result.status).toBe('failed');
    expect(result.toolCalls).toHaveLength(0);
  });
});
