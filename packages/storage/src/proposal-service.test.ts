import { describe, expect, it } from 'vitest';
import { MemoryFsAdapter } from './memory-fs.js';
import { ProjectStore } from './project-store.js';
import { ProposalService } from './proposal-service.js';
import { SnapshotStore } from './snapshot-store.js';

async function makeProject(): Promise<{
  store: ProjectStore;
  proposals: ProposalService;
  snapshots: SnapshotStore;
}> {
  const fs = new MemoryFsAdapter();
  const store = await ProjectStore.create(fs, {
    name: '示例小说',
    root: '/tmp/storycode/示例小说',
  });
  const snapshots = new SnapshotStore(fs, store);
  const proposals = new ProposalService(fs, store, snapshots);
  return { store, proposals, snapshots };
}

const CHAPTER = `---
id: chapter-001
type: chapter
title: 归来
order: 1
status: draft
---

# 第一章 归来

示例主角回到白塔学院。
`;

describe('creating proposals', () => {
  it('creates a pending proposal for a new chapter without writing the file', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      rationale: '用户要求创建第一章',
      changes: [
        {
          operation: 'create',
          filePath: 'chapters/001.md',
          nextContent: CHAPTER,
          kind: 'chapter',
        },
      ],
    });

    expect(proposal.status).toBe('pending');
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0]?.baseContentHash).toBeNull();
    // Crucial safety property: proposing must not touch the novel.
    expect(await store.exists('chapters/001.md')).toBe(false);
  });

  it('captures the previous content of an updated file for diffing', async () => {
    const { store, proposals } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const proposal = await proposals.create({
      title: '修改第一章',
      changes: [
        {
          operation: 'update',
          filePath: 'chapters/001.md',
          nextContent: CHAPTER.replace('回到白塔学院', '走进礼堂'),
          kind: 'chapter',
        },
      ],
    });
    expect(proposal.changes[0]?.previousContent).toBe(CHAPTER);
    expect(proposal.changes[0]?.baseContentHash).not.toBeNull();
    // Still unchanged on disk.
    expect(await store.readFile('chapters/001.md')).toBe(CHAPTER);
  });

  it('refuses to create a file that already exists', async () => {
    const { store, proposals } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    await expect(
      proposals.create({
        title: '重复新建',
        changes: [
          { operation: 'create', filePath: 'chapters/001.md', nextContent: 'x', kind: 'chapter' },
        ],
      }),
    ).rejects.toThrow(/已存在/);
  });

  it('refuses to update a file that does not exist', async () => {
    const { proposals } = await makeProject();
    await expect(
      proposals.create({
        title: '修改不存在的文件',
        changes: [
          { operation: 'update', filePath: 'chapters/099.md', nextContent: 'x', kind: 'chapter' },
        ],
      }),
    ).rejects.toThrow(/不存在/);
  });

  it('refuses an empty change set', async () => {
    const { proposals } = await makeProject();
    await expect(proposals.create({ title: '空提案', changes: [] })).rejects.toThrow();
  });

  it('refuses paths that escape the project', async () => {
    const { proposals } = await makeProject();
    await expect(
      proposals.create({
        title: '越界',
        changes: [
          { operation: 'create', filePath: '../escape.md', nextContent: 'x', kind: 'other' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('refuses to touch protected project files', async () => {
    const { proposals } = await makeProject();
    await expect(
      proposals.create({
        title: '改 project.json',
        changes: [
          { operation: 'update', filePath: 'project.json', nextContent: '{}', kind: 'other' },
        ],
      }),
    ).rejects.toThrow(/受保护/);
  });

  it('marks proposals containing a delete as requiring explicit confirmation', async () => {
    const { store, proposals } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const proposal = await proposals.create({
      title: '删除第一章',
      changes: [{ operation: 'delete', filePath: 'chapters/001.md', kind: 'chapter' }],
    });
    expect(proposal.requiresExplicitConfirmation).toBe(true);
  });

  it('persists proposals so they survive a restart', async () => {
    const { proposals } = await makeProject();
    const created = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    const loaded = await proposals.load(created.id);
    expect(loaded?.id).toBe(created.id);
    const list = await proposals.list();
    expect(list.map((item) => item.id)).toContain(created.id);
  });
});

describe('committing proposals', () => {
  it('writes the approved file to disk', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    const result = await proposals.commit(proposal, { acceptAll: true });
    expect(result.written).toHaveLength(1);
    expect(await store.readFile('chapters/001.md')).toBe(CHAPTER);
  });

  it('does not write when nothing was accepted', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    await expect(proposals.commit(proposal, {})).rejects.toThrow();
    expect(await store.exists('chapters/001.md')).toBe(false);
  });

  it('commits only the individually accepted changes', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建两章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
        { operation: 'create', filePath: 'chapters/002.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    const firstId = proposal.changes[0]?.id;
    expect(firstId).toBeDefined();
    await proposals.commit(proposal, {
      decisions: {
        [firstId as string]: 'accepted',
        [proposal.changes[1]?.id as string]: 'rejected',
      },
    });
    expect(await store.exists('chapters/001.md')).toBe(true);
    expect(await store.exists('chapters/002.md')).toBe(false);
  });

  it('rejects committing when the target file changed after the proposal', async () => {
    const { store, proposals } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const proposal = await proposals.create({
      title: '修改第一章',
      changes: [
        {
          operation: 'update',
          filePath: 'chapters/001.md',
          nextContent: CHAPTER.replace('回到白塔学院', '走进礼堂'),
          kind: 'chapter',
        },
      ],
    });
    // Simulate the author editing the file in the meantime.
    await store.writeFile('chapters/001.md', `${CHAPTER}\n作者后来加的一句。\n`);
    await expect(proposals.commit(proposal, { acceptAll: true })).rejects.toThrow();
    // The author's text must survive.
    expect(await store.readFile('chapters/001.md')).toContain('作者后来加的一句。');
  });

  it('rejects committing a create when the file appeared in the meantime', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    await store.writeFile('chapters/001.md', '# 作者自己写的\n');
    await expect(proposals.commit(proposal, { acceptAll: true })).rejects.toThrow();
    expect(await store.readFile('chapters/001.md')).toBe('# 作者自己写的\n');
  });

  it('deletes a file only when the delete change is accepted', async () => {
    const { store, proposals } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const proposal = await proposals.create({
      title: '删除第一章',
      changes: [{ operation: 'delete', filePath: 'chapters/001.md', kind: 'chapter' }],
    });
    await proposals.commit(proposal, { acceptAll: true });
    expect(await store.exists('chapters/001.md')).toBe(false);
  });

  it('captures a snapshot before writing so the commit can be rolled back', async () => {
    const { store, proposals, snapshots } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const proposal = await proposals.create({
      title: '修改第一章',
      changes: [
        {
          operation: 'update',
          filePath: 'chapters/001.md',
          nextContent: CHAPTER.replace('回到白塔学院', '走进礼堂'),
          kind: 'chapter',
        },
      ],
    });
    await proposals.commit(proposal, { acceptAll: true });
    const all = await snapshots.list();
    expect(all.length).toBeGreaterThan(0);
    const latest = all[0];
    expect(latest).toBeDefined();
    const snapshot = await snapshots.load(latest?.id as string);
    const entry = snapshot?.entries.find((item) => item.path === 'chapters/001.md');
    expect(entry?.content).toBe(CHAPTER);
  });

  it('marks the proposal as accepted after committing', async () => {
    const { proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    await proposals.commit(proposal, { acceptAll: true });
    const reloaded = await proposals.load(proposal.id);
    expect(['accepted', 'partially_accepted']).toContain(reloaded?.status ?? '');
  });
});

describe('rejecting proposals', () => {
  it('records the rejection and writes nothing', async () => {
    const { store, proposals } = await makeProject();
    const proposal = await proposals.create({
      title: '新建第一章',
      changes: [
        { operation: 'create', filePath: 'chapters/001.md', nextContent: CHAPTER, kind: 'chapter' },
      ],
    });
    const rejected = await proposals.reject(proposal, '这一段不像我想要的');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rationale).toContain('这一段不像我想要的');
    expect(await store.exists('chapters/001.md')).toBe(false);
  });
});

describe('snapshots', () => {
  it('restores a file to its captured content', async () => {
    const { store, snapshots } = await makeProject();
    await store.writeFile('chapters/001.md', CHAPTER);
    const snapshot = await snapshots.capture('手动快照', ['chapters/001.md']);
    await store.writeFile('chapters/001.md', '# 被改坏了\n');
    const result = await snapshots.restore(snapshot.id, { force: true });
    expect(result.restored).toContain('chapters/001.md');
    expect(await store.readFile('chapters/001.md')).toBe(CHAPTER);
  });

  it('refuses to overwrite changes made after the snapshot', async () => {
    const { store, snapshots } = await makeProject();
    const atSnapshot = await store.writeFile('chapters/001.md', CHAPTER);
    const snapshot = await snapshots.capture('快照', ['chapters/001.md']);
    // The author keeps writing after the snapshot was taken.
    await store.writeFile('chapters/001.md', '# 作者的新版本\n');

    // The caller expected the file to still be at the snapshot version.
    const result = await snapshots.restore(snapshot.id, {
      expectedHashes: { 'chapters/001.md': atSnapshot.hash },
    });
    expect(result.restored).toHaveLength(0);
    expect(result.skipped[0]?.path).toBe('chapters/001.md');
    expect(await store.readFile('chapters/001.md')).toBe('# 作者的新版本\n');
  });

  it('restores when the author explicitly forces past the guard', async () => {
    const { store, snapshots } = await makeProject();
    const atSnapshot = await store.writeFile('chapters/001.md', CHAPTER);
    const snapshot = await snapshots.capture('快照', ['chapters/001.md']);
    await store.writeFile('chapters/001.md', '# 作者的新版本\n');
    const result = await snapshots.restore(snapshot.id, {
      expectedHashes: { 'chapters/001.md': atSnapshot.hash },
      force: true,
    });
    expect(result.restored).toContain('chapters/001.md');
    expect(await store.readFile('chapters/001.md')).toBe(CHAPTER);
  });

  it('captures a null entry for a file that did not exist yet', async () => {
    const { store, snapshots } = await makeProject();
    const snapshot = await snapshots.capture('新建前快照', ['chapters/001.md']);
    const entry = snapshot.entries[0];
    expect(entry?.content).toBeNull();
    await store.writeFile('chapters/001.md', CHAPTER);
    await snapshots.restore(snapshot.id, { force: true });
    expect(await store.exists('chapters/001.md')).toBe(false);
  });
});
