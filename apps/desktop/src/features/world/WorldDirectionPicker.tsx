import type { WorldDirections } from '@storycode/core';
import { Button } from '@/components/Button';

export function WorldDirectionPicker({
  directions,
  busy,
  onSelect,
}: {
  directions: WorldDirections;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="世界观候选方向" className="space-y-2">
      <p className="text-[12px] font-medium text-[var(--sc-text)]">选择一个世界观方向</p>
      <p className="text-[11px] leading-relaxed text-[var(--sc-text-muted)]">
        {directions.mode === 'existing'
          ? `基于你指定的「${directions.existingWorld ?? ''}」，未提供的原作细节尚未核实。`
          : '以下为候选建议，尚未写入正式设定。选择后只细化该方向，仍需审核文件提案。'}
      </p>
      {directions.candidates.map((candidate) => (
        <article
          key={candidate.id}
          className="space-y-2 rounded-lg border border-[var(--sc-border)] bg-[var(--sc-surface-raised)] p-3"
        >
          <div>
            <h3 className="text-[12px] font-medium text-[var(--sc-text)]">{candidate.title}</h3>
            <p className="text-[10.5px] text-[var(--sc-text-muted)]">
              {candidate.genre.join(' · ')} · {candidate.era}
            </p>
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--sc-text-secondary)]">
            {candidate.premise}
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--sc-text-secondary)]">
            核心矛盾：{candidate.coreConflict}
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--sc-text-muted)]">
            人物适配：{candidate.characterFit}
          </p>
          {candidate.risks.length > 0 && (
            <p className="text-[11px] text-[var(--sc-text-muted)]">
              待考虑：{candidate.risks.join('；')}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onSelect(candidate.id)}
          >
            选择「{candidate.title}」并细化
          </Button>
        </article>
      ))}
    </section>
  );
}
