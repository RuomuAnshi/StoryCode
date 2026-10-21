import { useId, useState, type KeyboardEvent } from 'react';
import { RELATIONSHIP_TYPE_LABELS, type RelationshipGraph as GraphData } from '@storycode/core';

const STATUS_LABELS = {
  confirmed: '已确认',
  proposed: '建议 · 未确认',
  rejected: '已否决',
  superseded: '已取代',
};
const WIDTH = 760,
  HEIGHT = 460;

export function RelationshipGraph({
  graph,
  activePath,
  onOpen,
}: {
  graph: GraphData;
  activePath: string;
  onOpen(path: string): void;
}) {
  const markerId = useId().replace(/:/g, '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const selected =
    graph.edges.find((edge) => edge.id === selectedId) ??
    graph.edges.find((edge) => edge.filePath === activePath) ??
    graph.edges[0];
  const nodes = graph.nodes.map((node, index) => {
    const angle = Math.PI + (index * 2 * Math.PI) / Math.max(1, graph.nodes.length);
    return {
      ...node,
      x: WIDTH / 2 + (graph.nodes.length > 1 ? Math.cos(angle) * 244 : 0),
      y: HEIGHT / 2 + (graph.nodes.length > 2 ? Math.sin(angle) * 154 : 0),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const selectOnKey = (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">人物关系图</h1>
          <p className="mt-1 text-[12px] text-[var(--sc-text-muted)]">
            {nodes.length} 位人物 · {graph.edges.length} 条有向关系
          </p>
        </div>
        <div className="flex gap-1" aria-label="关系图缩放">
          <button
            type="button"
            aria-label="缩小关系图"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))}
            className="rounded border border-[var(--sc-border)] px-3 py-2"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded border border-[var(--sc-border)] px-3 py-2 text-[12px]"
          >
            重置
          </button>
          <button
            type="button"
            aria-label="放大关系图"
            disabled={zoom >= 2}
            onClick={() => setZoom((value) => Math.min(2, value + 0.2))}
            className="rounded border border-[var(--sc-border)] px-3 py-2"
          >
            ＋
          </button>
        </div>
      </div>
      <p className="text-[12px] text-[var(--sc-text-secondary)]">
        箭头表示发起方 → 对方；虚线表示未确认或非当前关系。点击关系查看双方视角。
      </p>
      {graph.warnings.length > 0 && (
        <details className="rounded-lg border border-[var(--sc-border)] p-3 text-[12px]">
          <summary>有 {graph.warnings.length} 项数据提示</summary>
          <ul className="mt-2 list-disc pl-4">
            {graph.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {graph.edges.length === 0 ? (
        <p className="py-10 text-center text-[var(--sc-text-muted)]">
          尚无可显示的关系。可查看原文，或先生成并审核人物关系提案。
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-[var(--sc-border)] bg-[var(--sc-surface)]">
            <svg
              viewBox={`0 0 ${WIDTH / zoom} ${HEIGHT / zoom}`}
              role="group"
              aria-label="人物关系图"
              className="w-full"
              style={{ minHeight: 260 }}
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sc-accent-text)" />
                </marker>
              </defs>
              <g
                transform={`translate(${(WIDTH / zoom - WIDTH) / 2} ${(HEIGHT / zoom - HEIGHT) / 2})`}
              >
                {graph.edges.map((edge) => {
                  const source = byId.get(edge.sourceCharacterId)!,
                    target = byId.get(edge.targetCharacterId)!;
                  const dx = target.x - source.x,
                    dy = target.y - source.y;
                  const length = Math.hypot(dx, dy) || 1;
                  const ux = dx / length,
                    uy = dy / length;
                  const pad = Math.min(
                    80 / Math.max(Math.abs(ux), 0.001),
                    38 / Math.max(Math.abs(uy), 0.001),
                  );
                  const siblings = graph.edges.filter(
                    (other) =>
                      [edge.sourceCharacterId, edge.targetCharacterId].includes(
                        other.sourceCharacterId,
                      ) &&
                      [edge.sourceCharacterId, edge.targetCharacterId].includes(
                        other.targetCharacterId,
                      ),
                  );
                  const index = siblings.findIndex((other) => other.id === edge.id);
                  const bend = (index - (siblings.length - 1) / 2) * 88;
                  const sign = edge.sourceCharacterId < edge.targetCharacterId ? 1 : -1;
                  const cx = (source.x + target.x) / 2 - uy * bend * sign,
                    cy = (source.y + target.y) / 2 + ux * bend * sign;
                  const self = source.id === target.id;
                  const d = self
                    ? `M ${source.x - 42} ${source.y - 36} C ${source.x - 140} ${source.y - 155}, ${source.x + 140} ${source.y - 155}, ${source.x + 42} ${source.y - 36}`
                    : `M ${source.x + ux * pad} ${source.y + uy * pad} Q ${cx} ${cy} ${target.x - ux * pad} ${target.y - uy * pad}`;
                  const labelX = self ? source.x : (source.x + target.x + 2 * cx) / 4;
                  const labelY = self ? source.y - 125 : (source.y + target.y + 2 * cy) / 4;
                  const label = `${RELATIONSHIP_TYPE_LABELS[edge.type]} · ${STATUS_LABELS[edge.displayStatus]}`;
                  return (
                    <g
                      key={edge.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${name(source.id)} → ${name(target.id)}：${label}`}
                      aria-pressed={selected?.id === edge.id}
                      onClick={() => setSelectedId(edge.id)}
                      onKeyDown={(event) => selectOnKey(event, () => setSelectedId(edge.id))}
                      className="sc-graph-edge cursor-pointer"
                    >
                      <title>{`${name(source.id)} → ${name(target.id)}：${label}`}</title>
                      <path d={d} fill="none" stroke="transparent" strokeWidth={24} />
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--sc-accent-text)"
                        strokeWidth={selected?.id === edge.id ? 2.5 : 1.5}
                        strokeDasharray={edge.displayStatus === 'confirmed' ? undefined : '6 5'}
                        markerEnd={`url(#${markerId})`}
                      />
                      <rect
                        x={labelX - 92}
                        y={labelY - 14}
                        width={184}
                        height={28}
                        rx={14}
                        fill="var(--sc-surface-raised)"
                        stroke="var(--sc-border)"
                      />
                      <text
                        x={labelX}
                        y={labelY + 4}
                        textAnchor="middle"
                        fontSize={12}
                        fill="var(--sc-text-secondary)"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                {nodes.map((node) => (
                  <g
                    key={node.id}
                    role={node.filePath ? 'button' : undefined}
                    tabIndex={node.filePath ? 0 : undefined}
                    aria-label={`${node.name}${node.missing ? '（人物缺失）' : '：打开人物设定'}`}
                    onClick={() => {
                      if (node.filePath) onOpen(node.filePath);
                    }}
                    onKeyDown={(event) =>
                      selectOnKey(event, () => {
                        if (node.filePath) onOpen(node.filePath);
                      })
                    }
                    className={node.filePath ? 'sc-graph-node cursor-pointer' : 'sc-graph-node'}
                  >
                    <rect
                      x={node.x - 78}
                      y={node.y - 34}
                      width={156}
                      height={68}
                      rx={14}
                      fill="var(--sc-surface-raised)"
                      stroke="var(--sc-border-strong)"
                      strokeDasharray={node.missing ? '4 3' : undefined}
                    />
                    <text
                      x={node.x}
                      y={node.y - 2}
                      textAnchor="middle"
                      fontSize={16}
                      fontWeight={600}
                      fill="var(--sc-text)"
                    >
                      {node.name.length > 9 ? `${node.name.slice(0, 8)}…` : node.name}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 19}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--sc-text-muted)"
                    >
                      {node.missing ? '人物缺失 / ID 不唯一' : '查看人物设定'}
                    </text>
                    <title>{node.name}</title>
                  </g>
                ))}
              </g>
            </svg>
          </div>
          {selected && (
            <section
              className="rounded-xl border border-[var(--sc-border)] p-4"
              aria-label="所选关系详情"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-medium">
                  {name(selected.sourceCharacterId)} → {name(selected.targetCharacterId)}
                </h2>
                <span className="rounded-full bg-[var(--sc-accent-soft)] px-2 py-1 text-[11px] text-[var(--sc-accent-text)]">
                  {STATUS_LABELS[selected.displayStatus]}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--sc-text-secondary)]">
                {selected.description || '暂未填写关系描述。'}
              </p>
              {selected.sourcePerspective && (
                <p className="mt-2 text-[12px] leading-relaxed">
                  发起方视角：{selected.sourcePerspective}
                </p>
              )}
              {selected.targetPerspective && (
                <p className="mt-2 text-[12px] leading-relaxed">
                  对方视角：{selected.targetPerspective}
                </p>
              )}
              {selected.currentState && (
                <p className="mt-2 text-[12px]">当前状态：{selected.currentState}</p>
              )}
              <button
                type="button"
                onClick={() => onOpen(selected.filePath)}
                className="mt-3 text-[12px] text-[var(--sc-accent-text)] underline"
              >
                打开这条关系文件
              </button>
            </section>
          )}
          <details className="text-[12px] text-[var(--sc-text-secondary)]">
            <summary className="cursor-pointer">关系清单（{graph.edges.length}）</summary>
            <ul className="mt-2 space-y-1">
              {graph.edges.map((edge) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(edge.id)}
                    className="rounded p-2 text-left hover:bg-[var(--sc-surface-raised)]"
                  >
                    {name(edge.sourceCharacterId)} → {name(edge.targetCharacterId)} ·{' '}
                    {RELATIONSHIP_TYPE_LABELS[edge.type]} · {STATUS_LABELS[edge.displayStatus]}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
