// ProjectStore — 持久化"用户最近打开的项目"到 ~/.kodax/space/projects.json。
//
// 设计：
//   - 单一文件，原子写（写 tmp → rename），防进程中途崩了损坏 JSON
//   - 内存缓存 + write-through——读频率远高于写
//   - 不存绝对路径以外的任何元数据（不缓存 git status / file count 等可变状态）
//   - schema 损坏时不抛错，回滚到空列表 + 旁路 log

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { validateProjectRoot, truncateForError } from '../ipc/validate.js';
import { getSpaceDataDir } from '../kodax/data-paths.js';
import { replaceFileWithoutFollowingAliases } from '../kodax/atomic-file.js';

const IS_WIN = process.platform === 'win32';

// 注：与 KodaX CLI 共享 ~/.kodax 根，但 Space 自己的目录是 ~/.kodax/space/。
// 与 KodaX session JSONL 完全隔离，避免一方误删另一方文件。
// OC-12 测试模式 (KODAX_TEST_ONBOARDING) 下 getSpaceDataDir() 返 tmpdir 隔离目录。
const SPACE_DATA_DIR = getSpaceDataDir();
const PROJECTS_FILE = path.join(SPACE_DATA_DIR, 'projects.json');

const fileSchema = z.object({
  version: z.literal(1),
  projects: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      addedAt: z.number().int().nonnegative(),
      lastUsedAt: z.number().int().nonnegative(),
      /** F043: 归档项目默认在 LeftSidebar 隐藏。omit when false (清洁序列化)。 */
      archived: z.boolean().optional(),
    }),
  ),
});

export type Project = z.infer<typeof fileSchema>['projects'][number];

export class ProjectStore {
  private cached: Project[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = PROJECTS_FILE,
    private readonly dir: string = SPACE_DATA_DIR,
  ) {}

