// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryFsAdapter,
  ProjectStore,
  ProjectIndexer,
  ProposalService,
  SnapshotStore,
} from '@storycode/storage';
import { useWorkspace } from '@/stores/workspace-store';
import { useEditor } from '@/stores/editor-store';
import { EditorPane } from './EditorPane';

afterEach(() => {
  cleanup();
  useEditor.getState().reset();
  useWorkspace.setState({ project: null });
});
async function fixture(path: string, source: string) {
  const fs = new MemoryFsAdapter();
  const root = '/tmp/editor-pane';
  const store = await ProjectStore.create(fs, { root, name: '示例项目' });
  const snapshots = new SnapshotStore(fs, store);
  useWorkspace.setState({
    project: {
      root,
      store,
      snapshots,
      indexer: new ProjectIndexer(store),
      proposals: new ProposalService(fs, store, snapshots),
      name: '示例项目',
    },
  });
  if (path !== 'project.json') await store.writeFile(path, source);
  await useEditor.getState().openFile(path);
  render(<EditorPane onCreateChapter={vi.fn()} onOpenSettings={vi.fn()} />);
  return store;
}
describe('editing setting files', () => {
  it('opens source editing for a world file and saves before returning to preview', async () => {
    const source = '---\nid: world-demo\ntitle: 示例世界\n---\n\n# 世界设定\n\n原有内容';
    const store = await fixture('world/overview.md', source);
    expect(screen.getByRole('heading', { name: '世界设定' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '示例世界' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑文件' }));
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown 文件内容' });
    expect(editor.value).toBe(source);
    const edited = source.replace('原有内容', '修改后的世界内容');
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: '保存并预览' }));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Markdown 文件内容' })).toBeNull(),
    );
    expect(await store.readFile('world/overview.md')).toBe(edited);
    expect(screen.getByText('修改后的世界内容')).toBeTruthy();
  });
  it('offers editing for character Markdown but keeps project.json protected', async () => {
    await fixture(
      'characters/demo.md',
      '---\nid: character-demo\nname: 示例人物\nrole: supporting\n---\n\n# 人物设定',
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑文件' }));
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown 文件内容' }).value,
    ).toContain('name: 示例人物');
    await useEditor.getState().openFile('project.json');
    await waitFor(() => expect(screen.queryByRole('button', { name: '编辑文件' })).toBeNull());
    expect(screen.getByRole('heading', { name: '示例项目' })).toBeTruthy();
  });
});
