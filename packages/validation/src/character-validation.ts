import {
  CharacterCardSchema,
  type CharacterCard,
  type ContinuityIssue,
  createId,
} from '@storycode/core';

export interface StructuralValidationResult {
  valid: boolean;
  issues: ContinuityIssue[];
  /** Normalized card with defaults applied, when valid. */
  card?: CharacterCard;
}

function issue(
  description: string,
  suggestion: string,
  severity: ContinuityIssue['severity'] = 'warning',
): ContinuityIssue {
  return {
    id: createId('issue'),
    severity,
    category: 'character-schema',
    description,
    evidence: [],
    suggestedFix: suggestion,
  };
}

/**
 * Validates a character card structurally (schema) and semantically (internal
 * consistency the schema cannot express). Semantic findings are warnings: the
 * spec forbids presenting AI guesses as authorial errors.
 */
export function validateCharacterCard(input: unknown): StructuralValidationResult {
  const parsed = CharacterCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((zIssue) =>
        issue(
          `${zIssue.path.join('.') || '(root)'}: ${zIssue.message}`,
          '修正字段结构后重试',
          'error',
        ),
      ),
    };
  }

  const card = parsed.data;
  const issues: ContinuityIssue[] = [];

  if (card.name.trim().length === 0) {
    issues.push(issue('角色缺少姓名', '补充 name 字段', 'error'));
  }
  if (card.narrative.goals.length === 0 && card.narrative.motivations.length === 0) {
    issues.push(issue('该角色还没有目标或动机', '可以在后续对话中补充，不必现在填满'));
  }
  if (card.personality.flaws.length === 0) {
    issues.push(issue('该角色还没有明显缺陷', '考虑补充至少一个性格缺陷，人物会更立体'));
  }
  if (card.aliases.includes(card.name)) {
    issues.push(issue('别名与姓名重复', '移除重复的别名', 'error'));
  }
  // Contradictions are a feature, not a bug: flag only a literal self-conflict.
  const traits = new Set(card.personality.traits.map((trait) => trait.trim()));
  for (const strength of card.personality.strengths) {
    if (traits.has(strength) && card.personality.flaws.includes(strength)) {
      issues.push(
        issue(`"${strength}" 同时被列为优点和缺陷`, '明确它在故事中的具体表现，或拆成两条描述'),
      );
    }
  }

  return { valid: true, issues, card };
}
