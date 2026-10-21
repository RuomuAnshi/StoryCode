import type { z } from 'zod';
import type { AuthorQuestion, Citation, WorldDirections, WorldSelection } from '@storycode/core';
import type { ProjectIndexer, ProjectStore } from '@storycode/storage';

/** A change the agent wants to make; committed only after author review. */
export interface PendingFileChange {
  operation: 'create' | 'update' | 'delete';
  filePath: string;
  nextContent: string;
  kind: 'chapter' | 'character' | 'world' | 'plot' | 'other';
  summary: string;
  baseContentHash?: string | null;
  dependsOnPaths?: string[];
  dependencyContentHashes?: Record<string, string>;
}

export interface WebResearchClient {
  search(query: string, limit: number): Promise<unknown>;
  fetch(url: string): Promise<unknown>;
}

export interface ToolContext {
  web?: WebResearchClient;
  project: ProjectStore;
  userInput?: string;
  worldSelection?: WorldSelection;
  indexer: ProjectIndexer;
  /** Mutable accumulator for proposals produced during this task. */
  pending: PendingFileChange[];
  /** Project-relative path of the file open in the editor, when known. */
  activeFilePath?: string;
  /** Text the author selected in the editor, when present. */
  selection?: { text: string; startLine: number; endLine: number };
  /** 1-based order of the chapter currently open, when known. */
  activeChapterOrder?: number;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  authorQuestion?: AuthorQuestion;
  worldDirections?: WorldDirections;
  /** JSON-serializable payload returned to the model. */
  data: unknown;
  /** Files the answer is grounded in; surfaced in the UI. */
  citations?: Citation[];
  /** Human-readable one-liner shown in the agent step list. */
  summary: string;
}

export interface ToolDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  /** JSON Schema for the model's function-calling contract. */
  parameters: Record<string, unknown>;
  schema: Schema;
  /** Mutating tools are highlighted in the UI and always go through review. */
  mutating: boolean;
  /** May be synchronous: pure in-memory lookups do not need a Promise. */
  execute: (args: z.infer<Schema>, context: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
}

/** Helper that keeps the args type and JSON schema in sync at definition site. */
export function defineTool<Schema extends z.ZodTypeAny>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition;
}
