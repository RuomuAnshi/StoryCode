import { describe, expect, it, vi } from 'vitest';
import { AgentSession, MockProvider, dispatchTool, type WebResearchClient } from '@storycode/agent';
import { createTestProject } from '../fixtures/test-project';

describe('web research tools', () => {
  it('requires an enabled transport and never creates a file proposal', async () => {
    const p = await createTestProject();
    const context = { project: p.store, indexer: p.indexer, pending: [] };
    expect(
      (await dispatchTool('web_search', JSON.stringify({ query: '示例研究主题' }), context, 'ask'))
        .ok,
    ).toBe(false);
    const web: WebResearchClient = {
      search: vi.fn().mockResolvedValue({
        results: [{ title: '来源标题', url: 'https://example.com/source', snippet: '搜索摘要' }],
      }),
      fetch: vi.fn().mockResolvedValue({
        title: '来源标题',
        url: 'https://example.com/source',
        text: '网页正文',
        truncated: false,
      }),
    };
    const result = await dispatchTool(
      'web_search',
      JSON.stringify({ query: '示例研究主题' }),
      { ...context, web },
      'ask',
    );
    expect(result.ok).toBe(true);
    expect(result.outcome!.citations![0]!.sourceUrl).toBe('https://example.com/source');
    expect(context.pending).toEqual([]);
    expect(
      (
        await dispatchTool(
          'web_fetch',
          JSON.stringify({ url: 'file:///etc/passwd' }),
          { ...context, web },
          'ask',
        )
      ).ok,
    ).toBe(false);
  });
  it('validates transport output and reports failures without fake citations', async () => {
    const p = await createTestProject();
    const context = {
      project: p.store,
      indexer: p.indexer,
      pending: [],
      web: {
        search: vi.fn().mockResolvedValue({
          results: [{ title: '伪来源', url: 'javascript:alert(1)', snippet: '无效' }],
        }),
        fetch: vi.fn().mockRejectedValue(new Error('网络连接失败')),
      },
    };
    expect((await dispatchTool('web_search', '{"query":"测试"}', context, 'agent')).ok).toBe(false);
    const failed = await dispatchTool('web_fetch', '{"url":"https://example.com"}', context, 'ask');
    expect(failed.ok).toBe(false);
    expect(failed.outcome?.citations).toBeUndefined();
  });
  it('supports search then reading through an Agent session with source events', async () => {
    const p = await createTestProject();
    const session = new AgentSession({
      project: p.store,
      indexer: p.indexer,
      proposals: p.proposals,
      projectName: '示例',
      config: {},
      web: {
        search: () =>
          Promise.resolve({
            results: [{ title: '示例来源', url: 'https://example.com', snippet: '摘要' }],
          }),
        fetch: () =>
          Promise.resolve({
            title: '示例来源',
            url: 'https://example.com',
            text: '正文资料',
            truncated: false,
          }),
      },
      client: new MockProvider([
        { toolCalls: [{ name: 'web_search', arguments: { query: '研究资料' } }] },
        { toolCalls: [{ name: 'web_fetch', arguments: { url: 'https://example.com' } }] },
        { text: '根据来源整理资料，尚未加入正式设定。' },
      ]),
    });
    const gen = session.run({ mode: 'ask', input: '搜索并读取研究资料' });
    let next = await gen.next();
    while (!next.done) next = await gen.next();
    expect(next.value.status).toBe('completed');
    expect(next.value.citations.some((source) => source.sourceUrl === 'https://example.com')).toBe(
      true,
    );
    expect(
      next.value.citations.filter((source) => source.sourceUrl === 'https://example.com'),
    ).toHaveLength(1);
    expect(next.value.proposal).toBeNull();
  });
  it('cancels waiting for a slow network response without producing sources', async () => {
    const p = await createTestProject();
    const controller = new AbortController();
    const result = dispatchTool(
      'web_search',
      '{"query":"公开主题"}',
      {
        project: p.store,
        indexer: p.indexer,
        pending: [],
        signal: controller.signal,
        web: { search: () => new Promise<unknown>(() => undefined), fetch: vi.fn() },
      },
      'ask',
    );
    controller.abort();
    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('取消');
    expect(outcome.outcome?.citations).toBeUndefined();
  });
});
