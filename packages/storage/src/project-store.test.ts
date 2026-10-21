import { describe, expect, it } from 'vitest';
import { MemoryFsAdapter } from './memory-fs.js';
import { ProjectStore } from './project-store.js';

async function makeStore(
  name = '示例小说',
): Promise<{ store: ProjectStore; fs: MemoryFsAdapter; root: string }> {
  const fs = new MemoryFsAdapter();
  const root = `/tmp/storycode/${name}`;
  const store = await ProjectStore.create(fs, { name, root });
  return { store, fs, root };
}

describe('ProjectStore.create', () => {
  it('scaffolds a manifest, STORY.md and the standard directories', async () => {
    const { store, root } = await makeStore();
    expect(store.projectMeta.name).toBe('示例小说');
    const files = await store.listFiles();
    const paths = files.map((file) => file.path);
    expect(paths).toContain('project.json');
    expect(paths).toContain('STORY.md');
    for (const dir of ['chapters/', 'characters/', 'world/', 'plot/']) {
      expect(await store.exists(dir.slice(0, -1))).toBe(true);
    }
    expect(root).toBe('/tmp/storycode/示例小说');
  });

  it('refuses to create a project over an existing one', async () => {
    const { fs, root } = await makeStore();
    await expect(ProjectStore.create(fs, { name: '重复', root })).rejects.toThrow();
  });

  it('rejects an empty project name', async () => {
    const fs = new MemoryFsAdapter();
    await expect(ProjectStore.create(fs, { name: '   ', root: '/tmp/x' })).rejects.toThrow();
  });
});

describe('ProjectStore.open', () => {
  it('reopens an existing project and keeps its metadata', async () => {
    const { fs, root } = await makeStore();
    const reopened = await ProjectStore.open(fs, root);
    expect(reopened.projectMeta.name).toBe('示例小说');
  });

  it('rebuilds a missing manifest from STORY.md instead of failing', async () => {
    const { fs, root, store } = await makeStore();
    const manifest = await store.readFile('project.json');
    expect(manifest.length).toBeGreaterThan(0);
    await store.deleteFile('project.json');
    const reopened = await ProjectStore.open(fs, root);
    expect(reopened.projectMeta.name).toBe('示例小说');
  });

  it('fails clearly when the directory is not a project', async () => {
    const fs = new MemoryFsAdapter();
    await expect(ProjectStore.open(fs, '/tmp/not-a-project')).rejects.toThrow();
  });
});

describe('chapters', () => {
  it('creates chapters with sequential zero-padded paths', async () => {
    const { store } = await makeStore();
    const first = await store.createChapter({ title: '第一章 归来' });
    const second = await store.createChapter({ title: '第二章 秘密' });
    expect(first.path).toBe('chapters/001.md');
    expect(second.path).toBe('chapters/002.md');
    expect(first.meta.order).toBe(1);
    expect(second.meta.order).toBe(2);
  });

  it('persists chapter content to the file and reads it back', async () => {
    const { store } = await makeStore();
    const chapter = await store.createChapter({
      title: '第一章',
      body: '# 第一章\n\n正文内容。\n',
    });
    const raw = await store.readFile(chapter.path);
    expect(raw).toContain('正文内容。');
    const reread = await store.readChapter(chapter.path);
    expect(reread.body).toContain('正文内容。');
    expect(reread.meta.title).toBe('第一章');
  });

  it('refuses to create a chapter over an existing slot', async () => {
    const { store } = await makeStore();
    await store.createChapter({ title: '第一章' });
    await expect(store.createChapter({ title: '重复', order: 1 })).rejects.toThrow();
  });

  it('lists chapters ordered by their narrative order', async () => {
    const { store } = await makeStore();
    await store.createChapter({ title: '第一章' });
    await store.createChapter({ title: '第二章' });
    const chapters = await store.listChapters();
    expect(chapters.map((chapter) => chapter.order)).toEqual([1, 2]);
  });

  it('round-trips a chapter through write and read without losing text', async () => {
    const { store } = await makeStore();
    const created = await store.createChapter({ title: '第一章' });
    const doc = await store.readChapter(created.path);
    const body = '# 第一章\n\n第一段。\n\n第二段，带 "引号" 和 **强调**。\n';
    await store.writeChapter({ ...doc, body });
    const again = await store.readChapter(created.path);
    expect(again.body).toBe(body);
  });
});

