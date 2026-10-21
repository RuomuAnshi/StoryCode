import {
  WorldSettingSchema,
  createId,
  type ContinuityIssue,
  type WorldSetting,
} from '@storycode/core';

export interface WorldValidationResult {
  valid: boolean;
  issues: ContinuityIssue[];
  setting?: WorldSetting;
}

export function validateWorldSetting(input: unknown): WorldValidationResult {
  const parsed = WorldSettingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((zIssue) => ({
        id: createId('issue'),
        severity: 'error' as const,
        category: 'world-schema',
        description: `${zIssue.path.join('.') || '(root)'}: ${zIssue.message}`,
        evidence: [],
        suggestedFix: '修正字段结构后重试',
      })),
    };
  }

  const setting = parsed.data;
  const issues: ContinuityIssue[] = [];

  if (setting.genre.length === 0) {
    issues.push({
      id: createId('issue'),
      severity: 'warning',
      category: 'world-schema',
      description: '世界观没有标注题材',
      evidence: [],
      suggestedFix: '补充 genre，例如 ["校园悬疑", "奇幻"]',
    });
  }

  // Duplicate entity names within the same collection create ambiguity.
  const checkDuplicates = (label: string, names: readonly string[]): void => {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) {
        issues.push({
          id: createId('issue'),
          severity: 'error',
          category: 'world-schema',
          description: `${label}中存在重名实体：${name}`,
          evidence: [],
          suggestedFix: '合并或重命名其中一个条目',
        });
      }
      seen.add(name);
    }
  };
  checkDuplicates(
    '组织',
    setting.institutions.map((entity) => entity.name),
  );
  checkDuplicates(
    '阵营',
    setting.factions.map((entity) => entity.name),
  );

  if (setting.rules.length === 0) {
    issues.push({
      id: createId('issue'),
      severity: 'info',
      category: 'world-schema',
      description: '尚未定义任何世界规则',
      evidence: [],
      suggestedFix: '可以在写作过程中逐步补充，不必一次成型',
    });
  }

  return { valid: true, issues, setting };
}
