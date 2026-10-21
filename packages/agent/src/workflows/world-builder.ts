import {
  CharacterCardSchema,
  CharacterFactSchema,
  WorldDirectionsSchema,
  WorldSelectionSchema,
  WorldSettingSchema,
  WorldDesignSchema,
  type WorldUpdate,
  type WorldSetting,
  StoryCodeError,
  VersionConflictError,
  contentHash,
  createId,
  isAuthoritativeFact,
  parseMarkdown,
  serializeMarkdown,
  type WorldDirections,
  type WorldDirectionsInput,
  type WorldDesign,
  type WorldSelection,
} from '@storycode/core';
import { validateWorldSetting } from '@storycode/validation';
import type { ToolContext, PendingFileChange } from '../tools/types.js';

function invalid(message: string): never {
  throw new StoryCodeError('VALIDATION_FAILED', message);
}
export async function proposeWorldDirections(
  input: WorldDirectionsInput,
  context: ToolContext,
): Promise<WorldDirections> {
  if (await context.project.exists('world/overview.md'))
    invalid('已有世界观概述；本轮仅支持新世界观的方向选择，不能覆盖现有设定。');
  if (new Set(input.characterIds).size !== input.characterIds.length) invalid('角色 ID 不可重复。');
  const files = (await context.project.listFiles()).filter(
    (f) => f.path.startsWith('characters/') && f.path.endsWith('.md'),
  );
  const characters: WorldDirections['characters'] = [];
  for (const file of files) {
    const raw = await context.project.readFile(file.path);
    const parsed = parseMarkdown(raw);
    const card = CharacterCardSchema.parse(parsed.frontmatter);
    if (!input.characterIds.includes(card.id)) continue;
    const facts = Array.isArray(parsed.frontmatter.facts) ? parsed.frontmatter.facts : [];
    if (
      card.status !== 'confirmed' &&
      !facts.some((rawFact) => {
        const fact = CharacterFactSchema.safeParse(rawFact);
        return fact.success && isAuthoritativeFact(fact.data.status);
      })
    ) {
      invalid(`角色 ${card.name} 没有已确认的设定，请先审核来源。`);
    }
    characters.push({ id: card.id, name: card.name, path: file.path, hash: contentHash(raw) });
  }
  if (characters.length !== input.characterIds.length)
    invalid('世界观引用了不存在或重复的角色 ID。');
  if (
    input.mode === 'existing' &&
    (!input.existingWorld ||
      !input.sourceQuote ||
      !(context.userInput ?? '').includes(input.sourceQuote) ||
      !input.sourceQuote.includes(input.existingWorld))
  )
    invalid('既有世界观名称必须有本轮作者原话，不可由 AI 自行指定。');
  const candidates = input.candidates.map((c) => ({ ...c, status: 'draft' as const }));
  if (
    new Set(candidates.map((c) => c.id)).size !== candidates.length ||
    new Set(candidates.map((c) => c.title.trim())).size !== candidates.length ||
    new Set(candidates.map((c) => c.coreConflict.trim())).size !== candidates.length
  )
    invalid('世界观候选的 ID、标题和核心矛盾必须有明显区别，不可重复。');
  return WorldDirectionsSchema.parse({
    id: createId('proposal'),
    projectId: context.project.projectMeta.id,
    projectRoot: context.project.root,
    mode: input.mode,
    ...(input.existingWorld ? { existingWorld: input.existingWorld } : {}),
    ...(input.sourceQuote ? { sourceQuote: input.sourceQuote } : {}),
    characters,
    candidates,
  });
}
export function validateWorldSelection(
  selection: WorldSelection,
  context: Pick<ToolContext, 'project'>,
): WorldSelection {
  const parsed = WorldSelectionSchema.parse(selection);
  if (
    parsed.directions.projectId !== context.project.projectMeta.id ||
    parsed.directions.projectRoot !== context.project.root
  )
    invalid('世界观候选属于其他项目，不能在当前项目使用。');
  if (!parsed.directions.candidates.some((c) => c.id === parsed.candidateId))
    invalid('作者选择的世界观方向不存在，请重新选择。');
  return parsed;
}
export async function refineWorld(
  design: WorldDesign,
  context: ToolContext,
): Promise<PendingFileChange> {
  if (!context.worldSelection)
    invalid('尚未由作者在应用中选择世界观方向。请先提出候选，再等待作者点击选择。');
  const selection = validateWorldSelection(context.worldSelection, context);
  const candidate = selection.directions.candidates.find((c) => c.id === selection.candidateId)!;
  for (const character of selection.directions.characters) {
    const hash = await context.project.fileHash(character.path);
    if (hash !== character.hash)
      throw new VersionConflictError(character.path, character.hash, hash);
  }
  if (
    (await context.project.exists('world/overview.md')) ||
    context.pending.some((c) => c.filePath === 'world/overview.md')
  )
    invalid('世界观概述已存在或已在本轮提案中，不能重复生成或覆盖。');
  const setting = WorldDesignSchema.parse(design).setting;
  setting.status = 'draft';
  if (
    setting.title !== candidate.title ||
    (setting.era && setting.era !== candidate.era) ||
    (setting.genre.length && JSON.stringify(setting.genre) !== JSON.stringify(candidate.genre))
  )
    invalid('细化结果的标题、时代、题材必须与作者所选方向一致，不能混入其他候选。');
  setting.era = candidate.era;
  setting.genre = [...candidate.genre];
  if (
    setting.confirmedFacts.length ||
    [...setting.institutions, ...setting.factions, ...setting.rules].some((e) => e.factIds.length)
  )
    invalid('AI 生成的世界观细节不能自动写成已确认事实或伪造事实 ID。');
  const structuralErrors = validateWorldSetting(setting).issues.filter(
    (issue) => issue.severity === 'error',
  );
  if (structuralErrors.length)
    invalid(structuralErrors.map((issue) => issue.description).join('；'));
  const entityIds = [
    ...setting.institutions,
    ...setting.factions,
    ...setting.rules,
    ...setting.history,
  ].map((e) => e.id);
  if (new Set(entityIds).size !== entityIds.length)
    invalid('世界观组织、规则、历史的实体 ID 不可重复。');
  const known = new Set([...entityIds, ...selection.directions.characters.map((c) => c.id)]);
  if (setting.history.some((event) => event.relatedEntities.some((id) => !known.has(id))))
    invalid('历史事件引用了不存在的实体 ID。');
  const lines = [
    `# ${setting.title}`,
    '',
    '作者已选择此方向；以下新增细节仍为 AI 建议，接受文件提案不代表逐项确认。',
    '',
    `- 方向：${candidate.title}`,
    `- 题材：${setting.genre.join('、')}`,
    `- 时代：${setting.era}`,
    `- 核心矛盾：${candidate.coreConflict}`,
    `- 人物适配：${candidate.characterFit}`,
    '',
    `## 前提\n\n${candidate.premise}`,
  ];
  if (selection.directions.mode === 'existing')
    lines.push(
      '',
      `既有世界观：${selection.directions.existingWorld ?? ''}。仅以作者与项目资料为准，未提供的原作细节尚未核实。`,
    );
  const bullets = (title: string, items: string[]) => {
    if (items.length) lines.push('', `## ${title}`, '', ...items.map((t) => `- ${t}`));
  };
  bullets('主题', setting.themes);
  bullets('基调', setting.tone);
  if (setting.location) bullets('地点', [setting.location]);
  bullets(
    '组织',
    setting.institutions.map((e) => `${e.name}：${e.description}`),
  );
  bullets(
    '阵营',
    setting.factions.map((e) => `${e.name}：${e.description}`),
  );
  bullets(
    '规则',
    setting.rules.map(
      (e) => `${e.description}${e.exceptions.length ? `；例外：${e.exceptions.join('、')}` : ''}`,
    ),
  );
  bullets(
    '历史',
    setting.history.map((e) => `${e.title}：${e.description}`),
  );
  bullets('社会冲突', setting.socialConflicts);
  bullets('待确认问题', setting.unresolvedQuestions);
  bullets(
    '关联人物',
    selection.directions.characters.map((c) => `${c.name}（${c.id}）`),
  );
  return {
    operation: 'create',
    filePath: 'world/overview.md',
    kind: 'world',
    summary: `细化所选世界观：${candidate.title}（新增细节待确认）`,
    baseContentHash: null,
    dependsOnPaths: selection.directions.characters.map((c) => c.path),
    dependencyContentHashes: Object.fromEntries(
      selection.directions.characters.map((c) => [c.path, c.hash]),
    ),
    nextContent: serializeMarkdown(
      {
        ...setting,
        type: 'world',
        factStatus: 'ai_proposed',
        selectedDirectionId: candidate.id,
        selectedDirection: candidate,
        worldMode: selection.directions.mode,
        ...(selection.directions.existingWorld
          ? {
              existingWorld: selection.directions.existingWorld,
              existingWorldQuote: selection.directions.sourceQuote,
            }
          : {}),
        characterIds: selection.directions.characters.map((c) => c.id),
        relatedFiles: selection.directions.characters.map((c) => c.path),
      },
      lines.join('\n') + '\n',
    ),
  };
}

