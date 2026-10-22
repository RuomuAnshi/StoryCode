import {
  CharacterCardSchema,
  CharacterRelationshipSchema,
  WorldSettingSchema,
  parseMarkdown,
} from '@storycode/core';

/** Validate human source edits without reserializing or stripping unknown fields. */
export function validateManualMarkdown(
  path: string,
  source: string,
  previous: string | null,
): void {
  const parsed = parseMarkdown(source);
  if (/^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(source) && !parsed.hasFrontmatter)
    throw new Error('YAML 元数据缺少结束分隔线（---），请补齐后保存。');
  let hadMetadata = false;
  try {
    hadMetadata = previous !== null && parseMarkdown(previous).hasFrontmatter;
  } catch {
    /* A broken existing file must remain repairable. */
  }
  const schema = path.startsWith('characters/')
    ? CharacterCardSchema
    : path.startsWith('plot/relationships/')
      ? CharacterRelationshipSchema
      : path.startsWith('world/') && (parsed.hasFrontmatter || hadMetadata)
        ? WorldSettingSchema
        : null;
  if (schema) {
    const result = schema.safeParse(parsed.frontmatter);
    if (!result.success)
      throw new Error(
        `元数据校验失败：${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；')}`,
      );
  }
}
