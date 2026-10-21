/**
 * Real-filesystem acceptance test.
 *
 * The other e2e test uses MemoryFsAdapter, which proves the logic but not that
 * anything reaches a disk. This one runs the same vertical chain against the
 * actual filesystem (via NodeFsAdapter) and then reads the resulting Markdown
 * file back with `node:fs` — so "saved to a local Markdown file" is verified by
 * something outside our own abstractions.
 */

import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentSession, type AgentEvent } from '@storycode/agent';
import { ProjectIndexer, ProjectStore, ProposalService, SnapshotStore } from '@storycode/storage';
import { NodeFsAdapter } from '@storycode/storage/node-fs';
import { chapterProposalScript, makeMockProvider } from '../fixtures/mock-model.js';

const created: string[] = [];

afterAll(async () => {
  for (const dir of created) {
    await nodeFs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('real disk: agent proposal becomes a Markdown file on the filesystem', () => {
  it('writes chapters/001.md that exists outside the app abstractions', async () => {
    // Fresh temporary directory on the real volume.
    const base = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'storycode-disk-'));
    created.push(base);
    const root = path.join(base, '示例小说');

    const fs = new NodeFsAdapter();
    const store = await ProjectStore.create(fs, { name: '示例小说', root });
    expect(store.projectMeta.name).toBe('示例小说');

    const indexer = new ProjectIndexer(store);
    const snapshots = new SnapshotStore(fs, store);
    const proposals = new ProposalService(fs, store, snapshots);
    await indexer.rebuild();

    const client = makeMockProvider(chapterProposalScript());
    const session = new AgentSession({
      client,
      project: store,
      indexer,
      proposals,
      projectName: store.projectMeta.name,
      config: {},
    });

    const run = session.run({ mode: 'agent', input: '创建第一章，描写示例主角回到白塔学院' });
    const events: AgentEvent[] = [];
    let next = await run.next();
    while (!next.done) {
      events.push(next.value);
      next = await run.next();
    }
    const result = next.value;

    // The proposal exists but the chapter must NOT be on disk yet.
    expect(result.proposal).not.toBeNull();
    const proposal = result.proposal;
    if (!proposal) throw new Error('unreachable');
    const absoluteChapter = path.join(root, 'chapters/001.md');
    expect(await fileExists(absoluteChapter)).toBe(false);
    expect(events.some((event) => event.type === 'proposal')).toBe(true);

    // The author confirms.
    await proposals.commit(proposal, { acceptAll: true });

    // Verify with node:fs — bypassing ProjectStore/FsAdapter entirely.
    expect(await fileExists(absoluteChapter)).toBe(true);
    const raw = await nodeFs.readFile(absoluteChapter, 'utf8');
    expect(raw).toContain('示例主角');
    expect(raw).toContain('# 第一章');
    expect(raw.startsWith('---')).toBe(true);
    expect(raw.length).toBeGreaterThan(100);

    // The surrounding project structure is real too.
    for (const relative of [
      'STORY.md',
      'project.json',
      'chapters',
      'characters',
      'world',
      'plot',
    ]) {
      expect(await fileExists(path.join(root, relative))).toBe(true);
    }

    // A snapshot was captured before the write, so the commit is revertible.
    const snapshotsOnDisk = await nodeFs.readdir(path.join(root, '.storycode/snapshots'));
    expect(snapshotsOnDisk.length).toBeGreaterThan(0);

    // Reopening from disk reproduces the same novel.
    const reopened = await ProjectStore.open(fs, root);
    expect(reopened.projectMeta.name).toBe('示例小说');
    const chapter = await reopened.readChapter('chapters/001.md');
    expect(chapter.meta.title.length).toBeGreaterThan(0);
    expect(chapter.body).toContain('示例主角');

    // The proposal record is persisted for the audit trail.
    expect(await fileExists(path.join(root, '.storycode/proposals', `${proposal.id}.json`))).toBe(
      true,
    );
  });
});

async function fileExists(target: string): Promise<boolean> {
  try {
    await nodeFs.access(target);
    return true;
  } catch {
    return false;
  }
}
