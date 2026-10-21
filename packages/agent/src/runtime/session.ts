/**
 * Agent Session: one task executed end-to-end.
 *
 * Flow: assemble context -> stream model -> dispatch tools -> repeat until the
 * model stops calling tools -> emit a change proposal for author review.
 *
 * Nothing here writes to project files. The only side effect is a `Proposal`,
 * which the UI must explicitly commit. That separation is what makes review
 * mandatory rather than advisory.
 */

import {
  type AuthorQuestion,
  type AgentPhase,
  type AgentMode,
  type Citation,
  type ChangeProposal,
  type WorldDirections,
  CancelledError,
  describeError,
} from '@storycode/core';
import type { ProjectIndexer, ProjectStore, ProposalService } from '@storycode/storage';
import type { ModelClient, ModelMessage, ModelToolCall } from '../providers/types.js';
import { validateWorldSelection } from '../workflows/world-builder.js';
import { buildSystemPrompt } from '../prompts/system.js';
import type { WebResearchClient, ToolContext } from '../tools/types.js';
import { dispatchTool } from './tools-dispatcher.js';
import { assembleContext } from './context.js';
import type {
  AgentEvent,
  AgentPlanStepView,
  AgentRunRequest,
  AgentRunResult,
  ToolCallView,
} from './events.js';

export interface AgentSessionOptions {
  web?: WebResearchClient;
  client: ModelClient;
  project: ProjectStore;
  indexer: ProjectIndexer;
  proposals: ProposalService;
  projectName: string;
  config: { temperature?: number; maxTokens?: number; timeoutMs?: number };
  /** Maximum tool-calling rounds before the task is force-stopped. */
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 12;

export class AgentSession {
  private phase: AgentPhase = 'idle';
  private authorQuestion: AuthorQuestion | null = null;
  private worldDirections: WorldDirections | null = null;
  private abortController: AbortController | null = null;
  private readonly steps: AgentPlanStepView[] = [];
  private readonly toolCalls: ToolCallView[] = [];
  private readonly citations: Citation[] = [];
  private capabilityWarning: string | null = null;

  constructor(private readonly options: AgentSessionOptions) {}

  cancel(): void {
    this.abortController?.abort();
  }

  get isRunning(): boolean {
    return (
      this.phase !== 'idle' &&
      this.phase !== 'completed' &&
      this.phase !== 'failed' &&
      this.phase !== 'cancelled'
    );
  }

  /**
   * Runs a task, yielding UI events. The final event is always `done`.
   * The generator never throws for expected failures: it reports them as events.
   */
  async *run(request: AgentRunRequest): AsyncGenerator<AgentEvent, AgentRunResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    let finalText = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    let proposal: ChangeProposal | null = null;
    const pendingChanges: ToolContext['pending'] = [];

    const emit = (event: AgentEvent): AgentEvent => event;