describe('files', () => {
  it('writes and reads a setting file', async () => {
    const { store } = await makeStore();
    await store.writeFile('world/overview.md', '# 世界观\n\n内容。\n');
    expect(await store.readFile('world/overview.md')).toBe('# 世界观\n\n内容。\n');
  });

  it('creates parent directories for nested writes', async () => {
    const { store } = await makeStore();
    await store.writeFile('plot/sub/notes.md', '# 笔记\n');
    expect(await store.exists('plot/sub/notes.md')).toBe(true);
  });

  it('reports whether a write created or updated the file', async () => {
    const { store } = await makeStore();
    const first = await store.writeFile('plot/outline.md', '# 大纲\n');
    expect(first.created).toBe(true);
    const second = await store.writeFile('plot/outline.md', '# 大纲 v2\n');
    expect(second.created).toBe(false);
    expect(second.hash).not.toBe(first.hash);
  });

  it('refuses writes that escape the project root', async () => {
    const { store } = await makeStore();
    await expect(store.writeFile('../escape.md', 'x')).rejects.toThrow();
    await expect(store.readFile('../../etc/passwd')).rejects.toThrow();
  });

  it('detects a version conflict against an expected hash', async () => {
    const { store } = await makeStore();
    const { hash } = await store.writeFile('plot/outline.md', '# 大纲\n');
    await store.writeFile('plot/outline.md', '# 大纲（外部修改）\n');
    await expect(
      store.writeFile('plot/outline.md', '# 大纲（编辑器）\n', { expectedHash: hash }),
    ).rejects.toThrow(/已被修改/);
  });

  it('allows a write when the expected hash matches', async () => {
    const { store } = await makeStore();
    const { hash } = await store.writeFile('plot/outline.md', '# 大纲\n');
    const result = await store.writeFile('plot/outline.md', '# 大纲 v2\n', { expectedHash: hash });
    expect(result.created).toBe(false);
    expect(await store.readFile('plot/outline.md')).toBe('# 大纲 v2\n');
  });

  it('deletes a file and reports it as missing afterwards', async () => {
    const { store } = await makeStore();
    await store.writeFile('plot/timeline.md', '# 时间线\n');
    await store.deleteFile('plot/timeline.md');
    expect(await store.exists('plot/timeline.md')).toBe(false);
  });
});

describe('buildTree', () => {
  it('classifies known folders and keeps chapter order', async () => {
    const { store } = await makeStore();
    await store.createChapter({ title: '第一章' });
    await store.createChapter({ title: '第二章' });
    await store.writeFile('characters/character-001.md', '# 示例主角\n');
    const tree = await store.buildTree();
    const chapters = tree.find((node) => node.path === 'chapters');
    expect(chapters).toBeDefined();
    const chapterChildren = chapters?.children ?? [];
    expect(chapterChildren.map((child) => child.chapterOrder)).toEqual([1, 2]);
    const characters = tree.find((node) => node.path === 'characters');
    expect(characters?.children?.[0]?.kind).toBe('character');
  });

  it('includes project-root markdown files', async () => {
    const { store } = await makeStore();
    const tree = await store.buildTree();
    const story = tree.find((node) => node.path === 'STORY.md');
    expect(story?.kind).toBe('other');
  });
});

describe('metadata stability', () => {
  it('keeps the entity id when a chapter file is renamed', async () => {
    const { store } = await makeStore();
    const chapter = await store.createChapter({ title: '第一章' });
    await store.renameFile(chapter.path, 'chapters/renamed.md');
    const renamed = await store.readChapter('chapters/renamed.md');
    expect(renamed.meta.id).toBe(chapter.meta.id);
  });
});