/** Update only generated, unconfirmed list sections; never reconstruct the whole body. */
export async function updateWorld(
  input: WorldUpdate,
  context: ToolContext,
): Promise<PendingFileChange> {
  const path = 'world/overview.md';
  if (context.pending.some((change) => change.filePath === path))
    invalid('本轮已有世界观提案，请先审核后再修改。');
  const raw = await context.project.readFile(path);
  const parsed = parseMarkdown(raw);
  const setting = WorldSettingSchema.parse(parsed.frontmatter);
  if (
    setting.status !== 'draft' ||
    parsed.frontmatter.factStatus !== 'ai_proposed' ||
    setting.confirmedFacts.length
  )
    invalid('当前工具只更新未确认的世界观建议；已确认或来源不明的设定需要逐项冲突审核。');
  const labels = {
    themes: '主题',
    tone: '基调',
    unresolvedQuestions: '待确认问题',
    socialConflicts: '社会冲突',
    institutions: '组织',
    factions: '阵营',
    rules: '规则',
    history: '历史',
  };
  const updated = WorldSettingSchema.parse({ ...setting, [input.field]: input.values });
  if (['institutions', 'factions', 'rules'].includes(input.field)) {
    const sourceEntities =
      input.field === 'institutions'
        ? setting.institutions
        : input.field === 'factions'
          ? setting.factions
          : setting.rules;
    if (sourceEntities.some((entity) => entity.factIds.length))
      invalid('该区块包含有来源的事实，不能通过草稿更新覆盖。');
  }
  const ids = [
    ...updated.institutions,
    ...updated.factions,
    ...updated.rules,
    ...updated.history,
  ].map((entity) => entity.id);
  if (new Set(ids).size !== ids.length) invalid('世界观实体 ID 不可重复。');
  const charIds: unknown = parsed.frontmatter.characterIds;
  const known = new Set([
    ...ids,
    ...(Array.isArray(charIds) ? charIds.filter((id): id is string => typeof id === 'string') : []),
  ]);
  if (updated.history.some((event) => event.relatedEntities.some((id) => !known.has(id))))
    invalid('更新后历史事件将引用不存在的实体，请先处理相关历史。');
  const errors = validateWorldSetting(updated).issues.filter((issue) => issue.severity === 'error');
  if (errors.length) invalid(errors.map((issue) => issue.description).join('；'));
  const render = (value: WorldSetting): string[] => {
    switch (input.field) {
      case 'institutions':
        return value.institutions.map((entity) => `${entity.name}：${entity.description}`);
      case 'factions':
        return value.factions.map((entity) => `${entity.name}：${entity.description}`);
      case 'rules':
        return value.rules.map(
          (rule) =>
            `${rule.description}${rule.exceptions.length ? `；例外：${rule.exceptions.join('、')}` : ''}`,
        );
      case 'history':
        return value.history.map((event) => `${event.title}：${event.description}`);
      default:
        return value[input.field];
    }
  };
  const heading = `## ${labels[input.field]}`;
  const previous = setting[input.field];
  const section = (values: string[]) =>
    `${heading}\n\n${values.map((value) => `- ${value}`).join('\n')}\n`;
  const headingPattern = new RegExp(`^${heading}\\s*$`, 'gm');
  const matches = [...parsed.body.matchAll(headingPattern)];
  let body = parsed.body;
  if (matches.length > 1) invalid('对应正文区块出现多次，请作者先整理后重试。');
  if (matches.length === 1) {
    const start = matches[0]!.index;
    const tail = body.slice(start);
    const next = tail.indexOf('\n## ', heading.length);
    const end = next < 0 ? body.length : start + next + 1;
    const actual = body.slice(start, end);
    if (actual.trimEnd() !== section(render(setting)).trimEnd())
      invalid('对应世界观正文已由作者编辑，与元数据不一致；为保护原文已停止更新。');
    body = body.slice(0, start) + section(render(updated)) + '\n' + body.slice(end);
  } else {
    if (previous.length) invalid('对应世界观正文区块缺失，无法安全更新。');
    body = body.trimEnd() + '\n\n' + section(render(updated));
  }
  if (JSON.stringify(previous) === JSON.stringify(input.values)) invalid('字段没有变化。');
  const history: unknown = parsed.frontmatter.worldRevisionHistory;
  if (history !== undefined && !Array.isArray(history)) invalid('世界观修改记录格式无效。');
  const previousRevisions: unknown[] = Array.isArray(history) ? history : [];
  return {
    operation: 'update',
    filePath: path,
    kind: 'world',
    summary: `更新世界观${labels[input.field]}（仍为 AI 建议；保留旧值记录）`,
    baseContentHash: contentHash(raw),
    nextContent: serializeMarkdown(
      {
        ...parsed.frontmatter,
        [input.field]: input.values,
        worldRevisionHistory: [
          ...previousRevisions,
          {
            field: input.field,
            previous,
            next: input.values,
            status: 'ai_proposed',
            requestedBy: context.userInput ?? '',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      body,
    ),
  };
}
