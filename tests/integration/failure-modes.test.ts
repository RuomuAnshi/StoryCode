/**
 * Exception and failure-mode tests from spec §11.
 *
 * Every case here is about protecting the author's text: a broken model, a
 * missing key, a concurrent edit or a crashed commit must never destroy prose
 * or silently claim that a file was written.
 */

import { describe, expect, it } from 'vitest';
import {
  AgentSession,
  MockProvider,
  type AgentEvent,
  type ModelClient,
  type ScriptedTurn,
} from '@storycode/agent';
import { StoryCodeError } from '@storycode/core';
import {
  MemoryFsAdapter,
  ProjectIndexer,
  ProjectStore,
  ProposalService,
  SnapshotStore,
} from '@storycode/storage';
import { chapterProposalScript } from '../fixtures/mock-model';
import { createTestProject } from '../fixtures/test-project';

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

const CHAPTER_BODY = `---
id: chapter-001
type: chapter
title: 归来
order: 1
status: draft
---

# 第一章 归来

示例主角回到白塔学院。
`;

function chapterToolTurn(body = CHAPTER_BODY): ScriptedTurn {
  return {
    toolCalls: [
      {
        name: 'propose_create_file',
        arguments: { path: 'chapters/001.md', content: body, summary: '新建第一章' },
      },
    ],
  };
}

describe('model returns invalid tool arguments', () => {
  it('does not write anything and reports the failure to the model', async () => {
    const project = await createTestProject();
    const client = new MockProvider([
      { toolCalls: [{ name: 'propose_create_file', arguments: {} }] },
      { text: '参数有误，我已停止。' },
    ]);
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });

    const { events, result } = await collect(session, '创建第一章');
    expect(await project.store.exists('chapters/001.md')).toBe(false);
    expect(result.proposal).toBeNull();
    // The model sees the validation error and can react.
    const failedTool = events.find((event) => event.type === 'tool-end');
    expect(failedTool).toBeDefined();
    expect(result.status).toBe('completed');
  });

  it('reports an unknown tool name without crashing the run', async () => {
    const project = await createTestProject();
    const client = new MockProvider([
      { toolCalls: [{ name: 'delete_everything', arguments: {} }] },
      { text: '该工具不存在。' },
    ]);
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { result } = await collect(session, '随便做点什么');
    expect(result.status).toBe('completed');
    expect(result.toolCalls[0]?.status).toBe('failed');
  });
});

describe('model connection failures', () => {
  it('fails the run cleanly when the provider errors mid-stream', async () => {
    const project = await createTestProject();
    const client = new MockProvider([{ error: '网络连接超时' }]);
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { events, result } = await collect(session, '创建第一章');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('网络连接超时');
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });

  it('reports a missing API key rather than pretending to work', async () => {
    const fs = new MemoryFsAdapter();
    const client: ModelClient = {
      id: 'unconfigured',
      capabilities: {
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
      },
      chat(): AsyncIterable<never> {
        throw new StoryCodeError('PROVIDER_ERROR', '尚未配置 API Key');
      },
    };
    const store = await ProjectStore.create(fs, { name: '测试', root: '/tmp/storycode/测试' });
    const snapshots = new SnapshotStore(fs, store);
    const proposals = new ProposalService(fs, store, snapshots);
    const session = new AgentSession({
      client,
      project: store,
      indexer: new ProjectIndexer(store),
      proposals,
      projectName: store.projectMeta.name,
      config: {},
    });
    const { result } = await collect(session, '创建第一章');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('API Key');
  });
});

describe('model without tool calling', () => {
  it('warns that file changes are impossible instead of faking them', async () => {
    const project = await createTestProject();
    const client = new MockProvider([{ text: '我可以给你讲讲怎么写。' }]);
    Object.defineProperty(client, 'capabilities', {
      value: { supportsTools: false, supportsStreaming: true, supportsStructuredOutput: false },
      configurable: true,
    });
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { events, result } = await collect(session, '创建第一章');
    expect(events.some((event) => event.type === 'capability')).toBe(true);
    expect(result.capabilityWarning).toContain('不支持工具调用');
    expect(result.proposal).toBeNull();
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });
});

