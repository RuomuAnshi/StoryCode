// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorQuestionCard } from './AuthorQuestionCard';
afterEach(cleanup);
describe('author choice card', () => {
  it('sends the selected option and disables choices while unavailable', () => {
    const question = {
      question: '接下来先处理什么？',
      options: [
        { label: '完善设定', description: '补齐人物动机' },
        { label: '规划章节', description: '列出章节目标' },
      ],
    };
    const onSelect = vi.fn();
    const view = render(
      <AuthorQuestionCard question={question} disabled={false} onSelect={onSelect} />,
    );
    const button = screen.getByRole<HTMLButtonElement>('button', { name: /完善设定/ });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(question.options[0]);
    view.rerender(<AuthorQuestionCard question={question} disabled onSelect={onSelect} />);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/也可以在下方输入/)).toBeTruthy();
  });
});
