import {
  CharacterCardSchema,
  CharacterRelationshipSchema,
  FactStatusSchema,
  RelationshipGraphSchema,
  isAuthoritativeFact,
  parseMarkdown,
  type RelationshipGraph,
} from '@storycode/core';
import type { ProjectStore } from '@storycode/storage';

export async function loadRelationshipGraph(
  project: ProjectStore,
  active?: { path: string; content: string },
): Promise<RelationshipGraph> {
  const graph: RelationshipGraph = { nodes: [], edges: [], warnings: [] };
  const characters = new Map<string, { name: string; filePath: string }>();
  const ambiguous = new Set<string>();
  const files = (await project.listFiles())
    .filter((file) => file.path.endsWith('.md'))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files.filter((file) => file.path.startsWith('characters/'))) {
    try {
      const parsed = CharacterCardSchema.parse(
        parseMarkdown(await project.readFile(file.path)).frontmatter,
      );
      if (characters.has(parsed.id)) {
        ambiguous.add(parsed.id);
        graph.warnings.push(`人物 ID 重复：${parsed.id}，请检查人物文件。`);
      } else characters.set(parsed.id, { name: parsed.name, filePath: file.path });
    } catch {
      graph.warnings.push(`无法读取人物文件：${file.path}，请检查元数据。`);
    }
  }
  const relationSchema = CharacterRelationshipSchema.extend({
    factStatus: FactStatusSchema.optional(),
  });
  for (const file of files.filter((file) => file.path.startsWith('plot/relationships/'))) {
    try {
      const raw = active?.path === file.path ? active.content : await project.readFile(file.path);
      const { factStatus, ...relation } = relationSchema.parse(parseMarkdown(raw).frontmatter);
      const displayStatus =
        factStatus === 'rejected' || factStatus === 'superseded'
          ? factStatus
          : relation.status === 'confirmed' && (!factStatus || isAuthoritativeFact(factStatus))
            ? 'confirmed'
            : 'proposed';
      graph.edges.push({ ...relation, filePath: file.path, displayStatus });
    } catch {
      graph.warnings.push(`无法读取关系文件：${file.path}，请查看原文并检查元数据。`);
    }
  }
  const duplicateIds = new Set(
    graph.edges
      .filter((edge, i, edges) => edges.findIndex((other) => other.id === edge.id) !== i)
      .map((edge) => edge.id),
  );
  for (const id of duplicateIds) graph.warnings.push(`关系 ID 重复：${id}，已从图中排除。`);
  graph.edges = graph.edges.filter((edge) => !duplicateIds.has(edge.id));
  const ids = new Set(
    graph.edges.flatMap((edge) => [edge.sourceCharacterId, edge.targetCharacterId]),
  );
  for (const id of [...ids].sort()) {
    const character = !ambiguous.has(id) ? characters.get(id) : undefined;
    graph.nodes.push({
      id,
      name: character?.name ?? id,
      ...(character ? { filePath: character.filePath } : {}),
      missing: !character,
    });
    if (!character) graph.warnings.push(`人物 ${id} 缺失或 ID 不唯一，暂以 ID 显示。`);
  }
  return RelationshipGraphSchema.parse(graph);
}
