/**
 * In-process search index.
 *
 * The spec asks for SQLite FTS5 with Chinese n-gram support. This module is the
 * retrieval primitive both backends share: it tokenizes CJK with character
 * bigrams, keeps per-document token frequencies, and returns results with the
 * exact source path and line offsets so the UI can show provenance.
 *
 * It is deliberately synchronous and dependency-free so it can back the browser
 * preview as well as the desktop app; the SQLite layer (Phase 6) will reuse the
 * same tokenizer and ranking rules.
 */

import { tokenizeForSearch } from '@storycode/core';

export interface SearchDoc {
  /** Project-relative path; the citation the user sees. */
  path: string;
  title: string;
  /** Document kind, used to weight results (chapters > plot notes). */
  kind: 'chapter' | 'character' | 'world' | 'plot' | 'other';
  content: string;
  updatedAt?: string;
}

export interface SearchHit {
  path: string;
  title: string;
  kind: SearchDoc['kind'];
  score: number;
  /** Snippet centred on the first match. */
  snippet: string;
  /** 0-based line offsets of matches within the document. */
  startLine: number;
  endLine: number;
  matchedTerms: string[];
}

interface IndexedDoc {
  doc: SearchDoc;
  titleTokens: Map<string, number>;
  bodyTokens: Map<string, number>;
  /** Lowercased content, cached for snippet extraction. */
  lowerContent: string;
}

const KIND_WEIGHT: Record<SearchDoc['kind'], number> = {
  chapter: 1.4,
  character: 1.2,
  world: 1.1,
  plot: 1.0,
  other: 0.9,
};

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

export class SearchIndex {
  private docs = new Map<string, IndexedDoc>();

  get size(): number {
    return this.docs.size;
  }

  put(doc: SearchDoc): void {
    this.docs.set(doc.path, {
      doc,
      titleTokens: termFrequencies(tokenizeForSearch(doc.title)),
      bodyTokens: termFrequencies(tokenizeForSearch(doc.content)),
      lowerContent: doc.content.toLowerCase(),
    });
  }

  putAll(docs: readonly SearchDoc[]): void {
    for (const doc of docs) this.put(doc);
  }

  remove(path: string): void {
    this.docs.delete(path);
  }

  clear(): void {
    this.docs.clear();
  }

  paths(): string[] {
    return [...this.docs.keys()].sort();
  }

  /**
   * Ranks documents with a BM25-like score over CJK bigrams and Latin words.
   * Returns an empty array for empty queries; the caller must tell the model
   * "no results" rather than letting it invent content.
   */
  search(query: string, options: { limit?: number; kind?: SearchDoc['kind'] } = {}): SearchHit[] {
    const queryTokens = [...new Set(tokenizeForSearch(query))];
    if (queryTokens.length === 0) return [];

    const totalDocs = this.docs.size;
    const averageLength =
      totalDocs === 0
        ? 1
        : [...this.docs.values()].reduce(
            (sum, entry) => sum + documentLength(entry.bodyTokens),
            0,
          ) / totalDocs;

    // Document frequency per query term (for IDF).
    const df = new Map<string, number>();
    for (const token of queryTokens) {
      let count = 0;
      for (const entry of this.docs.values()) {
        if (entry.bodyTokens.has(token) || entry.titleTokens.has(token)) count += 1;
      }
      df.set(token, count);
    }

    const hits: SearchHit[] = [];
    const k1 = 1.2;
    const b = 0.75;

    for (const entry of this.docs.values()) {
      if (options.kind && entry.doc.kind !== options.kind) continue;
      const docLength = documentLength(entry.bodyTokens);
      let score = 0;
      const matchedTerms: string[] = [];
      let strongMatches = 0;

      for (const token of queryTokens) {
        const tfBody = entry.bodyTokens.get(token) ?? 0;
        const tfTitle = entry.titleTokens.get(token) ?? 0;
        if (tfBody === 0 && tfTitle === 0) continue;
        matchedTerms.push(token);
        // Unigrams of a multi-character CJK run (e.g. 的, 了) are weak evidence:
        // they are what make a nonsense query look like a match.
        if (token.length > 1) strongMatches += 1;
        const docFreq = df.get(token) ?? 0;
        const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
        const bodyScore =
          (tfBody * (k1 + 1)) / (tfBody + k1 * (1 - b + (b * docLength) / averageLength));
        // Title matches are a strong relevance signal.
        const titleScore = tfTitle * 3;
        score += idf * (bodyScore + titleScore);
      }

      if (matchedTerms.length === 0) continue;
      // A multi-character query must be supported by at least one multi-character
      // match. Otherwise "不存在的词" would "hit" every file containing 的, and the
      // model would be handed irrelevant context instead of being told there is
      // no result.
      const queryHasTerms = queryTokens.some((token) => token.length > 1);
      if (queryHasTerms && strongMatches === 0) continue;
      // Reward covering more of the query, not just repeating one term.
      const coverage = matchedTerms.length / queryTokens.length;
      score *= 0.5 + coverage * 0.5;
      score *= KIND_WEIGHT[entry.doc.kind];

      const located = locateSnippet(entry, matchedTerms);
      hits.push({
        path: entry.doc.path,
        title: entry.doc.title,
        kind: entry.doc.kind,
        score,
        snippet: located.snippet,
        startLine: located.startLine,
        endLine: located.endLine,
        matchedTerms,
      });
    }

    return hits.sort((a, b2) => b2.score - a.score).slice(0, options.limit ?? 20);
  }
}

function documentLength(tokens: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of tokens.values()) total += count;
  return total || 1;
}

const CONTEXT_LINES = 3;

/**
 * Picks the passage shown to the model and in the citation chip.
 *
 * A heading match alone is a poor snippet: the author wants the prose. Lines
 * that are just headings are therefore down-weighted, and every match is shown
 * with a few lines of surrounding context.
 */
function locateSnippet(
  entry: IndexedDoc,
  matchedTerms: readonly string[],
): { snippet: string; startLine: number; endLine: number } {
  const lines = entry.doc.content.split('\n');
  let bestLine = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').trim();
    const lower = raw.toLowerCase();
    let matches = 0;
    for (const term of matchedTerms) {
      if (lower.includes(term)) matches += 1;
    }
    if (matches === 0) continue;
    const isHeading = /^#{1,6}\s/.test(raw) || raw === entry.doc.title;
    // Still eligible, but only when nothing in the prose matches.
    const score = isHeading ? matches * 0.5 : matches;
    if (score > bestScore) {
      bestScore = score;
      bestLine = i;
    }
  }
  const start = Math.max(0, bestLine - CONTEXT_LINES);
  const end = Math.min(lines.length - 1, bestLine + CONTEXT_LINES);
  const snippet = lines
    .slice(start, end + 1)
    .join('\n')
    .slice(0, 800);
  return { snippet: snippet.trim(), startLine: start + 1, endLine: end + 1 };
}
