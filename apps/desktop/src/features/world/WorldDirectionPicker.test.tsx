// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldDirectionsSchema } from '@storycode/core';
import { WorldDirectionPicker } from './WorldDirectionPicker';
const directions = WorldDirectionsSchema.parse({
  id: 'proposal-test',
  projectId: 'project-test',
  projectRoot: '/test',
  mode: 'original',
  characters: [{ id: 'character-test', name: '人物', path: 'characters/test.md', hash: 'hash' }],
  candidates: [1, 2, 3].map((n) => ({
    id: `world-${n}`,
    title: `方向${n}`,
    genre: ['悬疑'],
    era: '当代',
    coreConflict: `冲突${n}`,
    premise: `故事前提${n}`,
    characterFit: '人物适配',
  })),
});
afterEach(cleanup);
describe('world direction picker', () => {
  it('requires a real click and sends only that candidate ID', () => {
    const onSelect = vi.fn();
    render(<WorldDirectionPicker directions={directions} busy={false} onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '选择「方向2」并细化' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('world-2');
  });
  it('does not allow repeated choices while the model is running', () => {
    const onSelect = vi.fn();
    render(<WorldDirectionPicker directions={directions} busy={true} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '选择「方向1」并细化' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
