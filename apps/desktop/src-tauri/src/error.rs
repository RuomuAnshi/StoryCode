//! Error type shared by all Tauri commands.
//!
//! Errors are serialized to the frontend as `{ code, message }` so the UI can
//! branch on `code` while showing `message` to the author. Messages never
//! contain API keys or file contents.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    UnsafePath(String),
    #[error("{0}")]
    Permission(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn unsafe_path(message: impl Into<String>) -> Self {
        Self::UnsafePath(message.into())
    }
    pub fn permission(message: impl Into<String>) -> Self {
        Self::Permission(message.into())
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io(message.into())
    }
    pub fn provider(message: impl Into<String>) -> Self {
        Self::Provider(message.into())
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsafePath(_) => "PATH_UNSAFE",
            Self::Permission(_) => "PERMISSION_DENIED",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Conflict(_) => "VERSION_CONFLICT",
            Self::Invalid(_) => "VALIDATION_FAILED",
            Self::Io(_) => "STORAGE_ERROR",
            Self::Provider(_) => "PROVIDER_ERROR",
            Self::Internal(_) => "INTERNAL",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound("文件不存在".into()),
            std::io::ErrorKind::PermissionDenied => Self::Permission("没有权限访问该文件".into()),
            _ => Self::Io(error.to_string()),
        }
    }
}

#[derive(Serialize)]
pub struct SerializedError {
    pub code: String,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        SerializedError {
            code: self.code().to_string(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
