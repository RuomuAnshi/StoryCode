// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationshipGraphSchema } from '@storycode/core';
import { RelationshipGraph } from './RelationshipGraph';
afterEach(cleanup);
describe('relationship graph interaction', () => {
  it('renders directed suggestions, supports keyboard selection and opens character files', () => {
    const graph = RelationshipGraphSchema.parse({
      nodes: [
        { id: 'character-a', name: '示例甲', filePath: 'characters/a.md', missing: false },
        { id: 'character-b', name: '示例乙', filePath: 'characters/b.md', missing: false },
      ],
      edges: [
        {
          id: 'relation-a',
          sourceCharacterId: 'character-a',
          targetCharacterId: 'character-b',
          type: 'friendship',
          description: '相互信任',
          displayStatus: 'proposed',
          filePath: 'plot/relationships/a.md',
        },
        {
          id: 'relation-b',
          sourceCharacterId: 'character-b',
          targetCharacterId: 'character-a',
          type: 'rivalry',
          description: '对方视为竞争者',
          displayStatus: 'confirmed',
          filePath: 'plot/relationships/b.md',
        },
      ],
      warnings: [],
    });
    const onOpen = vi.fn();
    const { container } = render(
      <RelationshipGraph graph={graph} activePath="plot/relationships/a.md" onOpen={onOpen} />,
    );
    expect(container.querySelector('[marker-end]')).toBeTruthy();
    expect(container.querySelector('[stroke-dasharray="6 5"]')).toBeTruthy();
    const detail = screen.getByRole('region', { name: '所选关系详情' });
    expect(within(detail).getByText('相互信任')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: '示例乙 → 示例甲：竞争 · 已确认' }), {
      key: 'Enter',
    });
    expect(within(detail).getByText('对方视为竞争者')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '示例甲：打开人物设定' }));
    expect(onOpen).toHaveBeenCalledWith('characters/a.md');
    fireEvent.click(screen.getByRole('button', { name: '打开这条关系文件' }));
    expect(onOpen).toHaveBeenCalledWith('plot/relationships/b.md');
  });
});
