/**
 * Editor state: the open document buffer, selection, save status.
 *
 * The buffer is the source of truth for the editor pane. `content` always holds
 * the current Markdown; autosave persists it through the ProjectStore, which
 * version-gates on the hash captured when the document was loaded.
 */

import { create } from 'zustand';
import {
  chapterOrderFromPath,
  countWords,
  contentHash,
  isProtectedPath,
  parseChapterDocument,
  serializeChapterDocument,
  type ChapterMeta,
} from '@storycode/core';
import { describeError } from '@storycode/core';
import { validateManualMarkdown } from '../features/editor/validate-manual-markdown';
import { useWorkspace } from './workspace-store.js';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface OpenDocument {
  /** Project-relative path, e.g. `chapters/001.md`. */
  path: string;
  /** Markdown body without frontmatter. */
  body: string;
  /** Frontmatter, kept in sync with the title/order the UI shows. */
  meta: ChapterMeta;
  /** Hash of the file content as loaded, used to detect outside edits. */
  baselineHash: string;
  /** Whether this document is a chapter (vs. a setting file). */
  kind: 'chapter' | 'other';
}

export interface SaveConflict {
  path: string;
  message: string;
}

interface EditorState {
  document: OpenDocument | null;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  saveError: string | null;
  conflict: SaveConflict | null;
  wordCount: number;

  openFile(path: string, options?: { discardChanges?: boolean }): Promise<void>;
  updateBody(body: string): void;
  updateTitle(title: string): void;
  save(options?: { force?: boolean }): Promise<void>;
  reset(): void;
  dismissConflict(): void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 900;
let savingInFlight = false;
let loadSequence = 0;

function clearAutosave(): void {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  document: null,
  saveStatus: 'saved',
  lastSavedAt: null,
  saveError: null,
  conflict: null,
  wordCount: 0,

  async openFile(path, options) {
    const project = useWorkspace.getState().project;
    if (!project) return;
    if (savingInFlight) return;
    clearAutosave();
    // Switching never silently discards an invalid buffer or forces a conflict.
    if (!options?.discardChanges && ['dirty', 'error'].includes(get().saveStatus)) {
      await get().save();
      if (get().saveStatus !== 'saved') return;
    }
    const sequence = ++loadSequence;

    try {
      const source = await project.store.readFile(path);
      const baselineHash = contentHash(source);
      if (sequence !== loadSequence || useWorkspace.getState().project !== project) return;
      let document: OpenDocument;
      if (path.startsWith('chapters/')) {
        const fallbackOrder = chapterOrderFromPath(path) ?? 1;
        const chapter = parseChapterDocument(path, source, fallbackOrder);
        document = {
          path,
          body: chapter.body,
          meta: chapter.meta,
          baselineHash,
          kind: 'chapter',
        };
      } else {
        document = {
          path,
          body: source,
          meta: {
            id: '',
            title: path,
            order: 0,
            status: 'draft',
            characterIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          baselineHash,
          kind: 'other',
        };
      }
      set({
        document,
        saveStatus: 'saved',
        saveError: null,
        conflict: null,
        wordCount: countWords(document.body).total,
      });
    } catch (error) {
      set({ saveError: describeError(error), saveStatus: 'error' });
    }
  },

  updateBody(body) {
    const document = get().document;
    if (!document) return;
    if (
      document.kind !== 'chapter' &&
      (!document.path.endsWith('.md') || isProtectedPath(document.path))
    )
      return;
    set({
      document: { ...document, body },
      saveStatus: 'dirty',
      wordCount: countWords(body).total,
    });
    clearAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void get().save();
    }, AUTOSAVE_DELAY_MS);
  },

  updateTitle(title) {
    const document = get().document;
    if (!document || document.kind !== 'chapter') return;
    const meta: ChapterMeta = { ...document.meta, title, updatedAt: new Date().toISOString() };
    set({ document: { ...document, meta }, saveStatus: 'dirty' });
    clearAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void get().save();
    }, AUTOSAVE_DELAY_MS);
  },

  async save(options) {
    const state = get();
    const document = state.document;
    const project = useWorkspace.getState().project;
    if (!document || !project || savingInFlight) return;
    if (state.saveStatus === 'saved' && !options?.force) return;

    clearAutosave();
    savingInFlight = true;
    set({ saveStatus: 'saving', saveError: null });

    try {
      // Re-check the file has not changed underneath us (external edits, another
      // process, or a stale baseline after an AI commit).
      const currentHash = await project.store.fileHash(document.path);
      if (currentHash !== document.baselineHash && !options?.force) {
        set({
          saveStatus: 'dirty',
          conflict: {
            path: document.path,
            message: '文件在编辑器之外被修改过。请选择覆盖或重新载入。',
          },
        });
        return;
      }

      const content =
        document.kind === 'chapter'
          ? serializeChapterDocument(
              { ...document.meta, updatedAt: new Date().toISOString() },
              document.body,
            )
          : document.body;

      if (document.kind !== 'chapter') {
        if (!document.path.endsWith('.md') || isProtectedPath(document.path))
          throw new Error('该文件受保护，不支持在正文编辑区修改。');
        const previous = await project.store.readFileOrNull(document.path);
        validateManualMarkdown(document.path, content, previous);
        await project.snapshots.capture(`作者编辑前快照：${document.path}`, [document.path]);
      }
      const { hash } = await project.store.writeFile(document.path, content, {
        ...(options?.force
          ? currentHash !== null
            ? { expectedHash: currentHash }
            : {}
          : { expectedHash: document.baselineHash }),
      });
      const current = get().document;
      if (!current || current.path !== document.path || useWorkspace.getState().project !== project)
        return;
      const unchanged = current.body === document.body && current.meta === document.meta;
      set({
        saveStatus: unchanged ? 'saved' : 'dirty',
        lastSavedAt: new Date().toISOString(),
        saveError: null,
        conflict: null,
        document: { ...current, baselineHash: hash },
      });
      if (!unchanged) {
        clearAutosave();
        autosaveTimer = setTimeout(() => {
          autosaveTimer = null;
          void get().save();
        }, AUTOSAVE_DELAY_MS);
      }
      await useWorkspace.getState().refreshTree();
      void project.indexer.updateFile(document.path).catch(() => undefined);
    } catch (error) {
      if (get().document?.path === document.path && useWorkspace.getState().project === project)
        set({ saveStatus: 'error', saveError: describeError(error) });
    } finally {
      savingInFlight = false;
    }
  },

  reset() {
    loadSequence += 1;
    clearAutosave();
    set({
      document: null,
      saveStatus: 'saved',
      saveError: null,
      conflict: null,
      wordCount: 0,
      lastSavedAt: null,
    });
  },

  dismissConflict() {
    set({ conflict: null });
  },
}));
