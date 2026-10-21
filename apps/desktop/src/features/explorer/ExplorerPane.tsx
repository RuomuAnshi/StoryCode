import { BookOpen, FilePlus2, FolderOpen, RefreshCw } from 'lucide-react';
import { FileTree } from './FileTree';
import { IconButton } from '@/components/Button';
import { SectionLabel, Spinner } from '@/components/primitives';
import { useWorkspace } from '@/stores/workspace-store';
import { useEditor } from '@/stores/editor-store';

interface ExplorerPaneProps {
  onCreateChapter(): void;
  onOpenProject(): void;
}

/** Left rail: project files. */
export function ExplorerPane({ onCreateChapter, onOpenProject }: ExplorerPaneProps) {
  const project = useWorkspace((state) => state.project);
  const tree = useWorkspace((state) => state.tree);
  const loading = useWorkspace((state) => state.loading);
  const refreshTree = useWorkspace((state) => state.refreshTree);
  const activePath = useEditor((state) => state.document?.path ?? null);
  const openFile = useEditor((state) => state.openFile);

  return (
    <aside className="flex h-full w-full flex-col bg-[var(--sc-surface)]">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--sc-text-muted)]">
          小说文件
        </span>
        <div className="flex items-center gap-0.5">
          {project && (
            <>
              <IconButton label="新建章节" onClick={onCreateChapter}>
                <FilePlus2 size={13.5} />
              </IconButton>
              <IconButton label="刷新文件树" onClick={() => void refreshTree()}>
                <RefreshCw size={13} />
              </IconButton>
            </>
          )}
          {!project && (
            <IconButton label="打开项目" onClick={onOpenProject}>
              <FolderOpen size={13.5} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-[var(--sc-text-muted)]">
            <Spinner className="size-3" />
            正在加载项目…
          </div>
        )}
        {!loading && project && (
          <>
            <SectionLabel className="mb-1">{project.name}</SectionLabel>
            <FileTree
              nodes={tree}
              activePath={activePath}
              onOpen={(path) => void openFile(path)}
              onCreateChapter={onCreateChapter}
              collapsed={false}
            />
          </>
        )}
        {!loading && !project && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <BookOpen size={22} className="text-[var(--sc-text-muted)] opacity-60" />
            <p className="text-[12px] leading-relaxed text-[var(--sc-text-muted)]">
              尚未打开小说项目
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
