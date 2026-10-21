/**
 * Project storage: the single authoritative layer between domain services and
 * the filesystem. Everything here is path-checked against the project root.
 */

import {
  DIRS,
  MANIFEST_FILE,
  REQUIRED_DIRS,
  STORY_FILE,
  META_DIR,
  assertSafeName,
  chapterOrderFromPath,
  classifyPath,
  contentHash,
  createId,
  joinProjectPath,
  normalizeRelativePath,
  parseChapterDocument,
  parseProjectManifest,
  serializeChapterDocument,
  serializeProjectManifest,
  type ChapterDocument,
  type ChapterMeta,
  type FileNode,
  type ProjectMeta,
  NotFoundError,
  StoryCodeError,
  PathTraversalError,
} from '@storycode/core';
import type { FsAdapter, DirEntry } from './fs-adapter.js';

export interface ProjectLocation {
  /** Absolute path to the project root directory. */
  root: string;
  meta: ProjectMeta;
}

export interface CreateProjectOptions {
  root: string;
  name: string;
  author?: string;
  description?: string;
}

export interface FileSnapshotInfo {
  path: string;
  hash: string;
  mtimeMs: number;
}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yml', '.yaml']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '.DS_Store']);

/** True when a path inside a project is a readable text file. */
export function isTextFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(lower.slice(dot));
}

export class ProjectStore {
  constructor(
    private readonly fs: FsAdapter,
    readonly root: string,
    private meta: ProjectMeta,
  ) {}

  get projectMeta(): ProjectMeta {
    return this.meta;
  }

  /** Absolute path for a project-relative path, with containment enforced. */
  resolve(relativePath: string): string {
    try {
      return joinProjectPath(this.root, relativePath);
    } catch (error) {
      if (error instanceof PathTraversalError) {
        throw new StoryCodeError('PATH_UNSAFE', error.message, {
          attemptedPath: error.attemptedPath,
          reason: error.reason,
        });
      }
      throw error;
    }
  }

  /** Creates a new project skeleton on disk. Fails if STORY.md already exists. */
  static async create(fs: FsAdapter, options: CreateProjectOptions): Promise<ProjectStore> {
    const name = options.name.trim();
    if (name.length === 0) {
      throw new StoryCodeError('VALIDATION_FAILED', '小说名称不能为空');
    }
    const root = options.root.replace(/\/+$/, '');
    await fs.mkdirp(root);

    const storyPath = `${root}/${STORY_FILE}`;
    if (await fs.exists(storyPath)) {
      throw new StoryCodeError('ALREADY_EXISTS', `该目录已存在小说：${root}`);
    }

    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      id: createId('project'),
      name,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description ?? '',
      author: options.author ?? '',
    };

    for (const dir of REQUIRED_DIRS) {
      await fs.mkdirp(`${root}/${dir}`);
    }

    await fs.writeText(`${root}/${MANIFEST_FILE}`, serializeProjectManifest(meta));
    await fs.writeText(
      storyPath,
      [
        '---',
        `id: ${meta.id}`,
        'type: project',
        `name: ${JSON.stringify(name)}`,
        `createdAt: ${now}`,
        '---',
        '',
        `# ${name}`,
        '',
        '## 故事简介',
        '',
        '（在这里写下这个故事的一句话简介。）',
        '',
        '## 核心主题',
        '',
        '',
        '## 写作规则',
        '',
        '- 视角：',
        '- 语气：',
        '- 禁忌：',
        '',
      ].join('\n'),
    );

