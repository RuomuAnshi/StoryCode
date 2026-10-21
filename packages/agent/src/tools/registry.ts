import type { ToolDefinition } from './types.js';
import { FILE_TOOLS } from './file-tools.js';
import {
  proposeCharacterCardsTool,
  proposeCharacterUpdateTool,
  getRelationshipsTool,
} from './character-tools.js';
import {
  proposeWorldDirectionsTool,
  proposeWorldSettingTool,
  proposeWorldUpdateTool,
} from './world-tools.js';
import { WEB_TOOLS } from './web-tools.js';
import { askUserTool } from './question-tool.js';
import { STORY_TOOLS } from './story-tools.js';

/**
 * The full tool surface exposed to the model.
 * Read-only tools are available in every mode; mutating tools are hidden from
 * Ask mode so an "explain" request can never touch files.
 */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  ...WEB_TOOLS,
  askUserTool,
  ...FILE_TOOLS,
  ...STORY_TOOLS,
  proposeCharacterCardsTool,
  proposeCharacterUpdateTool,
  getRelationshipsTool,
  proposeWorldDirectionsTool,
  proposeWorldSettingTool,
  proposeWorldUpdateTool,
];

export function toolsForMode(mode: 'ask' | 'plan' | 'agent'): readonly ToolDefinition[] {
  if (mode === 'ask') return ALL_TOOLS.filter((tool) => !tool.mutating);
  return ALL_TOOLS;
}

export function findTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}

/** JSON-schema tool descriptors for the provider request. */
export function toolSchemasForMode(
  mode: 'ask' | 'plan' | 'agent',
): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return toolsForMode(mode).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export * from './types.js';
