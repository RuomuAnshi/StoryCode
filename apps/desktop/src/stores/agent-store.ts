/**
 * Agent session state.
 *
 * Runs `AgentSession` against the open project and mirrors its event stream into
 * React state. The session object itself is not stored in Zustand (it is not
 * serializable and holds an AbortController); it lives in a module-level slot.
 */

import { create } from 'zustand';
import {
  AgentSession,
  JsonToolClient,
  type AgentPlanStepView,
  type AgentRunResult,
  type ContextView,
  type ToolCallView,
} from '@storycode/agent';
import {
  describeError,
  type AuthorQuestion,
  type AgentMode,
  type ChangeProposal,
  type Citation,
  type WorldDirections,
  type WorldSelection,
} from '@storycode/core';
import { desktop } from '@/lib/tauri';
import { DesktopModelClient } from '@/lib/model-transport';
import { useEditor } from './editor-store.js';
import { useSettings } from './settings-store.js';
import { useWorkspace } from './workspace-store.js';

export interface ChatTurn {
  authorQuestion?: AuthorQuestion;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Assistant turns only. */
  steps?: AgentPlanStepView[];
  toolCalls?: ToolCallView[];
  citations?: Citation[];
  context?: ContextView;
  proposalId?: string;
  status?: 'running' | 'completed' | 'cancelled' | 'failed';
  error?: string;
  capabilityWarning?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type AgentStatus = 'idle' | 'running';

interface SendOptions {
  selection?: { text: string; startLine: number; endLine: number };
  worldSelection?: WorldSelection;
}

interface AgentState {
  webEnabled: boolean;
  setWebEnabled(enabled: boolean): void;
  turns: ChatTurn[];
  status: AgentStatus;
  phase: string;
  mode: AgentMode;
  draft: string;
  streamingText: string;
  plan: AgentPlanStepView[];
  toolCalls: ToolCallView[];
  citations: Citation[];
  context: ContextView | null;
  activeProposal: ChangeProposal | null;
  worldDirections: WorldDirections | null;
  lastRunOptions: SendOptions | null;
  chooseWorldDirection(id: string): Promise<void>;
  lastError: { message: string; retryable: boolean } | null;
  /** Set when the configured model lacks a capability the mode needs. */
  capabilityWarning: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;

