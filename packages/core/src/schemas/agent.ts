import { WebUrlSchema } from './web-research.js';
import { z } from 'zod';

/** Agent lifecycle from the spec, used to drive the UI status line. */
export const AgentPhaseSchema = z.enum([
  'idle',
  'planning',
  'retrieving',
  'generating',
  'validating',
  'awaiting_review',
  'committing',
  'completed',
  'failed',
  'cancelled',
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const ChatRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Raw JSON string as produced by the model; validated by the dispatcher. */
  argumentsJson: z.string().default('{}'),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  ok: z.boolean(),
  /** JSON-serialized payload returned to the model. */
  content: z.string(),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const CitationSchema = z.object({
  sourceUrl: WebUrlSchema.optional(),
  filePath: z.string().min(1),
  title: z.string().default(''),
  excerpt: z.string().default(''),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const AgentPlanStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
});
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string().default(''),
  createdAt: z.string().min(1),
  /** Model reasoning/tool-call trace rendered as collapsed detail. */
  toolCalls: z.array(ToolCallSchema).default([]),
  toolResults: z.array(ToolResultSchema).default([]),
  citations: z.array(CitationSchema).default([]),
  plan: z.array(AgentPlanStepSchema).default([]),
  proposalId: z.string().optional(),
  error: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().default('新对话'),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  messages: z.array(ChatMessageSchema).default([]),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const AgentModeSchema = z.enum(['ask', 'plan', 'agent']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const ModelConfigSchema = z.object({
  providerId: z.string().min(1).default('openai-compatible'),
  baseUrl: z.string().min(1).default('https://api.openai.com/v1'),
  model: z.string().min(1).default('gpt-4o-mini'),
  temperature: z.number().min(0).max(2).default(0.8),
  maxTokens: z.number().int().positive().max(200000).default(4096),
  contextLimit: z.number().int().positive().max(2000000).default(128000),
  timeoutMs: z.number().int().positive().max(600000).default(120000),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
