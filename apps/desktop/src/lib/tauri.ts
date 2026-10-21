/**
 * Typed wrapper around the Tauri IPC boundary.
 *
 * Everything the UI does to the disk or the model goes through this module, so
 * there is exactly one place where `invoke` and `listen` are used. Running in a
 * plain browser (during `vite dev` without Tauri) degrades gracefully: calls
 * reject with a clear message instead of crashing the app.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn as TauriUnlistenFn } from '@tauri-apps/api/event';

export type UnlistenFn = TauriUnlistenFn;

export interface StoryCodeErrorPayload {
  code: string;
  message: string;
}

/** True when running inside the Tauri webview. */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}

export class DesktopUnavailableError extends Error {
  constructor(message = '桌面端不可用：请在 StoryCode 应用内运行（浏览器模式无法访问本地文件）') {
    super(message);
    this.name = 'DesktopUnavailableError';
  }
}

function normalizeError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const payload = error as StoryCodeErrorPayload;
    const wrapped = new Error(payload.message);
    wrapped.name = payload.code ?? 'Error';
    return wrapped;
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopUnavailableError();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface FileStat {
  exists: boolean;
  size: number;
  modified_ms: number;
  is_directory: boolean;
}

export interface BatchReadEntry {
  path: string;
  content: string | null;
  error: string | null;
}

export interface KeyStatus {
  configured: boolean;
  hint: string | null;
}

export const desktop = {
  webSearch: (query: string, limit: number) => call<unknown>('web_search', { query, limit }),
  webFetch: (url: string) => call<unknown>('web_fetch', { url }),
  openWebUrl: (url: string) => call<void>('open_web_url', { url }),
  setProjectRoot: (root: string) => call<void>('set_project_root', { root }),
  getProjectRoot: () => call<string | null>('get_project_root'),
  readTextFile: (path: string) => call<string>('read_text_file', { path }),
  writeTextFile: (path: string, content: string) =>
    call<void>('write_text_file', { path, content }),
  fileExists: (path: string) => call<boolean>('file_exists', { path }),
  statFile: (path: string) => call<FileStat>('stat_file', { path }),
  listDirectory: (path: string) => call<DirEntry[]>('list_directory', { path }),
  createDirectory: (path: string) => call<void>('create_directory', { path }),
  deleteFile: (path: string) => call<void>('delete_file', { path }),
  renameEntry: (from: string, to: string) => call<void>('rename_entry', { from, to }),
  createProjectDirectory: (root: string, subdirs: string[]) =>
    call<string>('create_project_directory', { root, subdirs }),
  hashFile: (path: string) => call<string>('hash_file', { path }),
  readManyFiles: (paths: string[]) => call<BatchReadEntry[]>('read_many_files', { paths }),

  setApiKey: (providerId: string, apiKey: string) =>
    call<void>('set_api_key', { providerId, apiKey }),
  deleteApiKey: (providerId: string) => call<void>('delete_api_key', { providerId }),
  getKeyStatus: (providerId: string) => call<KeyStatus>('get_key_status', { providerId }),
  keyringAvailable: () => call<boolean>('keyring_available'),

  streamChat: (request: StreamChatRequestPayload) => call<void>('stream_chat', { request }),
  cancelChat: (requestId: string) => call<boolean>('cancel_chat', { requestId }),
};

export interface StreamChatRequestPayload {
  request_id: string;
  provider_id: string;
  base_url: string;
  body: string;
  timeout_ms?: number;
}

export interface ModelDeltaPayload {
  request_id: string;
  chunk: string;
}

export interface ModelDonePayload {
  request_id: string;
}

export interface ModelErrorPayload {
  request_id: string;
  message: string;
  retryable: boolean;
}

/**
 * Subscribes to model stream events for one request id.
 * Returns an unlisten function; call it when the stream ends.
 */
export async function onModelEvents(handlers: {
  requestId: string;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (message: string, retryable: boolean) => void;
  onCancelled: () => void;
}): Promise<UnlistenFn> {
  if (!isTauri()) throw new DesktopUnavailableError();
  const unlisteners = await Promise.all([
    listen<ModelDeltaPayload>('model://delta', (event) => {
      if (event.payload.request_id === handlers.requestId) handlers.onDelta(event.payload.chunk);
    }),
    listen<ModelDonePayload>('model://done', (event) => {
      if (event.payload.request_id === handlers.requestId) handlers.onDone();
    }),
    listen<ModelErrorPayload>('model://error', (event) => {
      if (event.payload.request_id === handlers.requestId)
        handlers.onError(event.payload.message, event.payload.retryable);
    }),
    listen<ModelDonePayload>('model://cancelled', (event) => {
      if (event.payload.request_id === handlers.requestId) handlers.onCancelled();
    }),
  ]);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

/** Opens the native folder picker and returns the chosen path, or null. */
export async function pickDirectory(title = '选择小说项目目录'): Promise<string | null> {
  if (!isTauri()) throw new DesktopUnavailableError();
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false, title });
  if (typeof selected === 'string') return selected;
  return null;
}
