import { useMemo } from 'react';
import {
  WorldSettingSchema,
  FactStatusSchema,
  isAuthoritativeFact,
  parseMarkdown,
} from '@storycode/core';
import { MarkdownPreview } from './MarkdownPreview';

export function WorldOverviewPreview({ source }: { source: string }) {
  const data = useMemo(() => {
    try {
      const parsed = parseMarkdown(source);
      const setting = WorldSettingSchema.safeParse(parsed.frontmatter);
      return setting.success ? { parsed, setting: setting.data } : null;
    } catch {
      return null;
    }
  }, [source]);
  if (!data) return <MarkdownPreview source={source} />;
  const { parsed, setting } = data;
  const factStatus = FactStatusSchema.safeParse(parsed.frontmatter.factStatus);
  const provenance = factStatus.success ? factStatus.data : undefined;
  const state =
    provenance === 'ai_proposed' || provenance === 'inferred'
      ? 'AI 建议 · 未确认'
      : provenance === 'rejected'
        ? '已否决'
        : provenance === 'superseded'
          ? '已取代'
          : setting.status === 'confirmed' &&
              (parsed.frontmatter.factStatus === undefined ||
                (provenance !== undefined && isAuthoritativeFact(provenance)))
            ? '已确认'
            : '草稿 · 待确认';
  // Avoid repeating the same generated title; all other author text stays visible.
  const lines = parsed.body.split('\n');
  if (lines[0]?.trim() === `# ${setting.title}`) lines.shift();
  const body = lines.join('\n').trimStart();
  const fields = [
    ['题材', setting.genre.join('、')],
    ['时代', setting.era],
    ['地点', setting.location],
    ['主题', setting.themes.join('、')],
    ['基调', setting.tone.join('、')],
  ].filter((field) => field[1]);
  const groups = [...setting.institutions, ...setting.factions];
  const hasStructure =
    groups.length +
      setting.rules.length +
      setting.history.length +
      setting.socialConflicts.length +
      setting.unresolvedQuestions.length +
      setting.confirmedFacts.length >
    0;
  return (
    <section className="space-y-6" aria-label="世界观概述">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-[var(--sc-text-muted)]">世界观概述</p>
          <span className="rounded-full bg-[var(--sc-accent-soft)] px-2 py-1 text-[11px] text-[var(--sc-accent-text)]">
            {state}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">{setting.title}</h1>
      </header>
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-[13px]">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--sc-text-muted)]">{label}</dt>
              <dd className="whitespace-pre-wrap leading-relaxed">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hasStructure && (
        <details
          open={!body}
          className="rounded-lg border border-[var(--sc-border)] p-4 text-[13px]"
        >
          <summary className="cursor-pointer font-medium">世界观设定字段</summary>
          <div className="mt-4 space-y-5">
            {(
              [
                ['组织', setting.institutions],
                ['阵营', setting.factions],
              ] as const
            ).map(
              ([label, entities]) =>
                entities.length > 0 && (
                  <section key={label}>
                    <h2 className="mb-2 font-medium">{label}</h2>
                    <dl className="space-y-3">
                      {entities.map((entity) => (
                        <div key={entity.id}>
                          <dt className="font-medium">{entity.name}</dt>
                          <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--sc-text-secondary)]">
                            {entity.description || '暂无说明'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ),
            )}
            {setting.rules.length > 0 && (
              <section>
                <h2 className="mb-2 font-medium">规则</h2>
                <ul className="list-disc space-y-2 pl-4">
                  {setting.rules.map((rule) => (
                    <li key={rule.id}>
                      {rule.description}
                      {rule.exceptions.length > 0 && (
                        <p className="mt-1 text-[var(--sc-text-muted)]">
                          例外：{rule.exceptions.join('、')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {setting.history.length > 0 && (
              <section>
                <h2 className="mb-2 font-medium">历史</h2>
                <ol className="space-y-3 border-l border-[var(--sc-border)] pl-4">
                  {setting.history.map((event) => (
                    <li key={event.id}>
                      <p className="font-medium">
                        {event.date ? `${event.date} · ` : ''}
                        {event.title}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--sc-text-secondary)]">
                        {event.description}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {(
              [
                ['社会冲突', setting.socialConflicts],
                ['待确认问题', setting.unresolvedQuestions],
                ['已确认事实引用', setting.confirmedFacts],
              ] as const
            ).map(
              ([label, items]) =>
                items.length > 0 && (
                  <section key={label}>
                    <h2 className="mb-2 font-medium">{label}</h2>
                    <ul className="list-disc space-y-1 pl-4">
                      {items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ),
            )}
          </div>
        </details>
      )}
      {body && <MarkdownPreview source={body} />}
    </section>
  );
}
