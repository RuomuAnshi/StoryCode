/**
 * Model configuration.
 *
 * Persisted to `localStorage` minus the API key: the key lives in the OS
 * keychain and is only referenced by provider id. Nothing here ever contains a
 * secret.
 */

import { create } from 'zustand';
import { desktop, isTauri } from '@/lib/tauri';

export interface ModelSettings {
  providerId: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextLimit: number;
  timeoutMs: number;
  streaming: boolean;
  toolProtocol: 'native' | 'json';
}

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '官方 API，需要 OpenAI API Key',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '国内可直连，性价比高',
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '长上下文，适合中文写作',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    hint: '完全本地运行，无需 API Key',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    hint: '任何兼容 OpenAI 接口的服务',
  },
];

const STORAGE_KEY = 'storycode.model-settings.v1';

export const DEFAULT_SETTINGS: ModelSettings = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.85,
  maxTokens: 4096,
  contextLimit: 32000,
  timeoutMs: 120000,
  streaming: true,
  toolProtocol: 'native',
};

function loadSettings(): ModelSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState {
  settings: ModelSettings;
  keyStatus: { configured: boolean; hint: string | null };
  keyringAvailable: boolean;
  saveError: string | null;

  update(patch: Partial<ModelSettings>): void;
  saveApiKey(apiKey: string): Promise<void>;
  clearApiKey(): Promise<void>;
  refreshKeyStatus(): Promise<void>;
  applyPreset(preset: ProviderPreset): void;
  isConfigured(): boolean;
  reset(): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: loadSettings(),
  keyStatus: { configured: false, hint: null },
  keyringAvailable: true,
  saveError: null,

  update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  },

  applyPreset(preset) {
    if (preset.id === 'custom') {
      get().update({ providerId: preset.id });
      void get().refreshKeyStatus();
      return;
    }
    get().update({
      providerId: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.model,
    });
    void get().refreshKeyStatus();
  },

  async saveApiKey(apiKey) {
    try {
      await desktop.setApiKey(get().settings.providerId, apiKey);
      set({ saveError: null });
      await get().refreshKeyStatus();
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  async clearApiKey() {
    try {
      await desktop.deleteApiKey(get().settings.providerId);
      set({ saveError: null });
      await get().refreshKeyStatus();
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : String(error) });
    }
  },

  async refreshKeyStatus() {
    if (!isTauri()) return;
    try {
      const status = await desktop.getKeyStatus(get().settings.providerId);
      set({ keyStatus: status });
    } catch {
      set({ keyStatus: { configured: false, hint: null } });
    }
  },

  isConfigured() {
    const { settings, keyStatus } = get();
    // Local servers (Ollama) need no key.
    if (settings.providerId === 'ollama') return settings.baseUrl.length > 0;
    return keyStatus.configured && settings.baseUrl.length > 0 && settings.model.length > 0;
  },

  reset() {
    set({ settings: DEFAULT_SETTINGS, keyStatus: { configured: false, hint: null } });
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  },
}));
