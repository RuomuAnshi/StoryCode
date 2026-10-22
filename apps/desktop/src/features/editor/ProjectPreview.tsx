import { useMemo } from 'react';
import { ProjectMetaSchema, parseProjectManifest } from '@storycode/core';

function readableDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
/** project.json is protected configuration: render it without offering a raw write path. */
export function ProjectPreview({ source }: { source: string }) {
  const meta = useMemo(() => {
    try {
      return ProjectMetaSchema.parse(JSON.parse(source));
    } catch {
      try {
        return parseProjectManifest(source);
      } catch {
        return null;
      }
    }
  }, [source]);
  return (
    <section className="space-y-6" aria-label="项目信息">
      {meta ? (
        <>
          <header>
            <p className="text-[12px] text-[var(--sc-text-muted)]">小说项目</p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--sc-text)]">{meta.name}</h1>
          </header>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--sc-text-secondary)]">
            {meta.description || '尚未填写项目简介。'}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 text-[13px]">
            <dt className="text-[var(--sc-text-muted)]">作者</dt>
            <dd>{meta.author || '未填写'}</dd>
            <dt className="text-[var(--sc-text-muted)]">目标字数</dt>
            <dd>
              {meta.wordCountGoal !== undefined
                ? `${meta.wordCountGoal.toLocaleString('en-US')} 字`
                : '未设置'}
            </dd>
            <dt className="text-[var(--sc-text-muted)]">创建时间</dt>
            <dd>{readableDate(meta.createdAt)}</dd>
            <dt className="text-[var(--sc-text-muted)]">更新时间</dt>
            <dd>{readableDate(meta.updatedAt)}</dd>
            <dt className="text-[var(--sc-text-muted)]">项目 ID</dt>
            <dd className="break-all font-mono text-[12px]">{meta.id}</dd>
            <dt className="text-[var(--sc-text-muted)]">数据版本</dt>
            <dd>{meta.schemaVersion}</dd>
          </dl>
        </>
      ) : (
        <p role="alert" className="text-[13px] text-[var(--sc-danger)]">
          项目信息格式有误，无法渲染。可展开原始文件检查。
        </p>
      )}
      <details
        open={!meta}
        className="rounded-lg border border-[var(--sc-border)] p-3 text-[12px] text-[var(--sc-text-muted)]"
      >
        <summary className="cursor-pointer">查看原始文件</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono">
          {source}
        </pre>
      </details>
    </section>
  );
}
