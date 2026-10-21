import { useEffect } from 'react';
import { PanelRight, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { ChatTranscript } from './ChatTranscript';
import { AgentComposer } from './AgentComposer';
import { WorldDirectionPicker } from '../world/WorldDirectionPicker';
import { ProposalCard } from '../review/ProposalCard';
import { IconButton } from '@/components/Button';
import { Banner, EmptyState } from '@/components/primitives';
import { useAgent } from '@/stores/agent-store';
import { useSettings } from '@/stores/settings-store';
import { useWorkspace } from '@/stores/workspace-store';

interface AgentPaneProps {
  onOpenSettings(): void;
}

const QUICK_PROMPTS = [
  '根据项目设定，规划第一章',
  '介绍这个项目的人物设定',
  '为这个故事提出三个世界观方向',
];

/** Right rail: the AI agent. */
export function AgentPane({ onOpenSettings }: AgentPaneProps) {
  const worldDirections = useAgent((state) => state.worldDirections);
  const chooseWorldDirection = useAgent((state) => state.chooseWorldDirection);
  const running = useAgent((state) => state.status === 'running');
  const turns = useAgent((state) => state.turns);
  const lastError = useAgent((state) => state.lastError);
  const activeProposal = useAgent((state) => state.activeProposal);
  const clearTranscript = useAgent((state) => state.clearTranscript);
  const retry = useAgent((state) => state.retry);
  const send = useAgent((state) => state.send);
  const setActiveProposal = useAgent((state) => state.setActiveProposal);
  const project = useWorkspace((state) => state.project);
  const settings = useSettings((state) => state.settings);
  const configured = useSettings((state) => state.isConfigured());
  const refreshKeyStatus = useSettings((state) => state.refreshKeyStatus);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus, settings.providerId]);

  const showProposal = activeProposal && !turns.some((turn) => turn.status === 'running');

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-[var(--sc-surface)]">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-[var(--sc-accent-text)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--sc-text-muted)]">
            AI 助手
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="清空对话"
            onClick={() => {
              clearTranscript();
              setActiveProposal(null);
            }}
          >
            <Plus size={13} />
          </IconButton>
        </div>
      </div>

      {!configured && (
        <div className="px-2.5 pb-2">
          <Banner
            tone="warning"
            action={
              <button
                type="button"
                onClick={onOpenSettings}
                className="shrink-0 rounded-md bg-[var(--sc-warning)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--sc-warning)]"
              >
                配置
              </button>
            }
          >
            尚未配置模型，AI 功能不可用。
          </Banner>
        </div>
      )}

      {!project ? (
        <EmptyState
          icon={<PanelRight size={26} />}
          title="先打开一部小说"
          description="AI 助手需要项目上下文。创建或打开项目后即可开始对话。"
        />
      ) : turns.length === 0 && !showProposal ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
          <Sparkles size={24} className="text-[var(--sc-accent-text)] opacity-80" />
          <div className="space-y-1 text-center">
            <p className="text-[13.5px] font-medium text-[var(--sc-text)]">开始创作</p>
            <p className="text-[12px] leading-relaxed text-[var(--sc-text-muted)]">
              描述你想写的内容。任何文件变更都会先生成提案，由你审核后才会写入。
            </p>
          </div>
          <div className="flex w-full flex-col gap-1">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void send(prompt)}
                className="rounded-lg border border-[var(--sc-border)] bg-[var(--sc-surface-raised)]/50 px-2.5 py-1.5 text-left text-[11.5px] text-[var(--sc-text-secondary)] transition-colors hover:border-[var(--sc-accent)]/40 hover:text-[var(--sc-text)]"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatTranscript />
      )}

      {!showProposal &&
        worldDirections &&
        project &&
        worldDirections.projectId === project.store.projectMeta.id &&
        worldDirections.projectRoot === project.store.root && (
          <div className="max-h-[56%] shrink-0 overflow-y-auto border-t border-[var(--sc-border)] p-2.5">
            <WorldDirectionPicker
              directions={worldDirections}
              busy={running}
              onSelect={(id) => void chooseWorldDirection(id)}
            />
          </div>
        )}

      {showProposal && (
        <div className="max-h-[52%] shrink-0 overflow-y-auto border-t border-[var(--sc-border)] p-2.5">
          <ProposalCard proposal={activeProposal} />
        </div>
      )}

      {lastError && !lastError.retryable && (
        <div className="px-2.5 pb-2">
          <Banner tone="error">{lastError.message}</Banner>
        </div>
      )}
      {lastError?.retryable && (
        <div className="px-2.5 pb-2">
          <Banner
            tone="error"
            action={
              <button
                type="button"
                onClick={() => void retry()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--sc-danger)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--sc-danger)]"
              >
                <RefreshCw size={9} />
                重试
              </button>
            }
          >
            {lastError.message}
          </Banner>
        </div>
      )}

      <AgentComposer />
    </aside>
  );
}
