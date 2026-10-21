//! Model request proxy.
//!
//! All model traffic leaves the machine from here, not from the webview. This
//! keeps the API key inside the Rust process (the UI never receives it), lets
//! the CSP stay locked to `'self'`, and gives us one place to enforce timeouts
//! and cancellation.
//!
//! The proxy is deliberately a dumb pipe: it forwards whatever JSON body the
//! frontend supplies to `<base_url>/chat/completions` and streams the raw SSE
//! bytes back as events. All protocol understanding lives in TypeScript.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct StreamChatRequest {
    /// Correlation id echoed on every emitted event.
    pub request_id: String,
    pub provider_id: String,
    pub base_url: String,
    /// Full JSON request body, already shaped for the provider.
    pub body: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
struct DeltaPayload {
    request_id: String,
    chunk: String,
}

#[derive(Clone, Serialize)]
struct DonePayload {
    request_id: String,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    request_id: String,
    message: String,
    retryable: bool,
}

fn validate_base_url(base_url: &str) -> AppResult<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let lower = trimmed.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::invalid("Base URL 必须以 http:// 或 https:// 开头"));
    }
    Ok(trimmed.to_string())
}

/// Starts a streaming chat request. Returns immediately; results arrive as
/// `model://delta`, `model://done`, and `model://error` events.
#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StreamChatRequest,
) -> AppResult<()> {
    let base_url = validate_base_url(&request.base_url)?;
    // Local OpenAI-compatible servers need no key; only hard-fail when the
    // keychain itself is unreadable.
    let api_key = secrets::optional_api_key(&request.provider_id)?;
    let request_id = request.request_id.clone();
    let cancel = state.register_stream(&request_id)?;
    let timeout_ms = request.timeout_ms.unwrap_or(120_000);

    let body: serde_json::Value = serde_json::from_str(&request.body)
        .map_err(|_| AppError::invalid("请求体不是合法 JSON"))?;

    let url = format!("{base_url}/chat/completions");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|_| AppError::internal("无法创建 HTTP 客户端"))?;

    let app_for_task = app.clone();
    // `State` borrows the invocation; the task gets its own handle and looks the
    // stream registry up by id when it finishes.
    let registry_id = request_id.clone();

    tauri::async_runtime::spawn(async move {
        let mut cancel = cancel;
        let send_error = |app: &AppHandle, message: String, retryable: bool| {
            let _ = app.emit(
                "model://error",
                ErrorPayload { request_id: registry_id.clone(), message, retryable },
            );
        };

        let mut outgoing = client
            .post(&url)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream");
        if let Some(key) = api_key.as_deref() {
            outgoing = outgoing.header("authorization", format!("Bearer {key}"));
        }
        let response = outgoing.body(body.to_string()).send().await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let message = if error.is_timeout() {
                    format!("请求超时（{timeout_ms}ms）")
                } else if error.is_connect() {
                    "无法连接到模型服务，请检查网络或 Base URL".to_string()
                } else {
                    format!("网络错误：{error}")
                };
                send_error(&app_for_task, message, true);
                finish(&app_for_task, &registry_id);
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let detail = response.text().await.unwrap_or_default();
            let hint = match status {
                401 => "API Key 无效或已过期",
                403 => "访问被拒绝，请检查密钥权限",
                404 => "接口地址或模型名称不存在",
                429 => "请求过于频繁或额度不足",
                _ if status >= 500 => "模型服务端错误",
                _ => "请求失败",
            };
            send_error(
                &app_for_task,
                format!("{hint}（HTTP {status}）{}", if detail.is_empty() { String::new() } else { format!(": {}", truncate(&detail, 300)) }),
                status >= 500 || status == 429,
            );
            finish(&app_for_task, &registry_id);
            return;
        }

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        loop {
            // Respect cancellation between chunks.
            if *cancel.borrow() {
                let _ = app_for_task.emit("model://cancelled", DonePayload { request_id: registry_id.clone() });
                finish(&app_for_task, &registry_id);
                return;
            }
            let next = tokio::select! {
                biased;
                changed = cancel.changed() => {
                    let _ = changed;
                    None
                }
                chunk = stream.next() => Some(chunk),
            };

            match next {
                None => {
                    let _ = app_for_task.emit("model://cancelled", DonePayload { request_id: registry_id.clone() });
                    finish(&app_for_task, &registry_id);
                    return;
                }
                Some(None) => {
                    let _ = app_for_task.emit("model://done", DonePayload { request_id: registry_id.clone() });
                    finish(&app_for_task, &registry_id);
                    return;
                }
                Some(Some(Err(error))) => {
                    send_error(&app_for_task, format!("读取模型响应失败：{error}"), true);
                    finish(&app_for_task, &registry_id);
                    return;
                }
                Some(Some(Ok(bytes))) => {
                    let chunk = String::from_utf8_lossy(&bytes).to_string();
                    let _ = app_for_task.emit(
                        "model://delta",
                        DeltaPayload { request_id: registry_id.clone(), chunk },
                    );
                }
            }
        }

        fn finish(app: &AppHandle, id: &str) {
            let state = app.state::<AppState>();
            state.finish_stream(id);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, request_id: String) -> AppResult<bool> {
    state.cancel_stream(&request_id)
}

fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}