    try {
      this.worldDirections = null;
      this.authorQuestion = null;
      if (request.worldSelection)
        validateWorldSelection(request.worldSelection, { project: this.options.project });
      // Spec §5.3: a model without tool calling must degrade loudly, never fake
      // a file edit. In ask mode no tools are needed, so only warn elsewhere.
      this.capabilityWarning = this.checkCapabilities(request.mode);
      const capabilityWarning = this.capabilityWarning;
      if (capabilityWarning) {
        yield emit({ type: 'capability', capabilityWarning });
      }

      this.setPhase('planning');
      yield emit({ type: 'phase', phase: 'planning', detail: '正在分析需求并组装上下文' });

      const context = await assembleContext({
        projectName: this.options.projectName,
        mode: request.mode,
        indexer: this.options.indexer,
        project: this.options.project,
        ...(request.activeFilePath ? { activeFilePath: request.activeFilePath } : {}),
        ...(request.activeChapterOrder !== undefined
          ? { activeChapterOrder: request.activeChapterOrder }
          : {}),
        ...(request.selection ? { selection: request.selection } : {}),
        query: request.input,
      });
      yield emit({
        type: 'context',
        context: {
          included: context.included,
          dropped: context.dropped,
          estimatedTokens: context.estimatedTokens,
        },
      });

      const planSteps = buildPlan(request.mode);
      this.steps.length = 0;
      this.steps.push(...planSteps);
      yield emit({ type: 'plan', steps: this.steps.map((step) => ({ ...step })) });
      this.updateStep('analyze', 'done');
      yield emit({ type: 'step-update', step: this.stepView('analyze') });

      this.setPhase('retrieving');
      yield emit({ type: 'phase', phase: 'retrieving', detail: '读取相关章节与设定' });
      this.updateStep('retrieve', 'running');
      yield emit({ type: 'step-update', step: this.stepView('retrieve') });

      const messages: ModelMessage[] = [
        {
          role: 'system',
          content:
            buildSystemPrompt(context.prompt) +
            (this.options.web
              ? '\n联网已由作者开启，可用 web_search 与 web_fetch 查询公开资料。'
              : '\n联网未开启，不可声称已搜索或读取网页。'),
        },
        ...(request.history ?? []).map<ModelMessage>((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        { role: 'user', content: request.input },
      ];

      if (request.worldSelection) {
        const selected = request.worldSelection.directions.candidates.find(
          (c) => c.id === request.worldSelection?.candidateId,
        );
        messages[0]!.content += `\n\n## 作者在应用中选定的世界观方向\n${JSON.stringify(selected)}\n此选择由应用提供。只细化这个方向；其他候选未被选定。调用 propose_world_setting 生成结构化待审提案。`;
      }

      const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
      let step = 0;
      let finished = false;

      while (!finished) {
        if (signal.aborted) throw new CancelledError('任务已取消');
        if (step >= maxSteps) {
          throw new Error(`超过最大工具调用轮次（${maxSteps}），已停止以避免失控循环。`);
        }
        step += 1;

        this.setPhase('generating');
        this.updateStep('generate', 'running');
        yield emit({
          type: 'phase',
          phase: 'generating',
          detail: step === 1 ? '正在生成' : `第 ${step} 轮：继续处理`,
        });

        let assistantText = '';
        const toolCalls: ModelToolCall[] = [];
        let hadError: { message: string; retryable: boolean } | null = null;

        for await (const event of this.options.client.chat(messages, {
          ...(this.options.config.temperature !== undefined
            ? { temperature: this.options.config.temperature }
            : {}),
          ...(this.options.config.maxTokens !== undefined
            ? { maxTokens: this.options.config.maxTokens }
            : {}),
          ...(this.options.config.timeoutMs !== undefined
            ? { timeoutMs: this.options.config.timeoutMs }
            : {}),
          tools: this.toolSchemas(request.mode),
          toolChoice: 'auto',
          signal,
        })) {
          if (signal.aborted) throw new CancelledError('任务已取消');
          switch (event.type) {
            case 'text-delta':
              assistantText += event.text;
              yield emit({ type: 'text-delta', text: event.text });
              break;
            case 'tool-call':
              toolCalls.push(event.call);
              break;
            case 'usage':
              usage = {
                inputTokens: usage.inputTokens + event.inputTokens,
                outputTokens: usage.outputTokens + event.outputTokens,
              };
              yield emit({
                type: 'usage',
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              });
              break;
            case 'error':
              hadError = { message: event.message, retryable: event.retryable };
              break;
            case 'done':
              break;
          }
        }

        if (signal.aborted) throw new CancelledError('任务已取消');
        if (hadError) {
          // A model failure after successful proposal tools must not discard
          // validated changes. Preserve them for review without committing.
          if (pendingChanges.length > 0) {
            proposal = await this.buildProposal(
              '模型后续回复失败；已保留通过工具校验的待审核变更。',
              pendingChanges,
            );
            yield emit({ type: 'proposal', proposal });
          }
          this.setPhase('failed');
          yield emit({ type: 'error', message: hadError.message, retryable: hadError.retryable });
          yield emit({ type: 'done', status: 'failed' });
          return this.result('failed', assistantText, proposal, hadError.message, usage);
        }

        finalText = assistantText;

        if (toolCalls.length === 0) {
          finished = true;
          break;
        }

        messages.push({ role: 'assistant', content: assistantText, toolCalls });

        for (const call of toolCalls) {
          if (signal.aborted) throw new CancelledError('任务已取消');
          const startedAt = Date.now();
          const mutating = this.toolIsMutating(call.name);
          const view: ToolCallView = {
            id: call.id,
            name: call.name,
            arguments: safeParseJson(call.argumentsJson),
            status: 'running',
            mutating,
          };
          this.toolCalls.push(view);
          yield emit({ type: 'tool-start', call: { ...view } });

          this.setPhase('validating');
          const result = await dispatchTool(
            call.name,
            call.argumentsJson,
            {
              project: this.options.project,
              userInput: request.input,
              ...(request.worldSelection ? { worldSelection: request.worldSelection } : {}),
              indexer: this.options.indexer,
              pending: pendingChanges,
              ...(request.activeFilePath ? { activeFilePath: request.activeFilePath } : {}),
              ...(request.activeChapterOrder !== undefined
                ? { activeChapterOrder: request.activeChapterOrder }
                : {}),
              ...(request.selection ? { selection: request.selection } : {}),
              signal,
              ...(this.options.web ? { web: this.options.web } : {}),
            },
            request.mode,
          );

          const durationMs = Date.now() - startedAt;
          if (result.ok && result.outcome) {
            Object.assign(view, {
              status: 'done' as const,
              summary: result.outcome.summary,
              durationMs,
            });
            if (result.outcome.authorQuestion) {
              this.authorQuestion = result.outcome.authorQuestion;
              yield emit({ type: 'author-question', question: this.authorQuestion });
            }
            if (result.outcome.worldDirections) {
              this.worldDirections = result.outcome.worldDirections;
              yield emit({ type: 'world-directions', directions: this.worldDirections });
            }
            if (result.outcome.citations) {
              for (const citation of result.outcome.citations) {
                const webIndex = citation.sourceUrl
                  ? this.citations.findIndex(
                      (existing) => existing.sourceUrl === citation.sourceUrl,
                    )
                  : -1;
                if (webIndex >= 0) {
                  this.citations[webIndex] = citation;
                  continue;
                }
                if (
                  !this.citations.some(
                    (existing) =>
                      existing.filePath === citation.filePath &&
                      existing.excerpt === citation.excerpt,
                  )
                ) {
                  this.citations.push(citation);
                }
              }
              yield emit({
                type: 'citations',
                citations: this.citations.map((citation) => ({ ...citation })),
              });
            }
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify(result.outcome.data),
            });
            if (mutating) this.updateStep('propose', 'running');
          } else {
            Object.assign(view, {
              status: 'failed' as const,
              error: result.error ?? '未知错误',
              durationMs,
            });
            // Errors go back to the model as tool results so it can self-correct.
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ error: result.error ?? '工具执行失败' }),
            });
          }
          yield emit({ type: 'tool-end', call: { ...view } });
          if (this.authorQuestion || this.worldDirections) break;
        }
        if (this.authorQuestion) {
          finalText = this.authorQuestion.question;
          finished = true;
        }
        if (this.worldDirections) {
          finalText = '世界观方向已准备好，请在下方选择一个方向后再细化。尚未生成正式世界观文件。';
          finished = true;
        }
      }

      this.updateStep('generate', 'done');
      this.updateStep('retrieve', 'done');

      if (pendingChanges.length > 0) {
        this.setPhase('awaiting_review');
        this.updateStep('propose', 'done');
        yield emit({ type: 'phase', phase: 'awaiting_review', detail: '变更提案已生成，等待审核' });
        proposal = await this.buildProposal(finalText, pendingChanges);
        yield emit({ type: 'proposal', proposal });
      } else {
        this.updateStep('propose', 'skipped', '本次任务没有文件变更');
      }

      this.setPhase('completed');
      yield emit({ type: 'done', status: 'completed' });
      return this.result('completed', finalText, proposal, undefined, usage);
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) {
        this.setPhase('cancelled');
        yield emit({ type: 'done', status: 'cancelled' });
        return this.result('cancelled', finalText, proposal, '已取消', usage);
      }
      const message = describeError(error);
      this.setPhase('failed');
      yield emit({
        type: 'error',
        message,
        retryable: false,
        detail: error instanceof Error ? error.stack : undefined,
      });
      yield emit({ type: 'done', status: 'failed' });
      return this.result('failed', finalText, proposal, message, usage);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Returns a user-facing warning when `mode` needs a capability the model
   * lacks. Returning text (rather than silently downgrading) keeps the promise
   * that StoryCode never pretends a file change happened.
   */
  private checkCapabilities(mode: AgentMode): string | null {
    const capabilities = this.options.client.capabilities;
    if (!capabilities.supportsTools) {
      if (mode === 'ask') {
        return '当前模型不支持工具调用：本次只能进行对话式分析，无法读取或修改项目文件。';
      }
      return '当前模型不支持工具调用：无法生成文件变更提案，本次只会输出文字建议。请更换支持 Tool Calling 的模型。';
    }
    if (mode !== 'ask' && !capabilities.supportsStructuredOutput) {
      return null;
    }
    return null;
  }

  private toolSchemas(mode: AgentMode) {
    // Imported lazily-ish to keep the loop body readable.
    return toolsForModeSchemas(mode).filter(
      (tool) => this.options.web || !['web_search', 'web_fetch'].includes(tool.name),
    );
  }

  private toolIsMutating(name: string): boolean {
    return isMutatingToolName(name);
  }

  private setPhase(phase: AgentPhase): void {
    this.phase = phase;
  }

  private stepView(id: string): AgentPlanStepView {
    const step = this.steps.find((candidate) => candidate.id === id);
    return step ? { ...step } : { id, label: id, status: 'pending' };
  }

  private updateStep(id: string, status: AgentPlanStepView['status'], detail?: string): void {
    const step = this.steps.find((candidate) => candidate.id === id);
    if (!step) return;
    step.status = status;
    if (detail) step.detail = detail;
  }

  private async buildProposal(
    rationale: string,
    changes: ToolContext['pending'],
  ): Promise<ChangeProposal> {
    return this.options.proposals.create({
      title: inferProposalTitle(changes),
      rationale: rationale.trim().length > 0 ? rationale.trim() : '（模型未提供说明）',
      changes: changes.map((change) => ({
        operation: change.operation,
        filePath: change.filePath,
        nextContent: change.nextContent,
        summary: change.summary,
        kind: change.kind,
        ...(change.baseContentHash !== undefined
          ? { expectedBaseContentHash: change.baseContentHash }
          : {}),
        ...(change.dependsOnPaths ? { dependsOnPaths: change.dependsOnPaths } : {}),
        ...(change.dependencyContentHashes
          ? { dependencyContentHashes: change.dependencyContentHashes }
          : {}),
      })),
    });
  }

  private result(
    status: AgentRunResult['status'],
    finalText: string,
    proposal: ChangeProposal | null,
    error: string | undefined,
    usage: { inputTokens: number; outputTokens: number },
  ): AgentRunResult {
    return {
      status,
      finalText,
      proposal,
      worldDirections: this.worldDirections,
      authorQuestion: this.authorQuestion,
      ...(error ? { error } : {}),
      ...(this.capabilityWarning ? { capabilityWarning: this.capabilityWarning } : {}),
      steps: this.steps.map((step) => ({ ...step })),
      toolCalls: this.toolCalls.map((call) => ({ ...call })),
      citations: this.citations.map((citation) => ({ ...citation })),
      usage,
    };
  }
}