  setMode(mode: AgentMode): void;
  setDraft(draft: string): void;
  send(input?: string, options?: SendOptions): Promise<void>;
  cancel(): void;
  retry(): Promise<void>;
  clearTranscript(): void;
  setActiveProposal(proposal: ChangeProposal | null): void;
  appendTurn(turn: ChatTurn): void;
  updateTurn(id: string, patch: Partial<ChatTurn>): void;
}

let activeSession: AgentSession | null = null;
let turnCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${Date.now()}-${turnCounter}`;
}

const INITIAL = {
  webEnabled: false,
  turns: [] as ChatTurn[],
  status: 'idle' as AgentStatus,
  phase: '',
  mode: 'agent' as AgentMode,
  draft: '',
  streamingText: '',
  plan: [] as AgentPlanStepView[],
  toolCalls: [] as ToolCallView[],
  citations: [] as Citation[],
  context: null as ContextView | null,
  activeProposal: null as ChangeProposal | null,
  worldDirections: null as WorldDirections | null,
  lastRunOptions: null as SendOptions | null,
  lastError: null as { message: string; retryable: boolean } | null,
  capabilityWarning: null as string | null,
  usage: null as { inputTokens: number; outputTokens: number } | null,
};

export const useAgent = create<AgentState>((set, get) => ({
  ...INITIAL,
  setWebEnabled(webEnabled) {
    if (get().status !== 'running') set({ webEnabled });
  },

  setMode(mode) {
    set({ mode });
  },

  setDraft(draft) {
    set({ draft });
  },

  async send(input, options) {
    const text = (input ?? get().draft).trim();
    if (text.length === 0 || get().status === 'running') return;

    const workspace = useWorkspace.getState();
    const project = workspace.project;
    if (!project) {
      set({ lastError: { message: '请先打开一个小说项目', retryable: false } });
      return;
    }

    const settings = useSettings.getState();
    if (!settings.isConfigured()) {
      set({
        lastError: {
          message: '尚未完成模型配置：请在设置中填写 Base URL 与 API Key',
          retryable: false,
        },
      });
      return;
    }

    const editorDocument = useEditor.getState().document;
    const userTurn: ChatTurn = {
      id: nextTurnId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    const assistantTurn: ChatTurn = {
      id: nextTurnId(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      status: 'running',
    };

    set({
      turns: [...get().turns, userTurn, assistantTurn],
      status: 'running',
      phase: 'planning',
      draft: '',
      streamingText: '',
      plan: [],
      toolCalls: [],
      citations: [],
      context: null,
      lastError: null,
      usage: null,
      capabilityWarning: null,
      activeProposal: null,
      lastRunOptions: options ?? null,
    });

    const client = new DesktopModelClient({
      providerId: settings.settings.providerId,
      baseUrl: settings.settings.baseUrl,
      model: settings.settings.model,
      timeoutMs: settings.settings.timeoutMs,
    });

    const session = new AgentSession({
      ...(get().webEnabled ? { web: { search: desktop.webSearch, fetch: desktop.webFetch } } : {}),
      client: settings.settings.toolProtocol === 'json' ? new JsonToolClient(client) : client,
      project: project.store,
      indexer: project.indexer,
      proposals: project.proposals,
      projectName: project.name,
      config: {
        temperature: settings.settings.temperature,
        maxTokens: settings.settings.maxTokens,
        timeoutMs: settings.settings.timeoutMs,
      },
    });
    activeSession = session;

    const history = get()
      .turns.filter((turn) => turn.id !== userTurn.id && turn.id !== assistantTurn.id)
      .filter((turn) => turn.content.trim().length > 0)
      .slice(-8)
      .map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));

    const request = {
      mode: get().mode,
      input: text,
      ...(editorDocument?.path ? { activeFilePath: editorDocument.path } : {}),
      ...(editorDocument?.kind === 'chapter'
        ? { activeChapterOrder: editorDocument.meta.order }
        : {}),
      ...(options?.selection ? { selection: options.selection } : {}),
      ...(options?.worldSelection ? { worldSelection: options.worldSelection } : {}),
      ...(history.length > 0 ? { history } : {}),
    };

    let accumulated = '';
    let finalResult: AgentRunResult | null = null;

    try {
      const generator = session.run(request);
      while (true) {
        const next = await generator.next();
        if (next.done) {
          finalResult = next.value;
          break;
        }
        const event = next.value;
        switch (event.type) {
          case 'phase':
            set({ phase: event.phase });
            break;
          case 'text-delta':
            accumulated += event.text;
            set({ streamingText: accumulated });
            break;
          case 'text-reset':
            accumulated = '';
            set({ streamingText: '' });
            break;
          case 'plan':
            set({ plan: event.steps });
            break;
          case 'step-update':
            set({
              plan: get().plan.map((step) => (step.id === event.step.id ? event.step : step)),
            });
            break;
          case 'tool-start':
            set({
              toolCalls: [...get().toolCalls.filter((c) => c.id !== event.call.id), event.call],
            });
            break;
          case 'tool-end':
            set({
              toolCalls: get().toolCalls.map((call) =>
                call.id === event.call.id ? event.call : call,
              ),
            });
            break;
          case 'citations':
            set({ citations: event.citations });
            break;
          case 'context':
            set({ context: event.context });
            break;
          case 'author-question':
            get().updateTurn(assistantTurn.id, { authorQuestion: event.question });
            break;
          case 'world-directions':
            set({ worldDirections: event.directions });
            break;
          case 'proposal':
            set({ activeProposal: event.proposal });
            break;
          case 'capability':
            set({ capabilityWarning: event.capabilityWarning });
            break;
          case 'usage':
            set({ usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens } });
            break;
          case 'error':
            set({ lastError: { message: event.message, retryable: event.retryable } });
            break;
          case 'done':
            break;
        }
      }
    } catch (error) {
      set({ lastError: { message: describeError(error), retryable: true } });
    } finally {
      activeSession = null;
    }

    const status = finalResult?.status ?? 'failed';
    const finalText = finalResult?.finalText ?? accumulated;
    const proposal = finalResult?.proposal ?? get().activeProposal;
    const capabilityWarning = finalResult?.capabilityWarning ?? get().capabilityWarning;
    get().updateTurn(assistantTurn.id, {
      content: finalText,
      status: status === 'completed' ? 'completed' : status,
      steps: finalResult?.steps ?? get().plan,
      toolCalls: finalResult?.toolCalls ?? get().toolCalls,
      citations: finalResult?.citations ?? get().citations,
      ...(proposal ? { proposalId: proposal.id } : {}),
      ...(finalResult?.usage ? { usage: finalResult.usage } : {}),
      ...(get().lastError ? { error: get().lastError!.message } : {}),
      ...(capabilityWarning ? { capabilityWarning } : {}),
    });
    set({
      status: 'idle',
      phase: '',
      streamingText: '',
      activeProposal: proposal ?? null,
      ...(options?.worldSelection && proposal ? { worldDirections: null } : {}),
    });
  },

  async chooseWorldDirection(id) {
    const directions = get().worldDirections;
    const project = useWorkspace.getState().project;
    const candidate = directions?.candidates.find((c) => c.id === id);
    if (
      !directions ||
      !candidate ||
      !project ||
      directions.projectId !== project.store.projectMeta.id ||
      directions.projectRoot !== project.store.root
    ) {
      set({ lastError: { message: '候选已失效，请在当前项目重新生成。', retryable: false } });
      return;
    }
    set({ mode: 'agent' });
    await get().send(
      `我已在应用中选择「${candidate.title}」。请只细化这个世界观方向，生成结构化的待审核提案，不要混入其他候选。`,
      { worldSelection: { directions, candidateId: id } },
    );
  },

  cancel() {
    activeSession?.cancel();
    set({ status: 'idle', phase: '' });
  },

  async retry() {
    const turns = get().turns;
    let lastUser = '';
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn && turn.role === 'user') {
        lastUser = turn.content;
        break;
      }
    }
    if (lastUser.length === 0) return;
    // Drop the failed assistant turn so retry does not duplicate the transcript.
    const trimmed = [...turns];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.role === 'assistant') {
      trimmed.pop();
    }
    set({ turns: trimmed, lastError: null });
    await get().send(lastUser, get().lastRunOptions ?? undefined);
  },

  clearTranscript() {
    set({
      turns: [],
      lastError: null,
      activeProposal: null,
      worldDirections: null,
      lastRunOptions: null,
    });
  },

  setActiveProposal(proposal) {
    set({ activeProposal: proposal });
  },

  appendTurn(turn) {
    set({ turns: [...get().turns, turn] });
  },

  updateTurn(id, patch) {
    set({ turns: get().turns.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)) });
  },
}));
