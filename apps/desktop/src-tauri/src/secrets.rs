//! API key storage.
//!
//! Keys live in the OS keychain (macOS Keychain / Windows Credential Manager /
//! Secret Service) via the `keyring` crate. They are never written to project
//! files, config files, or logs, and are never returned to the UI in full:
//! `get_key_status` only reports whether a key exists and its last 4 chars.

use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "app.storycode.desktop";

fn entry_for(provider_id: &str) -> AppResult<Entry> {
    if provider_id.trim().is_empty() || provider_id.len() > 128 {
        return Err(AppError::invalid("非法的服务商标识"));
    }
    Entry::new(SERVICE, provider_id).map_err(|_| AppError::internal("无法访问系统凭据存储"))
}

fn set_api_key_sync(provider_id: String, api_key: String) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::invalid("API Key 不能为空"));
    }
    let entry = entry_for(&provider_id)?;
    entry
        .set_password(&api_key)
        .map_err(|_| AppError::internal("写入系统凭据存储失败"))
}

/// Returns the key for a provider. Only called by the Rust-side model proxy;
/// never exposed as a command the webview can invoke directly.
pub fn load_api_key(provider_id: &str) -> AppResult<String> {
    let entry = entry_for(provider_id)?;
    entry
        .get_password()
        .map_err(|_| AppError::invalid("尚未配置该服务商的 API Key"))
}

/// Like [`load_api_key`], but distinguishes "no key stored" from a real
/// keychain failure. Local OpenAI-compatible servers (Ollama, LM Studio,
/// llama.cpp) legitimately have no key, so the proxy must be able to send an
/// unauthenticated request for them instead of failing before it connects.
pub fn optional_api_key(provider_id: &str) -> AppResult<Option<String>> {
    let entry = entry_for(provider_id)?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::internal("读取系统凭据失败")),
    }
}

fn delete_api_key_sync(provider_id: String) -> AppResult<()> {
    let entry = entry_for(&provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(AppError::internal("删除系统凭据失败")),
    }
}

#[derive(serde::Serialize)]
pub struct KeyStatus {
    pub configured: bool,
    /// Last four characters, for the author to recognize the key.
    pub hint: Option<String>,
}

fn get_key_status_sync(provider_id: String) -> AppResult<KeyStatus> {
    let entry = entry_for(&provider_id)?;
    match entry.get_password() {
        Ok(key) => {
            let hint = if key.chars().count() >= 4 {
                let tail: String = key
                    .chars()
                    .rev()
                    .take(4)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                Some(format!("••••{tail}"))
            } else {
                Some("••••".to_string())
            };
            Ok(KeyStatus {
                configured: true,
                hint,
            })
        }
        Err(keyring::Error::NoEntry) => Ok(KeyStatus {
            configured: false,
            hint: None,
        }),
        Err(_) => Err(AppError::internal("读取系统凭据失败")),
    }
}

/// Checks whether the OS keychain is usable, so the UI can warn instead of failing silently.
fn keyring_available_sync() -> bool {
    Entry::new(SERVICE, "__probe__")
        .and_then(|entry| match entry.get_password() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        })
        .is_ok()
}

// OS credential requests may wait for a system permission dialog. Never run
// them on the WebKit/main thread: local reading must remain responsive.
async fn credential_task<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| AppError::internal("系统凭据任务失败"))?
}

#[tauri::command]
pub async fn set_api_key(provider_id: String, api_key: String) -> AppResult<()> {
    credential_task(move || set_api_key_sync(provider_id, api_key)).await
}

#[tauri::command]
pub async fn delete_api_key(provider_id: String) -> AppResult<()> {
    credential_task(move || delete_api_key_sync(provider_id)).await
}

#[tauri::command]
pub async fn get_key_status(provider_id: String) -> AppResult<KeyStatus> {
    credential_task(move || get_key_status_sync(provider_id)).await
}

#[tauri::command]
pub async fn keyring_available() -> bool {
    credential_task(|| Ok(keyring_available_sync()))
        .await
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_work_does_not_run_on_calling_thread() {
        let calling_thread = std::thread::current().id();
        let worker_thread =
            tauri::async_runtime::block_on(credential_task(|| Ok(std::thread::current().id())))
                .unwrap();
        assert_ne!(calling_thread, worker_thread);
    }
    #[test]
    fn invalid_provider_is_rejected_without_reading_credentials() {
        let result = tauri::async_runtime::block_on(get_key_status(String::new()));
        assert!(matches!(result, Err(AppError::Invalid(_))));
    }
}
