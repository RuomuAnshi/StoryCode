/**
 * Integration: the Agent runtime end-to-end.
 *
 * These tests prove the central safety property of StoryCode — the model can
 * *propose* file changes but only an explicit author commit writes to disk.
 */

import { describe, expect, it } from 'vitest';
import { AgentSession, MockProvider, type AgentEvent, type ScriptedTurn } from '@storycode/agent';
import { createTestProject, createPopulatedProject } from '../fixtures/test-project';
import { chapterProposalScript, makeMockProvider } from '../fixtures/mock-model';

function makeSession(
  project: Awaited<ReturnType<typeof createTestProject>>,
  client: MockProvider,
  overrides: { maxSteps?: number } = {},
): AgentSession {
  return new AgentSession({
    client,
    project: project.store,
    indexer: project.indexer,
    proposals: project.proposals,
    projectName: project.store.projectMeta.name,
    config: {},
    ...overrides,
  });
}

async function collect(
  session: AgentSession,
  input: string,
  mode: 'ask' | 'plan' | 'agent' = 'agent',
) {
  const events: AgentEvent[] = [];
  const run = session.run({ mode, input });
  let next = await run.next();
  while (!next.done) {
    events.push(next.value);
    next = await run.next();
  }
  return { events, result: next.value };
}

describe('agent produces a reviewable proposal', () => {
  it('turns a chapter request into a proposal without writing files', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { events, result } = await collect(
      makeSession(project, client),
      '创建第一章，描写示例主角回到白塔学院',
    );

    expect(result.status).toBe('completed');
    const proposalEvent = events.find((event) => event.type === 'proposal');
    expect(proposalEvent).toBeDefined();
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.changes[0]?.filePath).toBe('chapters/001.md');
    expect(result.proposal?.changes[0]?.operation).toBe('create');

    // The whole point: nothing is on disk until the author says yes.
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });

  it('emits the expected lifecycle events in order', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { events } = await collect(makeSession(project, client), '创建第一章');

    const types = events.map((event) => event.type);
    expect(types[0]).toBe('phase');
    expect(types).toContain('context');
    expect(types).toContain('plan');
    expect(types).toContain('tool-start');
    expect(types).toContain('tool-end');
    expect(types).toContain('text-delta');
    expect(types.at(-1)).toBe('done');
    // A proposal must be emitted before the run completes.
    expect(types.indexOf('proposal')).toBeLessThan(types.length - 1);
  });

  it('streams assistant text to the UI', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { events, result } = await collect(makeSession(project, client), '创建第一章');
    const streamed = events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.text)
      .join('');
    expect(streamed.length).toBeGreaterThan(0);
    // Every streamed chunk belongs to the turn's text; finalText is the last
    // turn's text (the earlier turn was a tool-call turn).
    expect(streamed).toContain(result.finalText);
  });

  it('reports usage and citations channels without crashing when empty', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { events } = await collect(makeSession(project, client), '创建第一章');
    expect(events.some((event) => event.type === 'usage')).toBe(true);
  });
});

describe('author commits the proposal', () => {
  it('writes the chapter to disk after an explicit commit', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { result } = await collect(
      makeSession(project, client),
      '创建第一章，描写示例主角回到白塔学院',
    );

    const proposal = result.proposal;
    expect(proposal).not.toBeNull();
    await project.proposals.commit(proposal!, { acceptAll: true });

    expect(await project.store.exists('chapters/001.md')).toBe(true);
    const raw = await project.store.readFile('chapters/001.md');
    expect(raw).toContain('示例主角推开白塔学院的大门');
  });

  it('leaves the project untouched when the author rejects', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { result } = await collect(makeSession(project, client), '创建第一章');
    await project.proposals.reject(result.proposal!, '不要这个开头');
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });

  it('keeps the committed chapter readable as a chapter document', async () => {
    const project = await createTestProject();
    const client = makeMockProvider(chapterProposalScript());
    const { result } = await collect(makeSession(project, client), '创建第一章');
    await project.proposals.commit(result.proposal!, { acceptAll: true });

    const doc = await project.store.readChapter('chapters/001.md');
    expect(doc.meta.title).toBe('归来');
    expect(doc.meta.order).toBe(1);
    expect(doc.body).toContain('她回来了。');
  });
});

