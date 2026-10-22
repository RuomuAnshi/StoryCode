import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryFsAdapter,
  ProjectStore,
  ProjectIndexer,
  ProposalService,
  SnapshotStore,
} from '@storycode/storage';
import { useWorkspace } from './workspace-store';
import { useEditor } from './editor-store';

const original =
  '---\n# 保留作者注释\nid: world-demo\ntitle: 示例世界\nthemes: [探索]\nstatus: draft\nfactStatus: ai_proposed\ncustomField: 保留自定义字段\n---\n\n# 世界观\n\n原有正文。\n';
async function fixture() {
  const root = '/tmp/editor-test';
  const fs = new MemoryFsAdapter();
  const store = await ProjectStore.create(fs, { root, name: '示例项目' });
  const indexer = new ProjectIndexer(store);
  const snapshots = new SnapshotStore(fs, store);
  const proposals = new ProposalService(fs, store, snapshots);
  useWorkspace.setState({
    project: { root, store, indexer, snapshots, proposals, name: '示例项目' },
  });
  await store.writeFile('world/overview.md', original);
  await store.writeFile('STORY.md', '# 写作规则\n');
  await useEditor.getState().openFile('world/overview.md');
  return { store, snapshots };
}
beforeEach(() => {
  vi.useFakeTimers();
  useEditor.getState().reset();
});
afterEach(() => {
  useEditor.getState().reset();
  useWorkspace.setState({ project: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('manual Markdown editing safety', () => {
  it('preserves full source metadata and creates a snapshot before saving', async () => {
    const p = await fixture();
    const edited = original.replace('原有正文。', '作者修改后的正文。');
    useEditor.getState().updateBody(edited);
    await useEditor.getState().save();
    expect(await p.store.readFile('world/overview.md')).toBe(edited);
    expect((await p.snapshots.list()).length).toBeGreaterThan(0);
    expect(useEditor.getState().saveStatus).toBe('saved');
  });
  it('does not save invalid YAML or switch away from an unsaved invalid buffer', async () => {
    const p = await fixture();
    const invalid = '---\nid: [\n---\n\n未保存修改';
    useEditor.getState().updateBody(invalid);
    await useEditor.getState().save();
    expect(await p.store.readFile('world/overview.md')).toBe(original);
    expect(useEditor.getState().saveStatus).toBe('error');
    await useEditor.getState().openFile('STORY.md');
    expect(useEditor.getState().document?.path).toBe('world/overview.md');
    expect(useEditor.getState().document?.body).toBe(invalid);
  });
  it('does not silently overwrite an external edit when switching files', async () => {
    const p = await fixture();
    useEditor.getState().updateBody(original + '\n作者在编辑器中补充');
    await p.store.writeFile('world/overview.md', original + '\n外部修改');
    await useEditor.getState().openFile('STORY.md');
    expect(await p.store.readFile('world/overview.md')).toBe(original + '\n外部修改');
    expect(useEditor.getState().document?.path).toBe('world/overview.md');
    expect(useEditor.getState().conflict).not.toBeNull();
  });
  it('does not recreate a deleted file without explicit overwrite', async () => {
    const p = await fixture();
    useEditor.getState().updateBody(original + '\n修改');
    await p.store.deleteFile('world/overview.md');
    await useEditor.getState().save();
    expect(await p.store.exists('world/overview.md')).toBe(false);
    expect(useEditor.getState().conflict).not.toBeNull();
  });
});