  async list(): Promise<Project[]> {
    if (this.cached) return [...this.cached];
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ProjectStore] ${this.filePath} schema invalid, starting empty:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        this.cached = [];
      } else {
        // 文件可能被外部（别的进程 / 攻击者 / 手工编辑）写入畸形 path——
        // schema 只确保字符串；不验证语义。这里再过一遍 validateProjectRoot 把
        // 非绝对 / 含 .. / 含 NUL 的条目 drop 掉。filename basename 是显示用的，
        // 不影响实际打开行为（实际打开走 IPC 边界还会再 validate 一次）。
        this.cached = parsed.data.projects.filter((p) => {
          try {
            validateProjectRoot(p.path);
            return true;
          } catch (err) {
            console.warn(
              `[ProjectStore] dropping invalid entry: ${err instanceof Error ? err.message : String(err)}`,
            );
            return false;
          }
        });
      }
    } catch (err) {
      // ENOENT = 首次启动；其他错误也按"启动空列表"处理，写新文件时会覆盖
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[ProjectStore] read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.cached = [];
    }
    return [...this.cached];
  }

  /**
   * F005 v0.1.5：**allowlist 版**的 projectRoot 校验 — 用户必须显式打开过该路径才放行。
   *
   * 流程：
   *   1. validateProjectRoot 做 shape 检查（绝对路径 / no '..' / no NUL）
   *   2. 规范化后跟 store 里每条项目做 canonProjectRoot 比较（Windows 大小写 + 分隔符兼容）
   *   3. 找不到 → throw，让 registerChannel 转 HANDLER_ERROR envelope
   *
   * 用于所有"基于 projectRoot 起 child_process / 读文件 / 列目录"的 IPC handler：
   *   - project.gitStats / gitStatus / gitChanges / gitDiff （spawn git）
   *   - project.fileSearch（递归 readdir）
   *   - files.tree / files.read（目录 + 文件读取）
   *   - session.list 的 projectRoot filter
   *
   * 不用：project.recent.add / remove 这种"操作 allowlist 自身"的 handler。
   *
   * 跟 validateProjectRoot 的边界差异：renderer 即便发了合法绝对路径（如 /etc），
   * 没在 allowlist 里就是拒绝 — 阻断 renderer compromise / dev-console 滥用面。
   *
   * @returns normalized 安全路径
   * @throws Error 含原文 truncate 的 prefix（不带完整 path，免日志泄露）
   */
  async assertAllowed(input: string): Promise<string> {
    const normalized = validateProjectRoot(input);
    const targetCanon = canonProjectRoot(normalized, IS_WIN);
    const projects = await this.list();
    const isAllowed = projects.some((p) => canonProjectRoot(p.path, IS_WIN) === targetCanon);
    if (!isAllowed) {
      throw new Error(`projectRoot not in recent projects allowlist: ${truncateForError(input)}`);
    }
    return normalized;
  }

  /**
   * 加入或刷新最近项目。已存在的 path 只更新 lastUsedAt，不改 addedAt / name。
   * 返回更新后的 Project 对象。
   */
  async addOrBump(absPath: string): Promise<Project> {
    return this.mutate((list) => {
      const now = Date.now();
      const existingIdx = list.findIndex((p) => p.path === absPath);
      if (existingIdx >= 0) {
        const project: Project = { ...list[existingIdx], lastUsedAt: now };
        list[existingIdx] = project;
        return { list, ret: project };
      }
      const project: Project = {
        path: absPath,
        name: path.basename(absPath) || absPath,
        addedAt: now,
        lastUsedAt: now,
      };
      list.unshift(project);
      return { list, ret: project };
    });
  }

  async remove(absPath: string): Promise<boolean> {
    return this.mutate((list) => {
      const before = list.length;
      const next = list.filter((p) => p.path !== absPath);
      if (next.length === before) return { list, ret: false };
      return { list: next, ret: true };
    });
  }

  /** F043: 改 displayName (`project.name`)。不影响文件夹。
   *  返回 false 表示该 path 不在 store（不存在或已被 remove）。*/
  async rename(absPath: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return false;
    return this.mutate((list) => {
      const idx = list.findIndex((p) => p.path === absPath);
      if (idx < 0) return { list, ret: false };
      // 不可变 spread — 项目内 immutability 风格
      const next = [...list];
      next[idx] = { ...next[idx]!, name: trimmed };
      return { list: next, ret: true };
    });
  }

  /** F043: 切归档。归档后 LeftSidebar 默认隐藏，仍可显式 toggle 显示。*/
  async setArchived(absPath: string, archived: boolean): Promise<boolean> {
    return this.mutate((list) => {
      const idx = list.findIndex((p) => p.path === absPath);
      if (idx < 0) return { list, ret: false };
      const next = [...list];
      // archived=false 时 omit 字段 (跟"从来没归档过的项目"序列化一致，文件干净)
      const prev = next[idx]!;
      next[idx] = archived
        ? { ...prev, archived: true }
        : { path: prev.path, name: prev.name, addedAt: prev.addedAt, lastUsedAt: prev.lastUsedAt };
      return { list: next, ret: true };
    });
  }

  /** 测试用：丢内存 cache 强制下次 list 重新读盘。*/
  invalidate(): void {
    this.cached = null;
  }

  /**
   * 串行化"读-改-写"。两个并发 caller 必须按 enqueue 顺序拿到最新 cache 再修改，
   * 不能各自 snapshot 然后最后写的赢——那样会丢前面的写。
   *
   * 实现：把整个"读 cache + apply mutation + persist"塞进同一个 lock，
   * lock 用 promise 链。每个调用排到链尾，wait 前一个完成后再跑。
   */
  private async mutate<R>(apply: (list: Project[]) => { list: Project[]; ret: R }): Promise<R> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const current = await this.list();
      const { list, ret } = apply([...current]); // copy 防 mutation 泄露
      this.cached = list;
      await this.persistLocked(list);
      return ret;
    } finally {
      release();
    }
  }

  /** 已经持锁的写入。**不**自己再持锁——只能从 mutate() 调。*/
  private async persistLocked(list: Project[]): Promise<void> {
    // mode 0o700 / 0o600：projects.json 含用户项目路径，可能泄露 proprietary 代码名等。
    // Windows 忽略 mode，POSIX 强制 user-only。
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ version: 1, projects: list }, null, 2);
    await replaceFileWithoutFollowingAliases(
      this.filePath,
      Buffer.from(payload, 'utf8'),
      'projects registry changed during atomic replacement',
    );
  }
}

// 单例。main 端各 handler 通过 import 这个实例操作。
// 测试时也可以 new ProjectStore(tmpPath) 用独立路径，但建议直接复用单例 + invalidate()。
export const projectStore = new ProjectStore();

/** 测试用：可注入自定义路径的 store。*/
export function createProjectStore(filePath: string, dir: string): ProjectStore {
  return new ProjectStore(filePath, dir);
}