function buildPlan(mode: AgentMode): AgentPlanStepView[] {
  const steps: AgentPlanStepView[] = [
    { id: 'analyze', label: '理解需求', status: 'pending' },
    { id: 'retrieve', label: '检索项目上下文', status: 'pending' },
    { id: 'generate', label: mode === 'ask' ? '生成回答' : '生成内容', status: 'pending' },
  ];
  if (mode !== 'ask') {
    steps.push({ id: 'propose', label: '整理变更提案', status: 'pending' });
  }
  return steps;
}

function inferProposalTitle(changes: ToolContext['pending']): string {
  const created = changes.filter((change) => change.operation === 'create');
  const updated = changes.filter((change) => change.operation === 'update');
  const deleted = changes.filter((change) => change.operation === 'delete');
  if (created.length === 1 && updated.length === 0 && deleted.length === 0) {
    const kind = created[0]?.kind ?? 'other';
    const labels: Record<string, string> = {
      chapter: '新建章节',
      character: '新建角色卡',
      world: '新建世界观设定',
      plot: '新建剧情文件',
      other: '新建文件',
    };
    return labels[kind] ?? '新建文件';
  }
  const parts: string[] = [];
  if (created.length > 0) parts.push(`新建 ${created.length}`);
  if (updated.length > 0) parts.push(`修改 ${updated.length}`);
  if (deleted.length > 0) parts.push(`删除 ${deleted.length}`);
  return `文件变更（${parts.join('，')}）`;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Re-exported helpers kept at the bottom to avoid a circular import at module load.
import { toolsForMode } from '../tools/registry.js';

function toolsForModeSchemas(mode: AgentMode) {
  return toolsForMode(mode).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function isMutatingToolName(name: string): boolean {
  return name.startsWith('propose_');
}
