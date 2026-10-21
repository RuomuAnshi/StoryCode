//! Filesystem commands exposed to the frontend.
//!
//! These are the ONLY way the webview can touch the disk. Every path argument
//! is resolved through `paths::resolve_within`, and writes are atomic
//! (temp file + rename) where the filesystem supports it, with a direct-write
//! fallback for exFAT and similar filesystems.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::paths;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    /// "file" | "directory"
    pub kind: String,
}

#[derive(Debug, Serialize)]
pub struct FileStat {
    pub exists: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub is_directory: bool,
}

fn require_project_root(state: &AppState) -> AppResult<PathBuf> {
    let root = state.project_root.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
    root.clone()
        .ok_or_else(|| AppError::invalid("尚未打开任何小说项目"))
}

/// Records or clears the active project root; only paths that exist are accepted.
#[tauri::command]
pub fn set_project_root(state: State<'_, AppState>, root: String) -> AppResult<()> {
    if root.trim().is_empty() {
        let mut guard = state.project_root.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
        *guard = None;
        return Ok(());
    }
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(AppError::not_found("项目目录不存在"));
    }
    let canonical = path.canonicalize().map_err(|_| AppError::permission("项目目录不可访问"))?;
    let mut guard = state.project_root.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
    *guard = Some(canonical);
    Ok(())
}

#[tauri::command]
pub fn get_project_root(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let guard = state.project_root.lock().map_err(|_| AppError::internal("状态锁定失败"))?;
    Ok(guard.as_ref().map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn read_text_file(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    let bytes = std::fs::read(&target)?;
    String::from_utf8(bytes).map_err(|_| AppError::invalid("文件不是有效的 UTF-8 文本"))
}

#[tauri::command]
pub fn write_text_file(state: State<'_, AppState>, path: String, content: String) -> AppResult<()> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    atomic_write(&target, content.as_bytes())
}

#[tauri::command]
pub fn file_exists(state: State<'_, AppState>, path: String) -> AppResult<bool> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    Ok(target.exists())
}

#[tauri::command]
pub fn stat_file(state: State<'_, AppState>, path: String) -> AppResult<FileStat> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    match std::fs::metadata(&target) {
        Ok(metadata) => Ok(FileStat {
            exists: true,
            size: metadata.len(),
            modified_ms: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
            is_directory: metadata.is_dir(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileStat {
            exists: false,
            size: 0,
            modified_ms: 0,
            is_directory: false,
        }),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub fn list_directory(state: State<'_, AppState>, path: String) -> AppResult<Vec<DirEntry>> {
    let root = require_project_root(&state)?;
    let target = if path.trim().is_empty() {
        root.clone()
    } else {
        paths::project_file(&root, &path)?
    };
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&target)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            // Hide macOS resource forks and VCS noise from the author.
            if name.starts_with("._") || name == ".DS_Store" || name == ".git" {
                return None;
            }
            let kind = if entry.path().is_dir() { "directory" } else { "file" };
            Some(DirEntry { name, kind: kind.to_string() })
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub fn create_directory(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    std::fs::create_dir_all(&target)?;
    Ok(())
}

#[tauri::command]
pub fn delete_file(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    if target.is_dir() {
        std::fs::remove_dir_all(&target)?;
    } else if target.exists() {
        std::fs::remove_file(&target)?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_entry(state: State<'_, AppState>, from: String, to: String) -> AppResult<()> {
    let root = require_project_root(&state)?;
    let source = paths::project_file(&root, &from)?;
    let destination = paths::project_file(&root, &to)?;
    if destination.exists() {
        return Err(AppError::conflict("目标已存在"));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&source, &destination)?;
    Ok(())
}

/// Creates a project directory from a path chosen in the native folder picker.
///
/// `root` is an absolute path supplied by the OS dialog, not by the model, so
/// it is trusted only for *creating* the container; all subsequent access goes
/// through `resolve_within` against the canonicalized project root.
#[tauri::command]
pub fn create_project_directory(root: String, subdirs: Vec<String>) -> AppResult<String> {
    let path = PathBuf::from(&root);
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid("未选择目录"));
    }
    std::fs::create_dir_all(&path)?;
    let canonical = path.canonicalize().map_err(|_| AppError::permission("目录不可访问"))?;
    for subdir in subdirs {
        let target = paths::resolve_within(&canonical, &subdir)?;
        std::fs::create_dir_all(&target)?;
    }
    Ok(canonical.to_string_lossy().to_string())
}

/// Hash of a file's current content (SHA-256, hex). Used as the version token
/// for optimistic concurrency: a proposal captures the hash at generation time
/// and the commit re-checks it.
#[tauri::command]
pub fn hash_file(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let root = require_project_root(&state)?;
    let target = paths::project_file(&root, &path)?;
    let bytes = std::fs::read(&target)?;
    Ok(sha256_hex(&bytes))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Writes atomically when possible; falls back to truncate+write.
fn atomic_write(target: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        target.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()),
        std::process::id()
    ));
    match std::fs::write(&temp, bytes) {
        Ok(()) => match std::fs::rename(&temp, target) {
            Ok(()) => Ok(()),
            Err(_) => {
                // exFAT and some network shares reject rename-over-existing.
                let _ = std::fs::remove_file(&temp);
                std::fs::write(target, bytes).map_err(|error| error.into())
            }
        },
        Err(_) => std::fs::write(target, bytes).map_err(|error| error.into()),
    }
}

#[derive(Debug, Deserialize)]
pub struct BatchReadRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BatchReadEntry {
    pub path: String,
    pub content: Option<String>,
    pub error: Option<String>,
}

/// Reads many files in one round trip (used when indexing a project).
#[tauri::command]
pub fn read_many_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> AppResult<Vec<BatchReadEntry>> {
    let root = require_project_root(&state)?;
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        match paths::project_file(&root, &path).and_then(|target| Ok(std::fs::read_to_string(target)?)) {
            Ok(content) => out.push(BatchReadEntry { path, content: Some(content), error: None }),
            Err(error) => out.push(BatchReadEntry { path, content: None, error: Some(error.to_string()) }),
        }
    }
    Ok(out)
}