    return new ProjectStore(fs, root, meta);
  }

  /**
   * Reconstructs project metadata from what is on disk. Used when `project.json`
   * is missing or unreadable — the Markdown files, not the manifest, are the
   * authoritative record of the novel.
   */
  private static async rebuildManifest(fs: FsAdapter, root: string): Promise<ProjectMeta> {
    const now = new Date().toISOString();
    const fallbackName = root.split('/').filter(Boolean).pop() ?? '未命名小说';
    let name = fallbackName;
    let id = createId('project');
    let createdAt = now;
    let description = '';

    const storyRaw = await fs.readText(`${root}/${STORY_FILE}`).catch(() => null);
    if (storyRaw !== null) {
      try {
        const parsed = parseProjectManifest(storyRaw);
        name = parsed.name;
        id = parsed.id;
        createdAt = parsed.createdAt;
        description = parsed.description;
      } catch {
        // STORY.md frontmatter is optional; fall back to the directory name.
      }
    }

    return { id, name, schemaVersion: 1, createdAt, updatedAt: now, description, author: '' };
  }

  /** Opens an existing project, validating the manifest. */
  static async open(fs: FsAdapter, root: string): Promise<ProjectStore> {
    const normalizedRoot = root.replace(/\/+$/, '');
    const manifestPath = `${normalizedRoot}/${MANIFEST_FILE}`;
    if (!(await fs.exists(manifestPath))) {
      const storyPath = `${normalizedRoot}/${STORY_FILE}`;
      if (!(await fs.exists(storyPath))) {
        throw new NotFoundError(`小说项目（缺少 ${MANIFEST_FILE}）`, { root: normalizedRoot });
      }
      // Legacy/partial project: rebuild a manifest rather than refusing to open.
      const meta = await ProjectStore.rebuildManifest(fs, normalizedRoot);
      await fs.writeText(manifestPath, serializeProjectManifest(meta));
      return new ProjectStore(fs, normalizedRoot, meta);
    }
    const raw = await fs.readText(manifestPath);
    let meta: ProjectMeta;
    let damagedManifest = false;
    try {
      meta = parseProjectManifest(raw);
    } catch {
      // A corrupt manifest must never lock the author out of their novel. The
      // Markdown files are the source of truth, so rebuild the index metadata.
      damagedManifest = true;
      meta = await ProjectStore.rebuildManifest(fs, normalizedRoot);
      await fs.writeText(manifestPath, serializeProjectManifest(meta));
    }
    if (damagedManifest) {
      // Keep the damaged file for inspection instead of silently deleting it.
      await fs.writeText(`${normalizedRoot}/${META_DIR}/manifest.corrupt.json`, raw);
    }
    await fs.mkdirp(`${normalizedRoot}/${META_DIR}`);
    return new ProjectStore(fs, normalizedRoot, meta);
  }

  async touch(): Promise<void> {
    this.meta = { ...this.meta, updatedAt: new Date().toISOString() };
    await this.fs.writeText(`${this.root}/${MANIFEST_FILE}`, serializeProjectManifest(this.meta));
  }

  async updateMeta(patch: Partial<Omit<ProjectMeta, 'id'>>): Promise<ProjectMeta> {
    this.meta = { ...this.meta, ...patch, id: this.meta.id, updatedAt: new Date().toISOString() };
    await this.fs.writeText(`${this.root}/${MANIFEST_FILE}`, serializeProjectManifest(this.meta));
    return this.meta;
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.fs.exists(this.resolve(relativePath));
  }

  async readFile(relativePath: string): Promise<string> {
    const absolute = this.resolve(relativePath);
    try {
      return await this.fs.readText(absolute);
    } catch {
      throw new NotFoundError(`文件 ${relativePath}`, { path: relativePath });
    }
  }

  async fileHash(relativePath: string): Promise<string | null> {
    if (!(await this.exists(relativePath))) return null;
    const content = await this.readFile(relativePath);
    return contentHash(content);
  }

  /**
   * Writes a project file. When `expectedHash` is provided the write is refused
   * if the file changed on disk since the proposal was generated.
   */
  async writeFile(
    relativePath: string,
    content: string,
    options: { expectedHash?: string | null; createDirs?: boolean } = {},
  ): Promise<{ hash: string; created: boolean }> {
    const safePath = normalizeRelativePath(relativePath);
    const absolute = this.resolve(safePath);
    const existed = await this.fs.exists(absolute);

    if (options.expectedHash !== undefined && options.expectedHash !== null) {
      const currentHash = existed ? contentHash(await this.fs.readText(absolute)) : null;
      if (currentHash !== options.expectedHash) {
        throw new StoryCodeError('VERSION_CONFLICT', `文件已被修改：${safePath}`, {
          filePath: safePath,
          expectedHash: options.expectedHash,
          actualHash: currentHash,
        });
      }
    }

    if (options.createDirs !== false) {
      const dirIndex = safePath.lastIndexOf('/');
      if (dirIndex > 0) {
        await this.fs.mkdirp(this.resolve(safePath.slice(0, dirIndex)));
      }
    }

    await this.fs.writeText(absolute, content);
    return { hash: contentHash(content), created: !existed };
  }

  /**
   * Moves a file inside the project. Entity identity lives in the file's
   * frontmatter, so renaming must never change an id — callers re-index after.
   */
  async renameFile(relativePath: string, nextRelativePath: string): Promise<void> {
    const from = normalizeRelativePath(relativePath);
    const to = normalizeRelativePath(nextRelativePath);
    const absoluteFrom = this.resolve(from);
    const absoluteTo = this.resolve(to);
    if (!(await this.fs.exists(absoluteFrom))) {
      throw new NotFoundError(`文件 ${from}`, { path: from });
    }
    if (await this.fs.exists(absoluteTo)) {
      throw new StoryCodeError('ALREADY_EXISTS', `目标文件已存在：${to}`, { path: to });
    }
    const dirIndex = to.lastIndexOf('/');
    if (dirIndex > 0) {
      await this.fs.mkdirp(this.resolve(to.slice(0, dirIndex)));
    }
    await this.fs.rename(absoluteFrom, absoluteTo);
  }

  async deleteFile(
    relativePath: string,
    options: { expectedHash?: string | null } = {},
  ): Promise<void> {
    const safePath = normalizeRelativePath(relativePath);
    const absolute = this.resolve(safePath);
    if (!(await this.fs.exists(absolute))) {
      throw new NotFoundError(`文件 ${safePath}`, { path: safePath });
    }
    if (options.expectedHash !== undefined && options.expectedHash !== null) {
      const currentHash = contentHash(await this.fs.readText(absolute));
      if (currentHash !== options.expectedHash) {
        throw new StoryCodeError('VERSION_CONFLICT', `文件已被修改：${safePath}`, {
          filePath: safePath,
          expectedHash: options.expectedHash,
          actualHash: currentHash,
        });
      }
    }
    await this.fs.remove(absolute);
  }

  /** Lists every text file in the project, excluding `.storycode/`. */
  async listFiles(options: { includeMeta?: boolean } = {}): Promise<FileSnapshotInfo[]> {
    const results: FileSnapshotInfo[] = [];
    const walk = async (relativeDir: string): Promise<void> => {
      const absolute = relativeDir.length > 0 ? this.resolve(relativeDir) : this.root;
      const entries = await this.fs.readDir(absolute).catch((): DirEntry[] => []);
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('._')) continue;
        const childRelative = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          if (childRelative === META_DIR && options.includeMeta !== true) continue;
          await walk(childRelative);
        } else if (isTextFile(entry.name)) {
          const content = await this.fs.readText(this.resolve(childRelative)).catch(() => '');
          results.push({
            path: childRelative,
            hash: contentHash(content),
            mtimeMs: await this.fs.mtimeMs(this.resolve(childRelative)),
          });
        }
      }
    };
    await walk('');
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Builds the explorer tree, ordering chapters by their `order` metadata. */
  async buildTree(): Promise<FileNode[]> {
    const files = await this.listFiles();
    const rootNodes: FileNode[] = [];

    const dirMap = new Map<string, FileNode>();
    const ensureDir = (dirPath: string): FileNode => {
      const existing = dirMap.get(dirPath);
      if (existing) return existing;
      const node: FileNode = {
        kind: 'folder',
        path: dirPath,
        name: dirPath.split('/').pop() ?? dirPath,
        children: [],
      };
      dirMap.set(dirPath, node);
      const parentIndex = dirPath.lastIndexOf('/');
      if (parentIndex > 0) {
        ensureDir(dirPath.slice(0, parentIndex)).children?.push(node);
      } else {
        rootNodes.push(node);
      }
      return node;
    };

    for (const file of files) {
      const dirIndex = file.path.lastIndexOf('/');
      const dirPath = dirIndex > 0 ? file.path.slice(0, dirIndex) : '';
      const fileName = dirIndex > 0 ? file.path.slice(dirIndex + 1) : file.path;
      const kind = classifyPath(file.path);
      const node: FileNode = {
        kind:
          kind === 'chapter'
            ? 'chapter'
            : kind === 'character'
              ? 'character'
              : kind === 'world'
                ? 'world'
                : kind === 'plot'
                  ? 'plot'
                  : 'other',
        path: file.path,
        name: fileName.replace(/\.md$/, ''),
      };
      const order = chapterOrderFromPath(file.path);
      if (order !== null) node.chapterOrder = order;

      if (dirPath.length > 0) {
        ensureDir(dirPath).children?.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    const sortNodes = (nodes: FileNode[]): void => {
      nodes.sort((a, b) => {
        if (a.kind === 'chapter' && b.kind === 'chapter') {
          return (a.chapterOrder ?? 0) - (b.chapterOrder ?? 0);
        }
        if (a.kind === 'folder' && b.kind !== 'folder') return -1;
        if (a.kind !== 'folder' && b.kind === 'folder') return 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
      for (const node of nodes) {
        if (node.children) sortNodes(node.children);
      }
    };
    sortNodes(rootNodes);
    return rootNodes;
  }

  // ---- Chapters -----------------------------------------------------------

  async listChapters(): Promise<ChapterMeta[]> {
    const files = await this.listFiles();
    const chapters: ChapterMeta[] = [];
    for (const file of files) {
      const order = chapterOrderFromPath(file.path);
      if (order === null) continue;
      try {
        const doc = await this.readChapter(file.path);
        chapters.push(doc.meta);
      } catch {
        chapters.push({
          id: file.path,
          title: `第 ${order} 章`,
          order,
          status: 'draft',
          characterIds: [],
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        });
      }
    }
    return chapters.sort((a, b) => a.order - b.order);
  }

  async readChapter(relativePath: string): Promise<ChapterDocument> {
    const source = await this.readFile(relativePath);
    const order = chapterOrderFromPath(relativePath) ?? 1;
    return parseChapterDocument(relativePath, source, order);
  }

  async writeChapter(
    doc: ChapterDocument,
    options: { expectedHash?: string | null } = {},
  ): Promise<string> {
    const meta: ChapterMeta = { ...doc.meta, updatedAt: new Date().toISOString() };
    const content = serializeChapterDocument(meta, doc.body);
    const result = await this.writeFile(doc.path, content, options);
    return result.hash;
  }

  /** Next free chapter order and its path. */
  async nextChapterSlot(): Promise<{ order: number; path: string }> {
    const chapters = await this.listChapters();
    const maxOrder = chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0);
    const order = maxOrder + 1;
    return { order, path: `chapters/${String(order).padStart(3, '0')}.md` };
  }

  /** Creates a chapter file, refusing to overwrite an existing one. */
  async createChapter(options: {
    title: string;
    body?: string;
    order?: number;
  }): Promise<ChapterDocument> {
    const title =
      options.title.trim().length > 0 ? options.title.trim() : assertSafeName(options.title);
    const slot = await this.nextChapterSlot();
    const order = options.order ?? slot.order;
    if (!Number.isInteger(order) || order < 1) {
      throw new StoryCodeError('VALIDATION_FAILED', `章节序号无效：${order}`);
    }
    const path = `chapters/${String(order).padStart(3, '0')}.md`;
    if (await this.exists(path)) {
      throw new StoryCodeError('ALREADY_EXISTS', `第 ${order} 章已存在`, { path });
    }
    const now = new Date().toISOString();
    const doc: ChapterDocument = {
      path,
      meta: {
        id: createId('chapter'),
        title,
        order,
        status: 'draft',
        characterIds: [],
        createdAt: now,
        updatedAt: now,
      },
      body: options.body ?? `# ${title}\n\n`,
    };
    await this.writeFile(path, serializeChapterDocument(doc.meta, doc.body));
    return doc;
  }

  // ---- Project-wide text --------------------------------------------------

  async readStoryFile(): Promise<string> {
    return this.readFile(STORY_FILE);
  }

  async readFileOrNull(relativePath: string): Promise<string | null> {
    try {
      return await this.readFile(relativePath);
    } catch {
      return null;
    }
  }

  /** Directory listing for known content dirs, used by the explorer counts. */
  async listDirectory(relativeDir: string): Promise<DirEntry[]> {
    const entries = await this.fs.readDir(this.resolve(relativeDir)).catch((): DirEntry[] => []);
    return entries.filter((entry) => !entry.name.startsWith('._'));
  }

  get knownDirs(): readonly string[] {
    return Object.values(DIRS);
  }
}
