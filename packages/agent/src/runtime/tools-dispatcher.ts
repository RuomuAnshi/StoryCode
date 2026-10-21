/**
 * Tool Dispatcher: validates model-supplied arguments against the tool's Zod
 * schema before executing. The model never gets to run anything unvalidated.
 */

import { StoryCodeError, describeError } from '@storycode/core';
import type { ToolDefinition } from '../tools/types.js';
import { findTool, toolsForMode } from '../tools/registry.js';
import type { ToolOutcome } from '../tools/types.js';

export interface DispatchResult {
  ok: boolean;
  outcome?: ToolOutcome;
  error?: string;
  tool: ToolDefinition;
}

export function resolveTool(name: string, mode: 'ask' | 'plan' | 'agent'): ToolDefinition {
  const allowed = toolsForMode(mode);
  const tool = findTool(name);
  if (!tool) {
    throw new StoryCodeError('VALIDATION_FAILED', `未知工具：${name}`);
  }
  if (!allowed.some((candidate) => candidate.name === name)) {
    throw new StoryCodeError(
      'PERMISSION_DENIED',
      `当前模式（${mode}）不允许调用写入类工具 ${name}，这是刻意的安全限制。`,
    );
  }
  return tool;
}

export async function dispatchTool(
  name: string,
  argumentsJson: string,
  context: Parameters<ToolDefinition['execute']>[1],
  mode: 'ask' | 'plan' | 'agent',
): Promise<DispatchResult> {
  let tool: ToolDefinition;
  try {
    tool = resolveTool(name, mode);
  } catch (error) {
    return {
      ok: false,
      error: describeError(error),
      tool: findTool(name) ?? ({ name } as ToolDefinition),
    };
  }

  let rawArgs: unknown;
  try {
    rawArgs = argumentsJson.trim().length === 0 ? {} : JSON.parse(argumentsJson);
  } catch {
    return { ok: false, error: `工具参数不是合法 JSON：${argumentsJson.slice(0, 200)}`, tool };
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `工具参数校验失败：${detail}`, tool };
  }

  try {
    const outcome = await tool.execute(parsed.data, context);
    return { ok: true, outcome, tool };
  } catch (error) {
    return { ok: false, error: describeError(error), tool };
  }
}
