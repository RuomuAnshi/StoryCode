import type { AuthorQuestion } from '@storycode/core';
export function AuthorQuestionCard({
  question,
  disabled,
  onSelect,
}: {
  question: AuthorQuestion;
  disabled: boolean;
  onSelect(option: AuthorQuestion['options'][number]): void;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="mt-3 space-y-2 rounded-xl border border-[var(--sc-border)] p-3 disabled:opacity-60"
    >
      <legend className="px-1 text-[12px] font-medium">选择下一步</legend>
      <p className="text-[12px] text-[var(--sc-text-secondary)]">{question.question}</p>
      {question.options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option)}
          className="block w-full rounded-lg border border-[var(--sc-border)] p-2 text-left enabled:hover:border-[var(--sc-accent)] disabled:cursor-default"
        >
          <span className="block text-[12px] font-medium">{option.label}</span>
          <span className="mt-1 block text-[11px] text-[var(--sc-text-muted)]">
            {option.description}
          </span>
        </button>
      ))}
      <p className="text-[11px] text-[var(--sc-text-muted)]">
        也可以在下方输入自己的安排。文件提案仍需单独审核。
      </p>
    </fieldset>
  );
}
