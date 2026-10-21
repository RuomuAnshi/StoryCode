/**
 * Workspace state: which project is open, its file tree, and the open buffers.
 *
 * This is the only place that knows how a project is opened and how the file
 * list is refreshed. UI components read derived state from here.
 */

import { create } from 'zustand';
import { ProjectStore, ProjectIndexer, ProposalService, SnapshotStore } from '@storycode/storage';
import type { FileNode } from '@storycode/core';
import { describeError } from '@storycode/core';
import { TauriFsAdapter, joinRoot } from '@/lib/tauri-fs';
import { desktop, isTauri } from '@/lib/tauri';

export interface OpenProject {
  root: string;
  store: ProjectStore;
  indexer: ProjectIndexer;
  proposals: ProposalService;
  snapshots: SnapshotStore;
  name: string;
}

interface WorkspaceState {
  project: OpenProject | null;
  tree: FileNode[];
  loading: boolean;
  error: string | null;

  isDesktop: boolean;
  openProject(root: string): Promise<void>;
  createProject(root: string, name: string, description?: string): Promise<void>;
  closeProject(): void;
  refreshTree(): Promise<void>;
  clearError(): void;
}

const EMPTY_TREE: FileNode[] = [];

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  project: null,
  tree: EMPTY_TREE,
  loading: false,
  error: null,
  isDesktop: isTauri(),

  async openProject(root) {
    set({ loading: true, error: null });
    try {
      await desktop.setProjectRoot(root);
      const fs = new TauriFsAdapter(root);
      const store = await ProjectStore.open(fs, root);
      const indexer = new ProjectIndexer(store);
      const snapshots = new SnapshotStore(fs, store);
      const proposals = new ProposalService(fs, store, snapshots);
      const open: OpenProject = {
        root,
        store,
        indexer,
        proposals,
        snapshots,
        name: store.projectMeta.name,
      };
      set({ project: open, loading: false });
      await indexer.rebuild();
      await get().refreshTree();
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  async createProject(root, name, description) {
    set({ loading: true, error: null });
    try {
      const subdirs = ['chapters', 'characters', 'world', 'plot'];
      await desktop.createProjectDirectory(root, subdirs);
      await desktop.setProjectRoot(root);
      const fs = new TauriFsAdapter(root);
      const store = await ProjectStore.create(fs, {
        root,
        name,
        ...(description ? { description } : {}),
      });
      set({ loading: false });
      void store;
      await get().openProject(root);
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  closeProject() {
    set({ project: null, tree: EMPTY_TREE, error: null });
    void desktop.setProjectRoot('').catch(() => undefined);
  },

  async refreshTree() {
    const project = get().project;
    if (!project) return;
    try {
      const tree = await project.store.buildTree();
      set({ tree });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  clearError() {
    set({ error: null });
  },
}));

/** Absolute path for a project-relative path in the open project. */
export function absolutePathFor(project: OpenProject, relativePath: string): string {
  return joinRoot(project.root, relativePath);
}
