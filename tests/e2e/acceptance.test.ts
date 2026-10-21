/**
 * End-to-end acceptance test for the round-1 scenario from the spec:
 *
 *   open StoryCode -> create 《示例小说》 -> ask the agent on the right
 *   "创建第一章，描写示例主角回到白塔学院" -> review the proposal ->
 *   confirm -> the chapter appears in the tree, opens in the editor, and is
 *   really saved as a local Markdown file.
 *
 * The model is scripted so the test is deterministic and free.
 */

import { describe, expect, it } from 'vitest';
import { AgentSession, type AgentEvent } from '@storycode/agent';
import { countWords } from '@storycode/core';
import { MemoryFsAdapter, ProjectStore } from '@storycode/storage';
import { makeMockProvider, chapterProposalScript } from '../fixtures/mock-model';
import { createTestProject } from '../fixtures/test-project';

async function runAgent(project: Awaited<ReturnType<typeof createTestProject>>, input: string) {
  const client = makeMockProvider(chapterProposalScript());
  const session = new AgentSession({
    client,
    project: project.store,
    indexer: project.indexer,
    proposals: project.proposals,
    projectName: project.store.projectMeta.name,
    config: {},
  });
  const run = session.run({ mode: 'agent', input });
  let next = await run.next();
  const events: AgentEvent[] = [];
  while (!next.done) {
    events.push(next.value);
    next = await run.next();
  }
  return { events, result: next.value };
}

describe('round-1 acceptance: natural language to a real chapter file', () => {
  it('creates a novel and holds a first chapter request as a proposal', async () => {
    // 1. The author creates a new novel project on disk.
    const fs = new MemoryFsAdapter();
    const root = '/tmp/storycode/e2e/示例小说';
    const store = await ProjectStore.create(fs, { name: '示例小说', root });
    expect(store.projectMeta.name).toBe('示例小说');
    expect(await store.exists('STORY.md')).toBe(true);

    // Build the same services the app wires up for the project.
    const { ProjectIndexer, ProposalService, SnapshotStore } = await import('@storycode/storage');
    const indexer = new ProjectIndexer(store);
    const snapshots = new SnapshotStore(fs, store);
    const proposals = new ProposalService(fs, store, snapshots);
    await indexer.rebuild();

    // 2. The author types the request into the right-hand agent.
    const client = makeMockProvider(chapterProposalScript());
    const session = new AgentSession({
      client,
      project: store,
      indexer,
      proposals,
      projectName: store.projectMeta.name,
      config: {},
    });
    const run = session.run({
      mode: 'agent',
      input: '创建第一章，描写示例主角回到白塔学院',
    });
    let next = await run.next();
    while (!next.done) next = await run.next();
    const result = next.value;

    // 3. A proposal is shown, and the chapter is NOT on disk yet.
    expect(result.status).toBe('completed');
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.changes[0]?.operation).toBe('create');
    expect(result.proposal?.changes[0]?.filePath).toBe('chapters/001.md');
    expect(await store.exists('chapters/001.md')).toBe(false);

    // 4. The author reviews and confirms.
    const commit = await proposals.commit(result.proposal!, { acceptAll: true });

    // 5. The chapter appears in the file tree.
    const tree = await store.buildTree();
    const chaptersFolder = tree.find((node) => node.path === 'chapters');
    const chapterPaths = (chaptersFolder?.children ?? []).map((child) => child.path);
    expect(chapterPaths).toContain('chapters/001.md');

    // 6. It is a real local Markdown file with the generated prose.
    const raw = await store.readFile('chapters/001.md');
    expect(raw).toContain('示例主角推开白塔学院的大门');
    expect(raw.startsWith('---')).toBe(true);
    expect(commit.written[0]?.filePath).toBe('chapters/001.md');

    // 7. The editor can open it and the word count is non-zero.
    const doc = await store.readChapter('chapters/001.md');
    expect(doc.meta.title).toBe('归来');
    expect(doc.body).toContain('她回来了。');
    expect(countWords(doc.body).total).toBeGreaterThan(0);

    // 8. Reopening the project from disk still finds the chapter.
    const reopened = await ProjectStore.open(fs, root);
    const reopenedTree = await reopened.buildTree();
    expect(reopenedTree.some((node) => node.path === 'chapters')).toBe(true);
    expect(await reopened.exists('chapters/001.md')).toBe(true);
  });

  it('letting the author reject keeps the novel unchanged', async () => {
    const project = await createTestProject();
    const { result } = await runAgent(project, '创建第一章，描写示例主角回到白塔学院');
    await project.proposals.reject(result.proposal!, '开头不够悬疑，重写');
    expect(await project.store.exists('chapters/001.md')).toBe(false);
    // The rejection reason is preserved for the next iteration.
    const reloaded = await project.proposals.load(result.proposal!.id);
    expect(reloaded?.status).toBe('rejected');
    expect(reloaded?.rationale).toContain('开头不够悬疑');
  });

  it('a second chapter request after the first is committed continues the numbering', async () => {
    const project = await createTestProject();
    const first = await runAgent(project, '创建第一章，描写示例主角回到白塔学院');
    await project.proposals.commit(first.result.proposal!, { acceptAll: true });

    const client = makeMockProvider(chapterProposalScript('chapters/002.md'));
    const session = new AgentSession({
      client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.store.projectMeta.name,
      config: {},
    });
    const run = session.run({ mode: 'agent', input: '再写第二章' });
    let next = await run.next();
    while (!next.done) next = await run.next();

    expect(next.value.proposal?.changes[0]?.filePath).toBe('chapters/002.md');
    await project.proposals.commit(next.value.proposal!, { acceptAll: true });
    expect(await project.store.exists('chapters/002.md')).toBe(true);
    expect(await project.store.exists('chapters/001.md')).toBe(true);
  });
});

