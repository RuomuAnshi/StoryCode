// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeProposalSchema } from '@storycode/core';
import { ProposalCard } from './ProposalCard';

vi.mock('@/stores/workspace-store', () => ({
  useWorkspace: (select: (state: unknown) => unknown) =>
    select({ project: null, refreshTree: vi.fn() }),
}));
vi.mock('@/stores/agent-store', () => ({
  useAgent: (select: (state: unknown) => unknown) => select({ setActiveProposal: vi.fn() }),
}));
vi.mock('@/stores/editor-store', () => ({
  useEditor: (select: (state: unknown) => unknown) => select({ openFile: vi.fn() }),
}));
vi.mock('./FileDiff', () => ({ FileDiff: () => null }));
afterEach(cleanup);

describe('world impact review controls', () => {
  it('shows evidence and requires a separate acknowledgment for each proposal', () => {
    const proposal = ChangeProposalSchema.parse({
      id: 'proposal-one',
      title: '修改世界观',
      createdAt: '2026-10-21',
      changes: [
        {
          id: 'change-one',
          operation: 'update',
          filePath: 'world/overview.md',
          baseContentHash: 'old',
          previousContent: '旧值',
          nextContent: '新值',
          worldImpact: {
            scope: 'explicit-and-text',
            files: [
              {
                filePath: 'chapters/001.md',
                contentHash: 'chapterhash',
                evidence: [{ line: 7, excerpt: '原文依据', reason: 'text_match' }],
              },
            ],
          },
        },
      ],
    });
    const view = render(<ProposalCard proposal={proposal} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '接受并写入' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/第 7 行.*原文依据/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
    view.rerender(<ProposalCard proposal={{ ...proposal, id: 'proposal-two' }} />);
    expect(button.disabled).toBe(true);
  });
});
