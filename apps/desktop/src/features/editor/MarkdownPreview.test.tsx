// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';
afterEach(cleanup);
describe('Markdown file previews', () => {
  it('renders headings, lists, emphasis and tables separately from metadata', () => {
    const { container } = render(
      <MarkdownPreview
        source={
          '---\nid: character-demo\nname: 示例人物\n---\n\n# 人物设定\n\n**动机**\n\n- 寻找答案\n\n| 字段 | 值 |\n| --- | --- |\n| 状态 | 草稿 |'
        }
      />,
    );
    expect(screen.getByRole('heading', { name: '人物设定' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('动机');
    expect(container.querySelector('li')?.textContent).toBe('寻找答案');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('article')?.textContent).not.toContain('character-demo');
  });
  it('does not execute HTML or load external images and preserves invalid sources', () => {
    const { container, rerender } = render(
      <MarkdownPreview
        source={'<script>alert(1)</script>\n\n![示例图](https://example.com/tracker.png)'}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    rerender(<MarkdownPreview source={'---\nid: [\n---\n\n正文保留'} />);
    expect(screen.getByText(/正文保留/)).toBeTruthy();
  });
});