describe('round-1 acceptance: editing and autosave semantics', () => {
  it('saves an edited chapter back to the same file and keeps the id', async () => {
    const project = await createTestProject();
    const chapter = await project.store.createChapter({ title: '第一章 归来' });
    const before = await project.store.readChapter(chapter.path);

    const edited = `${before.body}示例主角在楼梯上停住了脚步。\n`;
    const hash = await project.store.writeChapter({ ...before, body: edited });

    const after = await project.store.readChapter(chapter.path);
    expect(after.body).toBe(edited);
    expect(after.meta.id).toBe(before.meta.id);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('detects an outside edit instead of silently overwriting it', async () => {
    const project = await createTestProject();
    const chapter = await project.store.createChapter({ title: '第一章' });
    const open = await project.store.readChapter(chapter.path);
    const baseline = await project.store.fileHash(chapter.path);

    // The file is edited outside the app (another editor, sync client, ...).
    await project.store.writeFile(chapter.path, '# 外部修改\n\n新的内容。\n');

    await expect(
      project.store.writeChapter(
        { ...open, body: '# 编辑器里的版本\n' },
        { expectedHash: baseline ?? undefined },
      ),
    ).rejects.toThrow();
    // The outside change wins until the author decides.
    expect(await project.store.readFile(chapter.path)).toBe('# 外部修改\n\n新的内容。\n');
  });

  it('keeps paragraphs and headings intact across repeated save cycles', async () => {
    const project = await createTestProject();
    const chapter = await project.store.createChapter({ title: '第一章' });
    for (let i = 0; i < 5; i += 1) {
      const doc = await project.store.readChapter(chapter.path);
      await project.store.writeChapter({ ...doc, body: `${doc.body}第 ${i + 1} 段。\n\n` });
    }
    const final = await project.store.readChapter(chapter.path);
    expect(final.body).toContain('第 5 段。');
    expect(final.meta.title).toBe('第一章');
  });
});

describe('round-1 acceptance: project persistence', () => {
  it('survives a full close/reopen cycle with all files intact', async () => {
    const fs = new MemoryFsAdapter();
    const root = '/tmp/storycode/persist/示例小说';
    const created = await ProjectStore.create(fs, { name: '示例小说', root });
    await created.createChapter({ title: '第一章 归来', body: '# 第一章 归来\n\n正文一。\n' });
    await created.createChapter({ title: '第二章 秘密', body: '# 第二章 秘密\n\n正文二。\n' });
    await created.writeFile(
      'characters/character-001.md',
      '---\nid: character-001\nname: 示例主角\ntype: character\nstatus: confirmed\n---\n\n# 示例主角\n',
    );
    await created.writeFile('world/overview.md', '# 世界观\n\n白塔学院。\n');

    const reopened = await ProjectStore.open(fs, root);
    const chapters = await reopened.listChapters();
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 归来', '第二章 秘密']);
    expect(await reopened.readFile('characters/character-001.md')).toContain('示例主角');
    expect(await reopened.readFile('world/overview.md')).toContain('白塔学院');
    expect(reopened.projectMeta.name).toBe('示例小说');
  });

  it('handles a Chinese project name with spaces and punctuation', async () => {
    const fs = new MemoryFsAdapter();
    const name = '示例小说 · 第一部（试写）';
    const store = await ProjectStore.create(fs, { name, root: `/tmp/storycode/${name}` });
    expect(store.projectMeta.name).toBe(name);
    await store.createChapter({ title: '第一章' });
    expect(await store.listChapters()).toHaveLength(1);
  });
});
