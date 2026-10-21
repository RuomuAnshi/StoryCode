import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';
import { ChapterEditor } from './ChapterEditor';
import { Banner, EmptyState } from '@/components/primitives';
import { Button } from '@/components/Button';
import { useEditor } from '@/stores/editor-store';
import { useWorkspace } from '@/stores/workspace-store';
import { cn } from '@/lib/cn';

interface EditorPaneProps {
  onCreateChapter(): void;
  onOpenSettings(): void;
}

/** Center pane: the writing surface. */
export function EditorPane({ onCreateChapter, onOpenSettings }: EditorPaneProps) {
  const document = useEditor((state) => state.document);
  const saveStatus = useEditor((state) => state.saveStatus);
  const saveError = useEditor((state) => state.saveError);
  const conflict = useEditor((state) => state.conflict);
  const updateBody = useEditor((state) => state.updateBody);
  const updateTitle = useEditor((state) => state.updateTitle);
  const save = useEditor((state) => state.save);
  const dismissConflict = useEditor((state) => state.dismissConflict);
  const reload = useEditor((state) => state.openFile);
  const project = useWorkspace((state) => state.project);

  const [reading, setReading] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleDraft(document?.meta.title ?? '');
  }, [document?.path, document?.meta.title]);

  const handleChange = useCallback(
    (markdown: string) => {
      updateBody(markdown);
    },
    [updateBody],
  );

  const commitTitle = useCallback(() => {
    if (!document) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length === 0) {
      setTitleDraft(document.meta.title);
      return;
    }
    if (trimmed !== document.meta.title) updateTitle(trimmed);
  }, [document, titleDraft, updateTitle]);

  const isChapter = document?.kind === 'chapter';

  if (!project) {
    return (
      <EmptyState
        icon={<FileText size={30} />}
        title="尚未打开小说项目"
        description="创建一个新项目，或者打开已有的 StoryCode 项目文件夹开始写作。"
        action={
          <Button variant="primary" onClick={onCreateChapter}>
            新建小说
          </Button>
        }
      />
    );
  }

  if (!document) {
    return (
      <EmptyState
        icon={<FileText size={30} />}
        title="选择一章开始写作"
        description="从左侧文件树打开章节，或新建一章。右侧的 AI 助手也能直接为你创建章节提案。"
        action={
          <Button variant="secondary" onClick={onCreateChapter}>
            新建章节
          </Button>
        }
      />
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-[var(--sc-editor-bg)]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--sc-border)] px-4">
        {isChapter ? (
          <input
            ref={titleRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                titleRef.current?.blur();
              }
            }}
            placeholder="章节标题"
            className={cn(
              'min-w-0 flex-1 truncate bg-transparent text-[12.5px] font-medium text-[var(--sc-text)]',
              'placeholder:text-[var(--sc-text-muted)] focus:outline-none',
            )}
            aria-label="章节标题"
          />
        ) : (
          <span className="truncate text-[12.5px] font-medium text-[var(--sc-text)]">
            {document.path}
          </span>
        )}
        {isChapter && (
          <button
            type="button"
            aria-pressed={reading}
            onClick={() => setReading((value) => !value)}
            className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)]"
          >
            {reading ? '返回编辑' : '阅读预览'}
          </button>
        )}
        <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--sc-text-muted)]">
          {saveStatus === 'saving' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> 保存中
            </span>
          )}
        </span>
      </div>

      {(saveError || conflict) && (
        <div className="shrink-0 space-y-2 px-4 py-2">
          {conflict && (
            <Banner
              tone="warning"
              action={
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => void reload(conflict.path)}>
                    重新载入
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void save({ force: true })}>
                    覆盖保存
                  </Button>
                </div>
              }
              onDismiss={dismissConflict}
            >
              {conflict.message}
            </Banner>
          )}
          {saveError && (
            <Banner
              tone="error"
              action={
                <Button size="sm" onClick={onOpenSettings}>
                  检查模型设置
                </Button>
              }
            >
              {saveError}
            </Banner>
          )}
        </div>
      )}

      {isChapter && !reading ? (
        <ChapterEditor
          documentKey={document.path}
          body={document.body}
          onChange={handleChange}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[42rem] px-8 py-8">
            {saveError ? (
              <Banner tone="warning" onDismiss={undefined}>
                <AlertTriangle size={13} className="mr-1 inline" />
                该文件为只读预览：{saveError}
              </Banner>
            ) : null}
            {document.path.endsWith('.md') ? (
              <MarkdownPreview source={document.body} />
            ) : (
              <pre className="whitespace-pre-wrap text-[14px] leading-[1.85]">{document.body}</pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
