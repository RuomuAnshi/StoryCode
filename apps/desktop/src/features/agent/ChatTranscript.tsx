import { useEffect, useRef } from 'react';
import { AlertTriangle, Sparkles, User } from 'lucide-react';
import { AuthorQuestionCard } from './AuthorQuestionCard';
import { PlanSteps } from './PlanSteps';
import { ToolCallList } from './ToolCallList';
import { Citations } from './Citations';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import type { ChatTurn } from '@/stores/agent-store';
import { useAgent } from '@/stores/agent-store';

/** Scrolling conversation history. */
export function ChatTranscript() {
  const turns = useAgent((state) => state.turns);
  const streamingText = useAgent((state) => state.streamingText);
  const status = useAgent((state) => state.status);
  const send = useAgent((state) => state.send);
  const proposal = useAgent((state) => state.activeProposal);
  const directions = useAgent((state) => state.worldDirections);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, streamingText, status]);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {turns.map((turn) => (
        <div key={turn.id}>
          <Turn turn={turn} />
          {turn.authorQuestion && (
            <AuthorQuestionCard
              question={turn.authorQuestion}
              disabled={
                status === 'running' ||
                turn !== turns[turns.length - 1] ||
                !!proposal ||
                !!directions
              }
              onSelect={(option) =>
                void send(
                  `针对「${turn.authorQuestion!.question}」，我选择「${option.label}」：${option.description}`,
                )
              }
            />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user';
  const isRunning = turn.status === 'running';
  const showPlan = !isUser && (turn.steps?.length ?? 0) > 0;
  const showTools = !isUser && (turn.toolCalls?.length ?? 0) > 0;

  return (
    <div className="sc-fade-in space-y-1.5">
      <div className="flex items-center gap-1.5">
        {isUser ? (
          <User size={11} className="text-[var(--sc-text-muted)]" />
        ) : (
          <Sparkles size={11} className="text-[var(--sc-accent-text)]" />
        )}
        <span className="text-[11px] font-medium text-[var(--sc-text-secondary)]">
          {isUser ? '你' : 'StoryCode'}
        </span>
        <span className="text-[10.5px] text-[var(--sc-text-muted)]">
          {formatClock(turn.createdAt)}
        </span>
        {turn.status === 'cancelled' && (
          <span className="text-[10.5px] text-[var(--sc-warning)]">已停止</span>
        )}
        {turn.status === 'failed' && (
          <span className="text-[10.5px] text-[var(--sc-danger)]">失败</span>
        )}
      </div>

      {showPlan && (
        <div className="rounded-lg border border-[var(--sc-border)] bg-[var(--sc-surface-raised)]/40 px-2.5 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sc-text-muted)]">
            Agent 计划
          </p>
          <PlanSteps steps={turn.steps ?? []} />
        </div>
      )}

      {showTools && <ToolCallList calls={turn.toolCalls ?? []} />}

      {turn.content.length > 0 && (
        <div
          className={cn(
            'sc-selectable whitespace-pre-wrap break-words text-[13px] leading-[1.7]',
            isUser ? 'text-[var(--sc-text)]' : 'text-[var(--sc-text-secondary)]',
          )}
        >
          {turn.content}
        </div>
      )}

      {isRunning && !turn.content && (
        <p className="text-[12px] text-[var(--sc-text-muted)]">
          <span className="sc-pulse">正在思考…</span>
        </p>
      )}

      {turn.citations && turn.citations.length > 0 && <Citations citations={turn.citations} />}

      {turn.capabilityWarning && (
        <p className="rounded-md bg-[var(--sc-warning)]/10 px-2 py-1.5 text-[12px] leading-relaxed text-[var(--sc-warning)]">
          {turn.capabilityWarning}
        </p>
      )}

      {turn.error && (
        <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--sc-danger)]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{turn.error}</span>
        </p>
      )}
    </div>
  );
}
