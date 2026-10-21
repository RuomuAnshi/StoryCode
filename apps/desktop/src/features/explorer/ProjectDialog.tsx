import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { describeError } from '@storycode/core';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner, Field, inputClass } from '@/components/primitives';
import { useWorkspace } from '@/stores/workspace-store';
import { useEditor } from '@/stores/editor-store';
import { pickDirectory } from '@/lib/tauri';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/cn';

interface ProjectDialogProps {
  open: boolean;
  onClose(): void;
}

type Step = 'choose' | 'create';

/**
 * First-run and "new novel" flow. Creating a novel asks for a name and a
 * parent directory, then scaffolds the directory layout on disk.
 */
export function ProjectDialog({ open, onClose }: ProjectDialogProps) {
  const createProject = useWorkspace((state) => state.createProject);
  const openProject = useWorkspace((state) => state.openProject);
  const workspaceError = useWorkspace((state) => state.error);
  const clearError = useWorkspace((state) => state.clearError);
  const resetEditor = useEditor((state) => state.reset);

  const [step, setStep] = useState<Step>('choose');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('choose');
      setName('');
      setError(null);
      clearError();
    }
  }, [open, clearError]);

  const chooseParent = async () => {
    setError(null);
    try {
      const picked = await pickDirectory('选择小说的存放位置');
      if (picked) setParentDir(picked);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('请填写小说名称。');
      return;
    }
    if (parentDir.length === 0) {
      setError('请选择存放位置。');
      return;
    }
    setBusy(true);
    setError(null);
    resetEditor();
    try {
      await createProject(`${parentDir}/${trimmed}`, trimmed);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async () => {
    setError(null);
    try {
      const picked = await pickDirectory('选择 StoryCode 项目文件夹');
      if (!picked) return;
      setBusy(true);
      resetEditor();
      await openProject(picked);
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
      title={step === 'choose' ? '开始创作' : '新建小说'}
      description={
        step === 'choose'
          ? '每部小说都是一个独立目录，正文以 Markdown 文件保存，你随时可以用其他编辑器打开。'
          : '小说会创建在你选择的目录下，包含 chapters、characters、world、plot 等文件夹。'
      }
      footer={
        step === 'choose' ? (
          <>
            <Button
              variant="ghost"
              onClick={() => void handleOpen()}
              loading={busy}
              disabled={!isTauri()}
            >
              打开已有项目
            </Button>
            <Button variant="primary" onClick={() => setStep('create')}>
              新建小说
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('choose')}>
              返回
            </Button>
            <Button variant="primary" onClick={() => void handleCreate()} loading={busy}>
              创建
            </Button>
          </>
        )
      }
    >
      {!isTauri() && (
        <Banner tone="warning">
          当前在浏览器中预览，无法访问本地文件系统。请通过桌面应用运行（pnpm tauri dev）。
        </Banner>
      )}

      {step === 'create' && (
        <div className="space-y-4">
          <Field label="小说名称" htmlFor="novel-name">
            <input
              id="novel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入小说名称"
              className={inputClass}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreate();
              }}
            />
          </Field>

          <Field label="存放位置" hint="会在该目录下创建与小说同名的文件夹。">
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={parentDir}
                placeholder="尚未选择"
                className={cn(inputClass, 'cursor-default text-[12.5px]')}
              />
              <Button size="sm" onClick={() => void chooseParent()} icon={<FolderOpen size={12} />}>
                选择
              </Button>
            </div>
            {parentDir && name.trim().length > 0 && (
              <p className="truncate font-mono text-[11px] text-[var(--sc-text-muted)]">
                {parentDir}/{name.trim()}
              </p>
            )}
          </Field>
        </div>
      )}

      {(error ?? workspaceError) && (
        <div className="mt-3">
          <Banner tone="error">{error ?? workspaceError}</Banner>
        </div>
      )}
    </Dialog>
  );
}
