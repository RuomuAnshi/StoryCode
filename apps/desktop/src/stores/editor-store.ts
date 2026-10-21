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
  parseChapterDocument,
  serializeChapterDocument,
  type ChapterMeta,
} from '@storycode/core';
import { describeError } from '@storycode/core';
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

  openFile(path: string): Promise<void>;
  updateBody(body: string): void;
  updateTitle(title: string): void;
  save(options?: { force?: boolean }): Promise<void>;
  reset(): void;
  dismissConflict(): void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 900;

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

  async openFile(path) {
    const project = useWorkspace.getState().project;
    if (!project) return;
    clearAutosave();

    // Flush pending edits before switching files.
    if (get().saveStatus === 'dirty') {
      await get().save({ force: true });
    }

    try {
      const source = await project.store.readFile(path);
      const baselineHash = (await project.store.fileHash(path)) ?? '';
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
    if (!document || !project) return;
    if (state.saveStatus === 'saved' && !options?.force) return;

    clearAutosave();
    set({ saveStatus: 'saving', saveError: null });

    try {
      // Re-check the file has not changed underneath us (external edits, another
      // process, or a stale baseline after an AI commit).
      const currentHash = await project.store.fileHash(document.path);
      if (currentHash !== null && currentHash !== document.baselineHash && !options?.force) {
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

      const { hash } = await project.store.writeFile(document.path, content);
      set({
        saveStatus: 'saved',
        lastSavedAt: new Date().toISOString(),
        saveError: null,
        document: { ...get().document!, baselineHash: hash },
      });
      await useWorkspace.getState().refreshTree();
      void project.indexer.updateFile(document.path).catch(() => undefined);
    } catch (error) {
      set({ saveStatus: 'error', saveError: describeError(error) });
    }
  },

  reset() {
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
