import { CharacterFactSchema } from './schemas/character-design.js';
import { isAuthoritativeFact } from './schemas/common.js';
import { parseMarkdown } from './markdown.js';

/** Indexes established facts only; draft details remain accessible with provenance via get_character. */
export function characterRetrievalText(source: string): string {
  const parsed = parseMarkdown(source);
  if (!Array.isArray(parsed.frontmatter.facts)) {
    return '人物设定尚无逐字段来源记录；请读取原文件核对，不可假定为已确认事实。';
  }
  const lines: string[] = ['以下仅包含作者明确提供或正文已确立的设定：'];
  for (const raw of parsed.frontmatter.facts) {
    const fact = CharacterFactSchema.safeParse(raw);
    if (!fact.success || !isAuthoritativeFact(fact.data.status)) continue;
    lines.push(`${fact.data.predicate}: ${fact.data.value} [${fact.data.status}]`);
  }
  return lines.join('\n');
}
