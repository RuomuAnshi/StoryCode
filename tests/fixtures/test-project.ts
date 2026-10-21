/**
 * Shared test fixtures: a deterministic project on an in-memory filesystem.
 */

import {
  MemoryFsAdapter,
  ProjectIndexer,
  ProjectStore,
  ProposalService,
  SnapshotStore,
} from '@storycode/storage';

export interface TestProject {
  fs: MemoryFsAdapter;
  root: string;
  store: ProjectStore;
  indexer: ProjectIndexer;
  snapshots: SnapshotStore;
  proposals: ProposalService;
}

export async function createTestProject(name = '示例小说'): Promise<TestProject> {
  const fs = new MemoryFsAdapter();
  const root = `/tmp/storycode/${name}`;
  const store = await ProjectStore.create(fs, { name, root });
  const indexer = new ProjectIndexer(store);
  const snapshots = new SnapshotStore(fs, store);
  const proposals = new ProposalService(fs, store, snapshots);
  await indexer.rebuild();
  return { fs, root, store, indexer, snapshots, proposals };
}

/** A project pre-populated with a few chapters and one character card. */
export async function createPopulatedProject(): Promise<TestProject> {
  const project = await createTestProject();
  await project.store.createChapter({
    title: '第一章 归来',
    body: '# 第一章 归来\n\n示例主角回到白塔学院。\n',
  });
  await project.store.createChapter({
    title: '第二章 午夜的秘密',
    body: '# 第二章 午夜的秘密\n\n走廊尽头的灯忽明忽暗。\n',
  });
  await project.store.writeFile(
    'characters/character-001.md',
    `---
id: character-001
name: 示例主角
type: character
status: confirmed
---

# 示例主角

## 人物背景

白塔学院四年级学生，从布斯巴顿提前返校。
`,
  );
  await project.store.writeFile(
    'world/overview.md',
    '# 世界观\n\n示例原作世界观下的校园悬疑故事。\n',
  );
  await project.store.writeFile('plot/outline.md', '# 大纲\n\n1. 归来\n2. 秘密\n');
  await project.indexer.rebuild();
  return project;
}
