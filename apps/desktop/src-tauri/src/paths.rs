//! Path authorization.
//!
//! Every filesystem command funnels through `resolve_within`, which
//! canonicalizes both the project root and the target and then verifies the
//! target is still inside the root. This defeats `..` traversal and symlink
//! escapes: a symlink pointing outside the project resolves to its real
//! target, which then fails the containment check.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Normalizes a project-relative path into a safe form.
///
/// Rejects absolute paths, drive letters, parent traversal, and NUL bytes.
/// Returns a `PathBuf` of only normal components.
pub fn normalize_relative(input: &str) -> AppResult<PathBuf> {
    if input.contains('\0') {
        return Err(AppError::unsafe_path("路径包含非法字符"));
    }
    if input.trim().is_empty() {
        return Err(AppError::unsafe_path("路径不能为空"));
    }
    let candidate = Path::new(input);
    if candidate.is_absolute() {
        return Err(AppError::unsafe_path("不允许绝对路径"));
    }

    let mut out = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => {
                let part_str = part.to_string_lossy();
                // Block Windows drive/UNC artefacts and hidden metadata traversal.
                if part_str.contains(':') || part_str == ".." {
                    return Err(AppError::unsafe_path("路径包含非法片段"));
                }
                out.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::unsafe_path("路径不允许包含 .. 或根目录"));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(AppError::unsafe_path("路径无有效内容"));
    }
    Ok(out)
}

/// Resolves `relative` inside `root`, guaranteeing the result stays inside.
///
/// The root itself is canonicalized (it must already exist). The target may or
/// may not exist; when it does not, we canonicalize its deepest existing
/// ancestor and re-append the remainder, so a symlinked parent cannot be used
/// to escape.
pub fn resolve_within(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let root_canonical = root
        .canonicalize()
        .map_err(|_| AppError::permission("项目目录不可访问"))?;
    let rel = normalize_relative(relative)?;

    let joined = root_canonical.join(&rel);
    let resolved = canonicalize_allow_missing(&joined)?;

    if !resolved.starts_with(&root_canonical) {
        return Err(AppError::unsafe_path(
            "路径越界：目标不在项目目录内（可能通过符号链接逃逸）",
        ));
    }
    Ok(resolved)
}

/// Canonicalizes as much of the path as exists, then appends the rest verbatim.
fn canonicalize_allow_missing(path: &Path) -> AppResult<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }
    let mut existing = path;
    let mut remainder: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match existing.parent() {
            Some(parent) => {
                if let Some(name) = existing.file_name() {
                    remainder.push(name.to_os_string());
                }
                existing = parent;
                if existing.exists() {
                    break;
                }
            }
            None => return Err(AppError::unsafe_path("路径无法解析")),
        }
    }
    let mut base = existing
        .canonicalize()
        .map_err(|_| AppError::unsafe_path("路径无法解析"))?;
    for part in remainder.into_iter().rev() {
        base.push(part);
    }
    Ok(base)
}

/// Builds the absolute path of a project file, verifying containment.
pub fn project_file(root: &Path, relative: &str) -> AppResult<PathBuf> {
    resolve_within(root, relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_parent_traversal() {
        assert!(normalize_relative("../secrets.txt").is_err());
        assert!(normalize_relative("chapters/../../x.md").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        assert!(normalize_relative("/etc/passwd").is_err());
        assert!(normalize_relative("C:\\Windows\\system32").is_err());
    }

    #[test]
    fn accepts_normal_relative_paths() {
        let path = normalize_relative("chapters/001.md").expect("should accept");
        assert_eq!(path, PathBuf::from("chapters/001.md"));
        let dotted = normalize_relative("./chapters/001.md").expect("should accept");
        assert_eq!(dotted, PathBuf::from("chapters/001.md"));
    }

    #[test]
    fn resolve_stays_inside_root() {
        let temp = std::env::temp_dir().join(format!("sc-paths-{}", std::process::id()));
        fs::create_dir_all(temp.join("chapters")).unwrap();
        let resolved = resolve_within(&temp, "chapters/001.md").expect("inside");
        assert!(resolved.starts_with(temp.canonicalize().unwrap()));
        assert!(resolve_within(&temp, "../escape.md").is_err());
        fs::remove_dir_all(&temp).ok();
    }
}
