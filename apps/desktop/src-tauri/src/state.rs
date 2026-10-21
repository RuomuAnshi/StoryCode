use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

/// Shared application state.
#[derive(Default)]
pub struct AppState {
    /// Canonicalized absolute path of the open novel project.
    pub project_root: Mutex<Option<PathBuf>>,
    /// Tracks in-flight streaming requests so they can be cancelled.
    pub streams: Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a cancellable stream; returns the receiver used by the pump.
    pub fn register_stream(&self, id: &str) -> AppResult<tokio::sync::watch::Receiver<bool>> {
        let (tx, rx) = tokio::sync::watch::channel(false);
        let mut guard = self.streams.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
        guard.insert(id.to_string(), tx);
        Ok(rx)
    }

    pub fn cancel_stream(&self, id: &str) -> AppResult<bool> {
        let guard = self.streams.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
        match guard.get(id) {
            Some(tx) => {
                let _ = tx.send(true);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub fn finish_stream(&self, id: &str) {
        if let Ok(mut guard) = self.streams.lock() {
            guard.remove(id);
        }
    }
}
