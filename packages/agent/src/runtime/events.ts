import type {
  AuthorQuestion,
  AgentPhase,
  AgentMode,
  ChangeProposal,
  Citation,
  WorldDirections,
  WorldSelection,
} from '@storycode/core';

export interface AgentPlanStepView {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

export interface ToolCallView {
  id: string;
  name: string;
  arguments: unknown;
  status: 'running' | 'done' | 'failed';
  summary?: string;
  error?: string;
  mutating: boolean;
  durationMs?: number;
}

export interface ContextView {
  included: Array<{ path: string; reason: string; chars: number }>;
  dropped: Array<{ path: string; reason: string }>;
  estimatedTokens: number;
}

/** Everything the UI needs to render a running task. */
export type AgentEvent =
  | { type: 'phase'; phase: AgentPhase; detail?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text-reset' }
  | { type: 'plan'; steps: AgentPlanStepView[] }
  | { type: 'step-update'; step: AgentPlanStepView }
  | { type: 'tool-start'; call: ToolCallView }
  | { type: 'tool-end'; call: ToolCallView }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'context'; context: ContextView }
  | { type: 'proposal'; proposal: ChangeProposal }
  | { type: 'author-question'; question: AuthorQuestion }
  | { type: 'world-directions'; directions: WorldDirections }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'capability'; capabilityWarning: string }
  | { type: 'error'; message: string; retryable: boolean; detail?: string }
  | { type: 'done'; status: 'completed' | 'cancelled' | 'failed' };

export interface AgentRunRequest {
  mode: AgentMode;
  worldSelection?: WorldSelection;
  input: string;
  activeFilePath?: string;
  activeChapterOrder?: number;
  selection?: { text: string; startLine: number; endLine: number };
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentRunResult {
  status: 'completed' | 'cancelled' | 'failed';
  finalText: string;
  proposal: ChangeProposal | null;
  worldDirections: WorldDirections | null;
  authorQuestion: AuthorQuestion | null;
  error?: string;
  /** Set when the model cannot do what the requested mode needs. */
  capabilityWarning?: string;
  steps: AgentPlanStepView[];
  toolCalls: ToolCallView[];
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
}
