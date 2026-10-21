// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Citations } from './Citations';
const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  openWebUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/tauri', () => ({ desktop: { openWebUrl: mocks.openWebUrl } }));
vi.mock('@/stores/editor-store', () => ({
  useEditor: (select: (state: unknown) => unknown) => select({ openFile: mocks.openFile }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('local and external sources', () => {
  it('opens web sources in the system browser, and local sources in the editor', () => {
    render(
      <Citations
        citations={[
          {
            filePath: 'https://example.com/source',
            sourceUrl: 'https://example.com/source',
            title: '公开来源',
            excerpt: '摘要',
          },
          { filePath: 'world/overview.md', title: '世界观', excerpt: '本地设定' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '公开来源' }));
    expect(mocks.openWebUrl).toHaveBeenCalledWith('https://example.com/source');
    expect(mocks.openFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'world/overview.md' }));
    expect(mocks.openFile).toHaveBeenCalledWith('world/overview.md');
  });
  it('reports a browser-opening error visibly', async () => {
    mocks.openWebUrl.mockRejectedValueOnce(new Error('无法打开来源链接'));
    render(
      <Citations
        citations={[
          {
            filePath: 'https://example.com',
            sourceUrl: 'https://example.com',
            title: '来源',
            excerpt: '',
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '来源' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('无法打开来源链接'),
    );
  });
});