describe('concurrent author edits', () => {
  it('refuses to commit a proposal built against an outdated file version', async () => {
    const project = await createTestProject();
    await project.store.writeFile('chapters/001.md', CHAPTER_BODY);
    const proposal = await project.proposals.create({
      title: '修改第一章',
      changes: [
        {
          operation: 'update',
          filePath: 'chapters/001.md',
          nextContent: CHAPTER_BODY.replace('回到白塔学院', '走进礼堂'),
          kind: 'chapter',
        },
      ],
    });

    // The author keeps typing in the editor while the proposal waits for review.
    await project.store.writeFile(
      'chapters/001.md',
      CHAPTER_BODY.replace('回到白塔学院', '回到白塔学院，心情复杂'),
    );

    await expect(project.proposals.commit(proposal, { acceptAll: true })).rejects.toThrow();
    const onDisk = await project.store.readFile('chapters/001.md');
    expect(onDisk).toContain('心情复杂');
  });

  it('detects an external edit through the file hash', async () => {
    const project = await createTestProject();
    await project.store.writeFile('chapters/001.md', CHAPTER_BODY);
    const hash = await project.store.fileHash('chapters/001.md');
    await project.store.writeFile('chapters/001.md', `${CHAPTER_BODY}\n外部追加的一段。\n`);
    expect(await project.store.fileHash('chapters/001.md')).not.toBe(hash);
  });
});

describe('bad paths from the model', () => {
  it('rejects path traversal attempts in a proposal', async () => {
    const project = await createTestProject();
    await expect(
      project.proposals.create({
        title: '越界写文件',
        changes: [
          { operation: 'create', filePath: '../../etc/passwd', nextContent: 'x', kind: 'other' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('rejects a symlink-free absolute path', async () => {
    const project = await createTestProject();
    await expect(
      project.proposals.create({
        title: '绝对路径',
        changes: [
          { operation: 'create', filePath: '/etc/passwd', nextContent: 'x', kind: 'other' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('survives a project name with Chinese characters and symbols', async () => {
    const fs = new MemoryFsAdapter();
    const store = await ProjectStore.create(fs, {
      name: '示例小说·卷壹 "试作"',
      root: '/tmp/storycode/示例小说·卷壹 "试作"',
    });
    const chapter = await store.createChapter({ title: '第一章 《归来》' });
    const doc = await store.readChapter(chapter.path);
    expect(doc.meta.title).toBe('第一章 《归来》');
    expect(store.projectMeta.name).toContain('示例小说');
  });
});

describe('agent cancellation', () => {
  it('stops without writing when the author cancels', async () => {
    const project = await createTestProject();
    const client = new MockProvider(() => ({ text: '思考中……' }));
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const run = session.run({ mode: 'agent', input: '创建第一章' });
    const events: AgentEvent[] = [];
    let next = await run.next();
    while (!next.done) {
      events.push(next.value);
      if (events.length === 3) session.cancel();
      next = await run.next();
    }
    expect(['cancelled', 'completed']).toContain(next.value.status);
    expect(await project.store.exists('chapters/001.md')).toBe(false);
  });
});

describe('invalid structured output', () => {
  it('does not write a chapter when the model emits a malformed file path', async () => {
    const project = await createTestProject();
    const client = new MockProvider([
      chapterToolTurn('第一章内容').toolCalls
        ? {
            toolCalls: [
              { name: 'propose_create_file', arguments: { path: 'chapters', content: '不是文件' } },
            ],
          }
        : { text: '' },
      { text: '路径无效，已停止。' },
    ]);
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { result } = await collect(session, '创建第一章');
    expect(result.proposal).toBeNull();
    expect(result.toolCalls.some((call) => call.status === 'failed')).toBe(true);
  });
});

describe('project with a corrupt manifest', () => {
  it('falls back to STORY.md when project.json is unreadable', async () => {
    const project = await createTestProject();
    await project.store.writeFile('project.json', '{ this is not json');
    const reopened = await ProjectStore.open(project.fs, project.root);
    expect(reopened.projectMeta.name).toBeTruthy();
    expect(await reopened.exists('STORY.md')).toBe(true);
  });
});

describe('free of fabricated success', () => {
  it('never creates a proposal when the model only talks', async () => {
    const project = await createTestProject();
    const client = new MockProvider([{ text: '这是一段建议文字，我没有修改文件。' }]);
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { result } = await collect(session, '告诉我怎么写第一章');
    expect(result.status).toBe('completed');
    expect(result.proposal).toBeNull();
    expect(await project.proposals.list()).toHaveLength(0);
    const files = await project.store.listFiles();
    expect(files.map((file) => file.path)).not.toContain('chapters/001.md');
  });

  it('keeps the pending proposal out of the project tree until committed', async () => {
    const project = await createTestProject();
    const client = new MockProvider(chapterProposalScript());
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const { result } = await collect(session, '创建第一章，描写示例主角回到白塔学院');
    expect(result.proposal).not.toBeNull();
    const tree = await project.store.buildTree();
    const chaptersFolder = tree.find((node) => node.path === 'chapters');
    expect(chaptersFolder?.children ?? []).toHaveLength(0);
    // Committing is what makes it real.
    await project.proposals.commit(result.proposal!, { acceptAll: true });
    const after = await project.store.buildTree();
    expect(after.find((node) => node.path === 'chapters')?.children).toHaveLength(1);
  });
});
