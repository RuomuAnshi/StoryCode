import { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, FileText, Globe2, Plus, Route, User } from 'lucide-react';
import type { FileNode, FileNodeKind } from '@storycode/core';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/Button';

interface FileTreeProps {
  nodes: FileNode[];
  activePath: string | null;
  onOpen(path: string): void;
  onCreateChapter(): void;
  collapsed: boolean;
}

const KIND_ICONS: Record<FileNodeKind, typeof FileText> = {
  project: BookOpen,
  folder: ChevronRight,
  chapter: FileText,
  character: User,
  world: Globe2,
  plot: Route,
  other: FileText,
};

const FOLDER_LABELS: Record<string, string> = {
  chapters: '章节',
  characters: '人物设定',
  world: '世界观',
  plot: '剧情',
};

/** Recursive outline of the project. Chapters sort by narrative order. */
export function FileTree({ nodes, activePath, onOpen, onCreateChapter, collapsed }: FileTreeProps) {
  if (collapsed) return null;
  if (nodes.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-[var(--sc-text-muted)]">
        还没有文件。
        <br />
        在右侧让 AI 创建第一章，或手动新建。
      </p>
    );
  }
  return (
    <div className="pb-4">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
          onCreateChapter={onCreateChapter}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpen,
  onCreateChapter,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpen(path: string): void;
  onCreateChapter(): void;
}) {
  const isFolder = node.children !== undefined;
  const [open, setOpen] = useState(depth === 0);
  const active = node.path === activePath;

  const chapters = useMemo(
    () => (node.children ?? []).filter((child) => child.kind === 'chapter'),
    [node.children],
  );
  const orderedChildren = useMemo(() => {
    const children = node.children ?? [];
    const rest = children.filter((child) => child.kind !== 'chapter');
    const sorted = [...chapters].sort((a, b) => (a.chapterOrder ?? 0) - (b.chapterOrder ?? 0));
    return [...sorted, ...rest];
  }, [node.children, chapters]);

  if (isFolder) {
    const label = FOLDER_LABELS[node.name] ?? node.name;
    const Icon = depth === 0 && node.kind === 'folder' ? folderIconFor(node.name) : ChevronRight;
    const showFolderIcon = depth === 0 && node.kind === 'folder';
    return (
      <div>
        <div
          className={cn(
            'group flex h-7 items-center gap-1.5 rounded-md pr-1 hover:bg-[var(--sc-surface-raised)]',
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {showFolderIcon ? (
              <Icon size={13} className="shrink-0 text-[var(--sc-text-muted)]" />
            ) : (
              <ChevronRight
                size={12}
                className={cn(
                  'shrink-0 text-[var(--sc-text-muted)] transition-transform',
                  open && 'rotate-90',
                )}
              />
            )}
            <span className="truncate text-[12.5px] font-medium text-[var(--sc-text-secondary)]">
              {label}
            </span>
            <span className="text-[11px] tabular-nums text-[var(--sc-text-muted)]">
              {chapters.length > 0 ? chapters.length : ''}
            </span>
          </button>
          {node.name === 'chapters' && (
            <IconButton
              label="新建章节"
              onClick={onCreateChapter}
              className="size-5 opacity-0 group-hover:opacity-100"
            >
              <Plus size={13} />
            </IconButton>
          )}
        </div>
        {open && (
          <div>
            {orderedChildren.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onOpen={onOpen}
                onCreateChapter={onCreateChapter}
              />
            ))}
            {orderedChildren.length === 0 && (
              <p
                className="py-1 text-[11.5px] text-[var(--sc-text-muted)]"
                style={{ paddingLeft: 20 + depth * 12 }}
              >
                暂无内容
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  const Icon = KIND_ICONS[node.kind] ?? FileText;
  const title = node.name.replace(/\.md$/i, '');
  return (
    <button
      type="button"
      onClick={() => onOpen(node.path)}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left transition-colors',
        active
          ? 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-text)]'
          : 'text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)] hover:text-[var(--sc-text)]',
      )}
      style={{ paddingLeft: 18 + depth * 12 }}
      title={node.path}
    >
      <Icon size={12.5} className="shrink-0 opacity-70" />
      <span className="truncate text-[12.5px]">{title}</span>
    </button>
  );
}

function folderIconFor(name: string) {
  if (name === 'characters') return User;
  if (name === 'world') return Globe2;
  if (name === 'plot') return Route;
  return BookOpen;
}
