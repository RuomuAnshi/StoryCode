import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useSettings } from './settings-store';

const bridge = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  getKeyStatus: vi.fn().mockResolvedValue({ configured: false, hint: null }),
}));
vi.mock('@/lib/tauri', () => ({ desktop: bridge, isTauri: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, saveError: null });
});

describe('model settings', () => {
  it('preserves the custom URL, model and JSON protocol when selecting custom', () => {
    useSettings
      .getState()
      .update({ baseUrl: 'https://example.invalid/v1', model: 'test-model', toolProtocol: 'json' });
    useSettings
      .getState()
      .applyPreset({ id: 'custom', label: '自定义', baseUrl: '', model: '', hint: '' });
    expect(useSettings.getState().settings).toMatchObject({
      providerId: 'custom',
      baseUrl: 'https://example.invalid/v1',
      model: 'test-model',
      toolProtocol: 'json',
    });
    expect(bridge.getKeyStatus).toHaveBeenCalledWith('custom');
  });
  it('reports keychain failure to the dialog instead of reporting a successful save', async () => {
    bridge.setApiKey.mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(useSettings.getState().saveApiKey('test-only-placeholder')).rejects.toThrow(
      'keychain unavailable',
    );
    expect(useSettings.getState().saveError).toBe('keychain unavailable');
  });
});