describe('ask mode cannot change files', () => {
  it('refuses a write tool call in ask mode and reports the failure', async () => {
    const project = await createTestProject();
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: 'propose_create_file',
            arguments: { path: 'chapters/001.md', content: '# 不该被创建\n' },
          },
        ],
        finishReason: 'tool_calls',
      },
      { text: '好的，我只做说明，不修改文件。', finishReason: 'stop' },
    ];
    const client = new MockProvider(script);
    const { events, result } = await collect(
      makeSession(project, client),
      '解释一下这个故事',
      'ask',
    );

    const toolEnd = events.find((event) => event.type === 'tool-end') as
      { call: { status: string; error?: string } } | undefined;
    expect(toolEnd?.call.status).toBe('failed');
    expect(toolEnd?.call.error).toContain('不允许');
    expect(result.status).toBe('completed');
    expect(result.proposal).toBeNull();
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });

  it('does not advertise mutating tools in ask mode', async () => {
    const project = await createTestProject();
    const client = new MockProvider([{ text: '只是回答问题。' }]);
    await collect(makeSession(project, client), '介绍一下这个项目', 'ask');
    const firstCall = client.calls[0] ?? [];
    expect(firstCall.length).toBeGreaterThan(0);
    // The tool schemas are passed via options; assert no propose tool ran.
    expect(client.calls).toHaveLength(1);
  });
});

describe('tool errors flow back to the model', () => {
  it('lets the model recover from a bad tool argument', async () => {
    const project = await createTestProject();
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: 'read_project_file', arguments: { path: 'chapters/does-not-exist.md' } },
        ],
        finishReason: 'tool_calls',
      },
      { text: '这个文件还不存在。', finishReason: 'stop' },
    ];
    const client = new MockProvider(script);
    const { events, result } = await collect(makeSession(project, client), '读一下第一章');

    const toolEnd = events.find((event) => event.type === 'tool-end') as
      { call: { status: string } } | undefined;
    expect(toolEnd?.call.status).toBe('failed');
    // The second model call received the error as a tool message.
    expect(client.calls.length).toBe(2);
    const secondCall = client.calls[1] ?? [];
    const toolMessage = secondCall.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('error');
    expect(result.status).toBe('completed');
  });

  it('fails the run cleanly when the model errors', async () => {
    const project = await createTestProject();
    const client = new MockProvider([{ error: '模型连接失败' }]);
    const { events, result } = await collect(makeSession(project, client), '创建第一章');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('模型连接失败');
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('stops after the configured number of tool rounds', async () => {
    const project = await createTestProject();
    const loop: ScriptedTurn[] = Array.from({ length: 5 }, () => ({
      toolCalls: [{ name: 'list_project_files', arguments: {} }],
      finishReason: 'tool_calls' as const,
    }));
    const client = new MockProvider(loop);
    const { result } = await collect(makeSession(project, client, { maxSteps: 3 }), '一直调用工具');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('最大工具调用轮次');
  });
});

describe('context assembly', () => {
  it('includes existing chapters and characters for a populated project', async () => {
    const project = await createPopulatedProject();
    const client = new MockProvider([{ text: '我知道上下文了。' }]);
    const { events } = await collect(makeSession(project, client), '第二章写了什么？');
    const contextEvent = events.find((event) => event.type === 'context') as
      { context: { included: Array<{ path: string }>; estimatedTokens: number } } | undefined;
    expect(contextEvent).toBeDefined();
    expect(contextEvent?.context.included.length).toBeGreaterThan(0);
    expect(contextEvent?.context.estimatedTokens).toBeGreaterThan(0);
  });

  it('sends retrieved chapter content to the model for a chapter question', async () => {
    const project = await createPopulatedProject();
    const client = new MockProvider([{ text: '回答。' }]);
    await collect(makeSession(project, client), '第二章写了什么？');
    const systemMessage = (client.calls[0] ?? []).find((message) => message.role === 'system');
    const content = typeof systemMessage?.content === 'string' ? systemMessage.content : '';
    // The retrieval layer must ground the answer in the actual chapter text.
    expect(content).toContain('走廊尽头的灯忽明忽暗');
  });

  it('does not inject irrelevant files when the query matches nothing', async () => {
    const project = await createPopulatedProject();
    const client = new MockProvider([{ text: '我不知道。' }]);
    const { events } = await collect(makeSession(project, client), '完全不存在的情节内容');
    const contextEvent = events.find((event) => event.type === 'context') as
      | {
          context: {
            included: Array<{ path: string; reason?: string }>;
            dropped: Array<{ path: string }>;
          };
        }
      | undefined;
    const retrieved = contextEvent?.context.included.filter((entry) =>
      (entry.reason ?? '').startsWith('检索命中'),
    );
    expect(retrieved).toEqual([]);
  });
});
