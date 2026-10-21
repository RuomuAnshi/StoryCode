import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { describeError } from '@storycode/core';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner, Field, inputClass } from '@/components/primitives';
import { PROVIDER_PRESETS, useSettings } from '@/stores/settings-store';
import { cn } from '@/lib/cn';

interface ModelSettingsDialogProps {
  open: boolean;
  onClose(): void;
}

/** Model provider configuration. The API key never leaves the OS keychain. */
export function ModelSettingsDialog({ open, onClose }: ModelSettingsDialogProps) {
  const settings = useSettings((state) => state.settings);
  const keyStatus = useSettings((state) => state.keyStatus);
  const keyringAvailable = useSettings((state) => state.keyringAvailable);
  const update = useSettings((state) => state.update);
  const applyPreset = useSettings((state) => state.applyPreset);
  const saveApiKey = useSettings((state) => state.saveApiKey);
  const clearApiKey = useSettings((state) => state.clearApiKey);
  const refreshKeyStatus = useSettings((state) => state.refreshKeyStatus);

  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void refreshKeyStatus();
      setApiKey('');
      setNotice(null);
      setError(null);
    }
  }, [open, refreshKeyStatus]);

  const needsKey = settings.providerId !== 'ollama';

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      if (needsKey && apiKey.trim().length > 0) {
        await saveApiKey(apiKey.trim());
        setApiKey('');
        setNotice('API Key 已保存到系统钥匙串。');
      }
      await refreshKeyStatus();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="模型设置"
      description="StoryCode 不代理你的请求内容：正文只会发送到你自己填写的模型服务地址。"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[var(--sc-text-secondary)]">服务商</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                title={preset.hint}
                className={cn(
                  'rounded-lg border px-2.5 py-2 text-left transition-colors',
                  settings.providerId === preset.id
                    ? 'border-[var(--sc-accent)]/60 bg-[var(--sc-accent-soft)]'
                    : 'border-[var(--sc-border)] hover:border-[var(--sc-border-strong)]',
                )}
              >
                <span
                  className={cn(
                    'block text-[12.5px] font-medium',
                    settings.providerId === preset.id
                      ? 'text-[var(--sc-accent-text)]'
                      : 'text-[var(--sc-text)]',
                  )}
                >
                  {preset.label}
                </span>
                <span className="block truncate text-[10.5px] text-[var(--sc-text-muted)]">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Base URL"
          htmlFor="base-url"
          hint="需要是兼容 OpenAI Chat Completions 的地址。"
        >
          <input
            id="base-url"
            value={settings.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://api.deepseek.com/v1"
            spellCheck={false}
            className={cn(inputClass, 'font-mono text-[12.5px]')}
          />
        </Field>

        <Field label="模型 ID" htmlFor="model-id" hint="可以直接填写服务商文档中的模型名称。">
          <input
            id="model-id"
            value={settings.model}
            onChange={(event) => update({ model: event.target.value })}
            placeholder="deepseek-chat"
            spellCheck={false}
            className={cn(inputClass, 'font-mono text-[12.5px]')}
          />
        </Field>

        <Field
          label="工具调用"
          htmlFor="tool-protocol"
          hint="模型只输出工具 JSON 而不执行时，选择 JSON 兼容。兼容模式等待完整响应后校验，所有改动仍需审核。"
        >
          <select
            id="tool-protocol"
            value={settings.toolProtocol}
            onChange={(event) =>
              update({ toolProtocol: event.target.value === 'json' ? 'json' : 'native' })
            }
            className={inputClass}
          >
            <option value="native">原生 Tool Calling</option>
            <option value="json">JSON 兼容</option>
          </select>
        </Field>

        <Field
          label="API Key"
          hint={
            keyringAvailable
              ? '保存在 macOS 钥匙串 / Windows 凭据管理器中，不会写入配置文件或日志。'
              : '当前系统没有可用的安全凭据存储，API Key 无法保存。'
          }
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <KeyRound
                  size={12}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sc-text-muted)]"
                />
                <input
                  type={reveal ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    keyStatus.configured ? `已保存 ${keyStatus.hint ?? ''}` : '粘贴你的 API Key'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(inputClass, 'pl-7.5 font-mono text-[12.5px]')}
                />
                <button
                  type="button"
                  onClick={() => setReveal((current) => !current)}
                  aria-label={reveal ? '隐藏 API Key' : '显示 API Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--sc-text-muted)] hover:text-[var(--sc-text)]"
                >
                  {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              {keyStatus.configured && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void clearApiKey();
                    setNotice('已删除保存的 API Key。');
                  }}
                  icon={<Trash2 size={11} />}
                >
                  删除
                </Button>
              )}
            </div>
            {keyStatus.configured && (
              <p className="inline-flex items-center gap-1 text-[11.5px] text-[var(--sc-success)]">
                <Check size={11} />
                已配置（{keyStatus.hint}）
              </p>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="温度" hint="越高越有想象力，建议 0.7–1.0。">
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(event) => update({ temperature: Number(event.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field label="最大输出 Token" hint="单次回复的上限。">
            <input
              type="number"
              min={256}
              max={32768}
              step={256}
              value={settings.maxTokens}
              onChange={(event) => update({ maxTokens: Number(event.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="上下文预算" hint="组装提示词时可用的 token 上限。">
            <input
              type="number"
              min={4000}
              max={200000}
              step={1000}
              value={settings.contextLimit}
              onChange={(event) => update({ contextLimit: Number(event.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field label="请求超时（毫秒）" hint="网络较慢时可以调大。">
            <input
              type="number"
              min={10000}
              max={600000}
              step={5000}
              value={settings.timeoutMs}
              onChange={(event) => update({ timeoutMs: Number(event.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>

        {error && <Banner tone="error">{error}</Banner>}
        {notice && (
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        )}
      </div>
    </Dialog>
  );
}
