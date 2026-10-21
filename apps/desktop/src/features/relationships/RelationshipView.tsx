import { useEffect, useState } from 'react';
import { describeError, type RelationshipGraph as GraphData } from '@storycode/core';
import type { ProjectStore } from '@storycode/storage';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import { RelationshipGraph } from './RelationshipGraph';
import { loadRelationshipGraph } from './relationship-graph';

export function RelationshipView({
  project,
  path,
  source,
  onOpen,
}: {
  project: ProjectStore;
  path: string;
  source: string;
  onOpen(path: string): void;
}) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setGraph(null);
    setError(null);
    void loadRelationshipGraph(project, { path, content: source })
      .then((value) => {
        if (live) setGraph(value);
      })
      .catch((caught: unknown) => {
        if (live) setError(describeError(caught));
      });
    return () => {
      live = false;
    };
  }, [project, path, source, revision]);
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 text-[12px]">
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded border border-[var(--sc-border)] px-3 py-2"
        >
          刷新关系
        </button>
        <button
          type="button"
          aria-pressed={raw}
          onClick={() => setRaw((value) => !value)}
          className="rounded border border-[var(--sc-border)] px-3 py-2"
        >
          {raw ? '返回关系图' : '查看原文'}
        </button>
      </div>
      {raw ? (
        <MarkdownPreview source={source} />
      ) : error ? (
        <div role="alert" className="text-[var(--sc-danger)]">
          关系图加载失败：{error}。可刷新重试或查看原文。
        </div>
      ) : graph ? (
        <RelationshipGraph
          graph={graph}
          activePath={path}
          onOpen={(filePath) => {
            if (filePath === path) setRaw(true);
            else onOpen(filePath);
          }}
        />
      ) : (
        <p role="status" className="py-12 text-center text-[var(--sc-text-muted)]">
          正在读取人物与关系…
        </p>
      )}
    </div>
  );
}
