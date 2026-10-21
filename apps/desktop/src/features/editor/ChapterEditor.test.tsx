// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterEditor } from './ChapterEditor';

afterEach(cleanup);

describe('chapter editor loading', () => {
  it('loads a different chapter and external content changes without saving over them', async () => {
    const onChange = vi.fn();
    const view = render(
      <ChapterEditor documentKey="chapters/001.md" body="第一章正文" onChange={onChange} />,
    );
    await waitFor(() => expect(screen.getByText('第一章正文')).toBeTruthy());
    view.rerender(
      <ChapterEditor documentKey="chapters/002.md" body="第二章正文" onChange={onChange} />,
    );
    await waitFor(() => expect(screen.getByText('第二章正文')).toBeTruthy());
    view.rerender(
      <ChapterEditor documentKey="chapters/002.md" body="外部更新后的正文" onChange={onChange} />,
    );
    await waitFor(() => expect(screen.getByText('外部更新后的正文')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });
  it('shows the first saved chapter without emitting an empty edit', async () => {
    const onChange = vi.fn();
    render(
      <ChapterEditor
        documentKey="chapters/001.md"
        body={'# 归来\n\n原有正文不能消失。'}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('原有正文不能消失。')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });
});
