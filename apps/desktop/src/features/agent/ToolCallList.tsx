import { useState } from 'react';
import { ChevronRight, FilePen, Loader2, Search, Wrench, X } from 'lucide-react';
import type { ToolCallView } from '@storycode/agent';
import { cn } from '@/lib/cn';

/** Friendly Chinese labels for tool names shown to the author. */
const TOOL_LABELS: Record<string, string> = {
  list_project_files: '查看项目文件',
  read_project_file: '读取文件',
  search_project_files: '检索项目内容',
  propose_create_file: '提议新建文件',
  propose_edit_file: '提议修改文件',
  propose_delete_file: '提议删除文件',
  get_chapter: '读取章节',
  list_chapters: '列出章节',
  get_recent_chapters: '读取前文',
  get_character: '读取人物设定',
  get_relationships: '读取人物关系',
  propose_world_directions: '构思世界观方向',
  propose_world_setting: '细化所选世界观',
  propose_character_cards: '设计人物与关系',
  propose_character_update: '局部更新人物设定',
  list_characters: '列出人物',
  get_world_setting: '读取世界观',
  get_story_rules: '读取写作规则',
  get_editor_selection: '读取选区',
};

function iconFor(name: string) {
  if (name.startsWith('propose_')) return FilePen;
  if (name.includes('search')) return Search;
  return Wrench;
}

/** Expandable list of tool invocations for one assistant turn. */
export function ToolCallList({ calls }: { calls: ToolCallView[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const Icon = iconFor(call.name);
  const label = TOOL_LABELS[call.name] ?? call.name;
  const detail =
    typeof call.arguments === 'object' && call.arguments !== null
      ? ((call.arguments as Record<string, unknown>).path ??
        (call.arguments as Record<string, unknown>).title ??
        (call.arguments as Record<string, unknown>).query)
      : undefined;

  return (
    <div className="rounded-md border border-[var(--sc-border)] bg-[var(--sc-surface-raised)]/50">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <ChevronRight
          size={10}
          className={cn(
            'shrink-0 text-[var(--sc-text-muted)] transition-transform',
            open && 'rotate-90',
          )}
        />
        <Icon size={11} className="shrink-0 text-[var(--sc-text-muted)]" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[11.5px]',
            call.status === 'failed'
              ? 'text-[var(--sc-danger)]'
              : 'text-[var(--sc-text-secondary)]',
          )}
        >
          {label}
          {typeof detail === 'string' && detail.length > 0 && (
            <span className="ml-1.5 font-mono text-[10.5px] text-[var(--sc-text-muted)]">
              {detail}
            </span>
          )}
        </span>
        {call.status === 'running' && (
          <Loader2 size={10} className="shrink-0 animate-spin text-[var(--sc-accent-text)]" />
        )}
        {call.status === 'failed' && <X size={10} className="shrink-0 text-[var(--sc-danger)]" />}
      </button>
      {open && (
        <div className="space-y-1 border-t border-[var(--sc-border)] px-2 py-1.5">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--sc-text-muted)]">参数</p>
            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-[var(--sc-text-secondary)]">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {call.summary && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--sc-text-muted)]">
                结果
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-[var(--sc-text-secondary)]">
                {call.summary}
              </p>
            </div>
          )}
          {call.error && <p className="text-[11px] text-[var(--sc-danger)]">{call.error}</p>}
        </div>
      )}
    </div>
  );
}
