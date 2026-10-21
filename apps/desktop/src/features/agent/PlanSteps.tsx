import { Check, Circle, Loader2, Minus, X } from 'lucide-react';
import type { AgentPlanStepView } from '@storycode/agent';
import { cn } from '@/lib/cn';

/** Compact checklist showing what the agent is doing right now. */
export function PlanSteps({ steps }: { steps: AgentPlanStepView[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-0.5">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-1.5 text-[11.5px] leading-5">
          <span className="mt-0.5 shrink-0">
            {step.status === 'running' ? (
              <Loader2 size={11} className="animate-spin text-[var(--sc-accent-text)]" />
            ) : step.status === 'done' ? (
              <Check size={11} className="text-[var(--sc-success)]" />
            ) : step.status === 'failed' ? (
              <X size={11} className="text-[var(--sc-danger)]" />
            ) : step.status === 'skipped' ? (
              <Minus size={11} className="text-[var(--sc-text-muted)]" />
            ) : (
              <Circle size={9} className="text-[var(--sc-text-muted)] opacity-50" />
            )}
          </span>
          <span
            className={cn(
              'min-w-0',
              step.status === 'running' && 'text-[var(--sc-text)]',
              step.status === 'done' && 'text-[var(--sc-text-secondary)]',
              step.status === 'failed' && 'text-[var(--sc-danger)]',
              (step.status === 'pending' || step.status === 'skipped') &&
                'text-[var(--sc-text-muted)]',
            )}
          >
            {step.label}
            {step.detail && (
              <span className="ml-1 text-[var(--sc-text-muted)]">· {step.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
