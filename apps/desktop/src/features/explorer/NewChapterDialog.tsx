import { useEffect, useState } from 'react';
import { describeError } from '@storycode/core';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner, Field, inputClass } from '@/components/primitives';
import { useWorkspace } from '@/stores/workspace-store';
import { useEditor } from '@/stores/editor-store';

interface NewChapterDialogProps {
  open: boolean;
  onClose(): void;
}

/** Manual chapter creation. AI-created chapters go through the proposal flow. */
export function NewChapterDialog({ open, onClose }: NewChapterDialogProps) {
  const project = useWorkspace((state) => state.project);
  const refreshTree = useWorkspace((state) => state.refreshTree);
  const openFile = useEditor((state) => state.openFile);

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOrder, setNextOrder] = useState(1);

  useEffect(() => {
    if (!open || !project) return;
    setTitle('');
    setError(null);
    void project.store
      .nextChapterSlot()
      .then((slot) => setNextOrder(slot.order))
      .catch(() => setNextOrder(1));
  }, [open, project]);

  const handleCreate = async () => {
    if (!project) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError('请填写章节标题。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chapter = await project.store.createChapter({ title: trimmed });
      await refreshTree();
      void project.indexer.updateFile(chapter.path).catch(() => undefined);
      await openFile(chapter.path);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建章节"
      description={`将创建 chapters/${String(nextOrder).padStart(3, '0')}.md`}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleCreate()} loading={busy}>
            创建
          </Button>
        </>
      }
    >
      <Field label="章节标题" htmlFor="chapter-title">
        <input
          id="chapter-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="第一章 归来"
          className={inputClass}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleCreate();
          }}
        />
      </Field>
      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
    </Dialog>
  );
}
