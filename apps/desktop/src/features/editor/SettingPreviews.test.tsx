// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectPreview } from './ProjectPreview';
import { WorldOverviewPreview } from './WorldOverviewPreview';
afterEach(cleanup);
describe('structured setting previews', () => {
  it('renders project JSON as readable metadata without exposing raw JSON by default', () => {
    const { container } = render(
      <ProjectPreview
        source={JSON.stringify({
          id: 'project-example',
          name: '示例小说',
          author: '示例作者',
          description: '项目简介',
          createdAt: '2026-10-22T00:00:00Z',
          updatedAt: '2026-10-22T01:00:00Z',
          wordCountGoal: 100000,
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: '示例小说' })).toBeTruthy();
    expect(screen.getByText('示例作者')).toBeTruthy();
    expect(screen.getByText('100,000 字')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
  });
  it('renders world metadata and preserves manually written Markdown', () => {
    render(
      <WorldOverviewPreview
        source={
          '---\nid: world-demo\ntitle: 示例世界\ngenre: [奇幻]\nera: 架空时代\nfactStatus: ai_proposed\ninstitutions:\n  - id: institution-one\n    name: 资料馆\n    description: 保存地方史料\n---\n\n# 作者撰写的世界\n\n**这段说明应保留。**'
        }
      />,
    );
    expect(screen.getByRole('heading', { name: '作者撰写的世界' })).toBeTruthy();
    expect(screen.getByText('奇幻')).toBeTruthy();
    expect(screen.getByText('架空时代')).toBeTruthy();
    expect(screen.getByText('资料馆')).toBeTruthy();
    expect(screen.getByText('这段说明应保留。')).toBeTruthy();
    expect(screen.getByText(/AI 建议.*未确认/)).toBeTruthy();
  });
  it('reports invalid project JSON and retains the original for inspection', () => {
    const { container } = render(<ProjectPreview source={'{"name":'} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(within(container.querySelector('details')!).getByText('{"name":')).toBeTruthy();
  });
});
