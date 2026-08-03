// Project IPC handlers — F005.
//
// 4 个 invoke channel：list / openDialog / recent.add / recent.remove + project.gitStats。
// projectStore 持久化在 ~/.kodax/space/projects.json，main 端独占——renderer 永远不写文件。

import { BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import {
  GIT_CHANGES_STATUS_ARGS,
  GIT_VISIBLE_PATHSPEC_ARGS,
  parseGitChangesStatus,
  type GitChangeFile,
} from './project-git-changes.js';
import { projectStore } from '../projects/store.js';
import { resolveInsideProject, toPosixRelative } from './files-core.js';
import type { ProjectGitStatsDaily } from '@kodax-space/space-ipc-schema';

export function registerProjectChannels(): void {
  // project.list
  registerChannel('project.list', async () => {
    const projects = await projectStore.list();
    return { projects };
  });

  // project.openDialog
  // renderer 调这个 → main 调 OS 原生 picker → 返回用户选的 absolute path。
  // 用 focused window 作为 modal parent，picker 表现一致；fallback 到 frameless 模式（无 parent）。
  registerChannel('project.openDialog', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });

    if (result.canceled || result.filePaths.length === 0) {
      return { path: null };
    }
    return { path: result.filePaths[0] };
  });

  // project.recent.add
  // path 必须先过 validateProjectRoot（abs path / no NUL / no ..）——renderer 传来的
  // path 来源应当是 project.openDialog 的输出，但仍然在 IPC 边界再校验一次（防 renderer 篡改）。
  registerChannel('project.recent.add', async (input) => {
    const path = validateProjectRoot(input.path);
    const project = await projectStore.addOrBump(path);
    return { project };
  });

  // project.recent.remove
  registerChannel('project.recent.remove', async (input) => {
    const path = validateProjectRoot(input.path);
    const removed = await projectStore.remove(path);
    return { removed };
  });

  // project.recent.rename (F043 v0.1.8) — 改 displayName；不改文件夹。
  // 用 assertAllowed (跟 gitStats / fileSearch 等一致)：path 必须已在 allowlist 内，
  // 否则 throw → IPC envelope HANDLER_ERROR；rename/setArchived 本质上是改 allowlist
  // 内 existing entry 的元数据，对 path 不在 allowlist 的请求 fail loudly 而不是
  // 静默返 false（review HIGH 收尾：跟 channel family 行为一致 + 阻断 path-probing）。
  registerChannel('project.recent.rename', async (input) => {
    const path = await projectStore.assertAllowed(input.path);
    const renamed = await projectStore.rename(path, input.name);
    return { renamed };
  });

  // project.recent.setArchived (F043 v0.1.8) — 同上 assertAllowed
  registerChannel('project.recent.setArchived', async (input) => {
    const path = await projectStore.assertAllowed(input.path);
    const ok = await projectStore.setArchived(path, input.archived);
    return { ok };
  });

  // project.gitStats
  //
  // 用 child_process spawn git binary 聚合 commit / churn / 每日活跃度。不引入
  // simple-git 依赖（避免 +30MB deps；renderer 不直接调，main 边界做参数校验更严）。
  //
  // 安全：
  //   - projectRoot 走 projectStore.assertAllowed（F005 v0.1.5 allowlist）—— 必须是
  //     用户显式打开过的项目，renderer 即便发了 /etc 这类合法 abs path 也拒绝
  //   - git args 全部是固定常量 + 数字时间戳 — 没有 shell expansion 风险
  //   - 用 spawn (不是 exec)，arg array 直传，绕过 shell 解析
  //   - 5s 超时；非 git repo / git binary 缺失 / 命令失败 → 返回 isGitRepo:false + 全 0
  //
  // 缓存：mtime-based on .git/HEAD。本进程 module-level Map，5s 也够 dashboard 频繁切 range 用。
  registerChannel('project.gitStats', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const sinceDays = input.sinceDays;

    const cached = readGitStatsCache(projectRoot, sinceDays);
    if (cached) return cached;

    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      const fallback = makeEmptyGitStats();
      writeGitStatsCache(projectRoot, sinceDays, fallback);
      return fallback;
    }

    // git log args — `--since=N.days.ago` 只在 N != null 时加；否则跨整段历史
    const sinceArg = sinceDays !== null ? [`--since=${sinceDays}.days.ago`] : [];

    // 1) commits 数 + per-day histogram (date 短 ISO `%cs`)。
    //    `%H|%cs|%ae` 解析最便宜；按行扫一遍即可。
    const logFmt = await runGit(projectRoot, [
      'log',
      ...sinceArg,
      '--no-merges',
      '--pretty=format:%H|%cs|%ae',
    ]);
    if (!logFmt.ok) {
      const fallback = makeEmptyGitStats();
      fallback.isGitRepo = true; // 上一步证实是 repo，只是 log 失败
      writeGitStatsCache(projectRoot, sinceDays, fallback);
      return fallback;
    }

    const dailyMap = new Map<string, number>();
    const authorSet = new Set<string>();
    let commits = 0;
    for (const line of logFmt.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split('|');
      if (parts.length < 3) continue;
      const [, date, email] = parts;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
      }
      if (email) authorSet.add(email);
      commits++;
    }
    const dailyCommits: ProjectGitStatsDaily[] = Array.from(dailyMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-365);

    // 2) lines + filesChanged — `git log --numstat` 输出 "added\tdeleted\tpath" per file。
    //    binary 文件输出 "-\t-\tpath"，跳过。
    let linesAdded = 0;
    let linesDeleted = 0;
    const filesSet = new Set<string>();
    if (commits > 0) {
      const numstat = await runGit(projectRoot, [
        'log',
        ...sinceArg,
        '--no-merges',
        '--numstat',
        '--pretty=format:',
      ]);
      if (numstat.ok) {
        for (const line of numstat.stdout.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          const parts = trimmed.split('\t');
          if (parts.length < 3) continue;
          const [add, del, file] = parts;
          if (add !== '-') linesAdded += Number.parseInt(add, 10) || 0;
          if (del !== '-') linesDeleted += Number.parseInt(del, 10) || 0;
          if (file && file.length > 0) filesSet.add(file);
        }
      }
    }

    // 3) current branch
    let currentBranch: string | null = null;
    const branchRes = await runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branchRes.ok) {
      const b = branchRes.stdout.trim();
      if (b.length > 0 && b.length <= 256) currentBranch = b;
    }

    const result = {
      isGitRepo: true,
      commits,
      filesChanged: filesSet.size,
      linesAdded,
      linesDeleted,
      contributors: authorSet.size,
      dailyCommits,
      currentBranch,
    };
    writeGitStatsCache(projectRoot, sinceDays, result);
    return result;
  });

  // project.gitStatus — 工作区 dirty 状态轻量查询 (StashNotice 用)
  //
  // `git status --porcelain=v1 -b` 单次输出: 第一行 "## branch [ahead N, behind M]",
  // 后续每行 XY <path>:
  //   X = staged 状态 (M/A/D/R/C),   Y = worktree 状态 (M/D),  '??' = untracked
  // 统计四个 counter,**不**回 path (隐私 + DoS guard)。
  //
  // 缓存: module-level + 5s TTL, 同 gitStats; 用 projectRoot 作 key。
  registerChannel('project.gitStatus', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const cached = readGitStatusCache(projectRoot);
    if (cached) return cached;

    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      const fallback = {
        isGitRepo: false,
        dirty: false,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        branch: null,
      } as const;
      writeGitStatusCache(projectRoot, fallback);
      return fallback;
    }

    const status = await runGit(projectRoot, [
      'status',
      '--porcelain=v1',
      '-b',
      ...GIT_VISIBLE_PATHSPEC_ARGS,
    ]);
    if (!status.ok) {
      const fallback = {
        isGitRepo: true,
        dirty: false,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        branch: null,
      } as const;
      writeGitStatusCache(projectRoot, fallback);
      return fallback;
    }

    // 解析 stdout
    let modifiedCount = 0;
    let stagedCount = 0;
    let untrackedCount = 0;
    let branch: string | null = null;
    let ahead: number | undefined;
    let behind: number | undefined;

    const lines = status.stdout.split('\n');
    for (const rawLine of lines) {
      if (!rawLine) continue;
      if (rawLine.startsWith('## ')) {
        // "## main" / "## main...origin/main" / "## main...origin/main [ahead 2, behind 1]" / "## HEAD (no branch)"
        const body = rawLine.slice(3);
        const dotsIdx = body.indexOf('...');
        const bracketIdx = body.indexOf(' [');
        const branchEnd = dotsIdx >= 0 ? dotsIdx : bracketIdx >= 0 ? bracketIdx : body.length;
        const rawBranch = body.slice(0, branchEnd).trim();
        // 防 IPC schema max 256
        branch = rawBranch.length > 0 ? rawBranch.slice(0, 256) : 'HEAD';
        if (bracketIdx >= 0) {
          const trail = body.slice(bracketIdx + 2, body.endsWith(']') ? -1 : undefined);
          const aheadMatch = /ahead (\d+)/.exec(trail);
          const behindMatch = /behind (\d+)/.exec(trail);
          if (aheadMatch) ahead = Math.min(parseInt(aheadMatch[1], 10), 1_000_000);
          if (behindMatch) behind = Math.min(parseInt(behindMatch[1], 10), 1_000_000);
        }
        continue;
      }
      if (rawLine.startsWith('??')) {
        untrackedCount++;
        continue;
      }
      // XY <path>: char[0] = staged, char[1] = worktree。 空格代表无该侧改动。
      const x = rawLine.charAt(0);
      const y = rawLine.charAt(1);
      if (x !== ' ' && x !== '?') stagedCount++;
      if (y !== ' ' && y !== '?') modifiedCount++;
    }

    const result = {
      isGitRepo: true,
      dirty: modifiedCount + stagedCount + untrackedCount > 0,
      modifiedCount,
      stagedCount,
      untrackedCount,
      branch,
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
    };
    writeGitStatusCache(projectRoot, result);
    return result;
  });

  // project.gitChanges — F041 v0.1.4 右侧栏 Changes 节用
  //
  // 跑 `git status --porcelain=v1 -b -z`，用 NUL 分隔保证路径不被 Git 引号/转义。
  // 200 上限 + truncated 标志；走 projectStore.assertAllowed allowlist + runGit + 5s TTL cache。
  registerChannel('project.gitChanges', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const cached = readGitChangesCache(projectRoot);
    if (cached) return cached;

    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      const fallback: GitChangesOutput = {
        isGitRepo: false,
        branch: null,
        files: [],
        truncated: false,
      };
      writeGitChangesCache(projectRoot, fallback);
      return fallback;
    }

    const status = await runGit(projectRoot, GIT_CHANGES_STATUS_ARGS);
    if (!status.ok) {
      const fallback: GitChangesOutput = {
        isGitRepo: true,
        branch: null,
        files: [],
        truncated: false,
      };
      writeGitChangesCache(projectRoot, fallback);
      return fallback;
    }

    const result = { isGitRepo: true, ...parseGitChangesStatus(status.stdout) };
    writeGitChangesCache(projectRoot, result);
    return result;
  });

  // project.gitDiff — /review slash 命令拿当前工作区改动
  //
  // `git diff HEAD` 包含 staged + 未 staged 改动 (相对最近一次 commit)。 untracked 文件不含,
  // 如果想纳入 untracked 还得 git diff --no-index /dev/null <file>,先省略,只关心已 tracked 的改动。
  // 64KB 上限: 超出 runGit 的 stdout cap 在 maxBuffer 处自动截断,这里再 truncate 一次填 schema。
  registerChannel('project.gitDiff', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      return { isGitRepo: false, diff: '', truncated: false, error: null };
    }
    // --no-color: 避免 ANSI 染色字符进 schema; --unified=3: 默认上下文够阅读
    const diffResult = await runGit(projectRoot, ['diff', '--no-color', '--unified=3', 'HEAD']);
    if (!diffResult.ok) {
      // git diff 失败 — 区分于"无改动"返回 error 让 UI 报错而不是误显示"无改动" (审查 M2)
      return {
        isGitRepo: true,
        diff: '',
        truncated: false,
        error: 'git diff failed (timeout / spawn error)',
      };
    }
    const MAX = 65_536;
    if (diffResult.stdout.length > MAX) {
      return {
        isGitRepo: true,
        diff: diffResult.stdout.slice(0, MAX),
        truncated: true,
        error: null,
      };
    }
    return { isGitRepo: true, diff: diffResult.stdout, truncated: false, error: null };
  });

  // F044 (v0.1.10): project.gitFileDiff — 单文件 working tree vs HEAD diff。
  //
  // 跟 files.diff (tool-call cache) 是两条独立语义:tool-call 是"AI 改那一瞬"
  // 的瞬时 before/after, gitFileDiff 是"当前 working tree vs HEAD". DiffPanel
  // 优先 tool-call, miss 时 fallback 到本 IPC. 历史 session 永远 fall through
  // 到本 IPC (cache 不在本进程)。
  //
  // 安全:
  //   - projectStore.assertAllowed 验 projectRoot allowlist
  //   - resolveInsideProject 同 files.read,防 path traversal
  //   - spawn git 用 shell:false + 数组 args,不走 shell
  //   - 1 MB 单 file cap (Monaco diff super-long file 没意义)
  //   - Binary detection: 读前 8KB 看 NUL byte,跟 git 自己 heuristic 一致
  registerChannel('project.gitFileDiff', async (input) => {
    const root = await projectStore.assertAllowed(input.projectRoot);
    const realRoot = await fs.realpath(root);

    // F044 review MEDIUM-1 fix: resolveInsideProject 做双 realpath 检查 (lexical +
    // symlink-resolved 两轮 isPathInside),防 symlink-escape 读 projectRoot 外文件。
    // 之前 inline 只做 lexical 检查,attacker 在 projectRoot 内放 symlink 指向外面
    // 任意文件就能让 handler readFile 那个文件返给 renderer。
    // ENOENT 时 resolveInsideProject return target (尚未存在),deleted file 路径走这条。
    let target: string;
    try {
      target = await resolveInsideProject(root, input.path);
    } catch {
      // path escapes / NUL byte 等 → 不暴露原始 path,统一返 no-such-file
      // (review LOW-1 顺手 fix: 不再回显 input.path 让 caller 反射)
      return {
        available: false,
        before: '',
        after: '',
        reason: 'no-such-file' as const,
      };
    }
    const relPosix = toPosixRelative(target, realRoot);

    // 是 git repo 吗?
    const isRepoCheck = await runGit(realRoot, ['rev-parse', '--git-dir']);
    if (!isRepoCheck.ok) {
      return {
        available: false,
        before: '',
        after: '',
        reason: 'not-a-git-repo' as const,
      };
    }

    // working tree 当前内容 (binary detect 前先读 head 字节)
    let after = '';
    let isBinaryDetected = false;
    let workingTreeExists = true;
    try {
      const handle = await fs.open(target, 'r');
      try {
        // Binary heuristic: 前 8KB 含 NUL byte = binary
        const headBuf = Buffer.allocUnsafe(8192);
        const { bytesRead } = await handle.read(headBuf, 0, 8192, 0);
        const head = headBuf.subarray(0, bytesRead);
        if (head.includes(0)) {
          isBinaryDetected = true;
        }
      } finally {
        await handle.close();
      }
      if (!isBinaryDetected) {
        // 大文件 cap: 超 1 MB 拒绝 (跟 schema MAX 一致)
        const stat = await fs.stat(target);
        if (stat.size > 1_048_576) {
          return {
            available: false,
            before: '',
            after: '',
            reason: 'file-too-large' as const,
          };
        }
        after = await fs.readFile(target, 'utf-8');
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        workingTreeExists = false;
      } else {
        return {
          available: false,
          before: '',
          after: '',
          reason: 'no-such-file' as const,
        };
      }
    }

    if (isBinaryDetected) {
      return {
        available: false,
        before: '',
        after: '',
        isBinary: true,
        reason: 'is-binary' as const,
      };
    }

    // HEAD:<relPosix> 内容. file 在 HEAD 不存在 = untracked.
    // F044 review MEDIUM-2 fix: relPosix 含 colon 的合法文件名 (e.g. build:output.ts) 让 git
    // 把 'HEAD:a:b' 当成 revision expression 错误解析。`./` 前缀强制 tree-path 语义。
    const showRes = await runGit(realRoot, ['show', `HEAD:./${relPosix}`]);
    let before = '';
    let isUntracked = false;
    if (showRes.ok) {
      before = showRes.stdout;
      // git show 返出的 trailing newline 跟文件 raw 一致,不动
    } else {
      // 失败的原因可能多种:HEAD 不存在 (空 repo) / file 不在 HEAD (untracked)
      isUntracked = true;
    }

    if (!workingTreeExists && !isUntracked) {
      // deleted file: working tree 没了,HEAD 还在 → before=HEAD,after=''
    }

    return {
      available: true,
      before,
      after,
      ...(isUntracked ? { isUntracked: true } : {}),
      reason: 'ok' as const,
    };
  });

  // project.fileSearch — @path autocomplete 后端
  //
  // 实现:
  //   1) Module-level cache: projectRoot → { ts, paths[] }; 30s TTL。命中直接 filter。
  //   2) Cache miss: walkProjectFiles 异步遍历, 跳过 IGNORED_DIRS, 上限 50_000 文件。
  //   3) Query substring 大小写不敏感; 排序: 1) basename 命中 2) path 命中 3) 字典序。
  //
  // 性能: 50k 文件的子串扫 ~5-15ms, popover 体感秒级以下。
  registerChannel('project.fileSearch', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const limit = input.limit ?? 30;
    const query = input.query.trim().toLowerCase();

    let paths: readonly string[];
    const cached = fileSearchCache.get(projectRoot);
    if (cached && Date.now() - cached.ts < FILE_SEARCH_TTL_MS) {
      paths = cached.paths;
    } else {
      const raw = await walkProjectFiles(projectRoot, FILE_SEARCH_HARD_CAP).catch(() => []);
      // 入 cache 前 pre-sort: BFS walk 顺序不是字典序,如果搜索 loop 早退会丢前面应该
      // 排序到顶的项 (审查 M4)。一次性 sort 50k 字符串 ~10-20ms,缓存命中后零成本。
      raw.sort();
      paths = raw;
      fileSearchCache.set(projectRoot, { ts: Date.now(), paths });
      // LRU 兜底防 cache 涨爆
      while (fileSearchCache.size > 16) {
        const k = fileSearchCache.keys().next().value;
        if (k === undefined) break;
        fileSearchCache.delete(k);
      }
    }

    // 空 query → 前 N 个 (alphabetical) 给 user 一个起步清单
    if (query.length === 0) {
      const out = paths.slice(0, limit);
      return { paths: [...out], truncated: paths.length > limit };
    }

    // 过滤 + 排序: basename 命中优先于 path 命中。paths 已预排序,扫一遍即得到
    // 字典序的 basenameHits / pathHits。**不早退** — 否则可能漏掉后段优先级更高
    // 的项 (审查 M4)。50k 字符串扫一遍 ~5-15ms,对 UI 可接受。
    const basenameHits: string[] = [];
    const pathHits: string[] = [];
    for (const p of paths) {
      const base = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
      if (base.includes(query)) {
        basenameHits.push(p);
      } else if (p.toLowerCase().includes(query)) {
        pathHits.push(p);
      }
    }
    const merged = [...basenameHits, ...pathHits];
    const truncated = merged.length > limit;
    return { paths: merged.slice(0, limit), truncated };
  });
}

// ---- project.fileSearch cache + walker ----

const FILE_SEARCH_TTL_MS = 30_000;
const FILE_SEARCH_HARD_CAP = 50_000;
const fileSearchCache = new Map<string, { ts: number; paths: readonly string[] }>();

// 启发式跳过: 不扫这些目录(performance + 内容不会被 @path 引用)
const IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.coverage',
  '.pytest_cache',
]);

/** Walk projectRoot 收集 posix 相对路径,跳过 IGNORED_DIRS。BFS 限上限文件数。 */
async function walkProjectFiles(root: string, hardCap: number): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = ['']; // 相对路径,空串 = root 本身
  while (queue.length > 0 && results.length < hardCap) {
    const rel = queue.shift()!;
    const absDir = rel === '' ? root : path.join(root, rel);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue; // permissions / 不存在 — 静默跳过
    }
    for (const ent of entries) {
      if (results.length >= hardCap) break;
      const childRel = rel === '' ? ent.name : `${rel}/${ent.name}`;
      // 显式跳 symlink: 任何 link (无论指 dir / file / 其他) 都不走入,防 cycle (审查 M1)。
      // node_modules/.bin 内的 symlink 链 + monorepo 跨链都会触发,不 skip 会无限循环。
      // skip 后用户在 picker 里看不到 link target,但相对于死循环这是可接受 trade-off。
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.')) {
          // 隐藏目录(.something) 多数也跳过,但 .kodax / .github 等用户可能想引用 → 白名单
          if (ent.name !== '.kodax' && ent.name !== '.github') continue;
        }
        queue.push(childRel);
      } else if (ent.isFile()) {
        results.push(childRel);
      }
      // sockets / FIFO 等其他类型自动 fall-through 不处理
    }
  }
  return results;
}

// gitStatus cache (类比 gitStats 但 key 更简单 — 不带 sinceDays)
type GitStatusOutput = {
  isGitRepo: boolean;
  dirty: boolean;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  branch: string | null;
  ahead?: number;
  behind?: number;
};
const GIT_STATUS_TTL_MS = 5_000;
const gitStatusCache = new Map<string, { ts: number; data: GitStatusOutput }>();
function readGitStatusCache(projectRoot: string): GitStatusOutput | null {
  const entry = gitStatusCache.get(projectRoot);
  if (!entry) return null;
  if (Date.now() - entry.ts > GIT_STATUS_TTL_MS) {
    gitStatusCache.delete(projectRoot);
    return null;
  }
  return entry.data;
}
function writeGitStatusCache(projectRoot: string, data: GitStatusOutput): void {
  gitStatusCache.set(projectRoot, { ts: Date.now(), data });
  // module 级缓存,避免无限增长
  if (gitStatusCache.size > 32) {
    const firstKey = gitStatusCache.keys().next().value;
    if (firstKey !== undefined) gitStatusCache.delete(firstKey);
  }
}

// F041 gitChanges cache —— 5s TTL，同 gitStatus 模式独立 map（两者 schema 不同）
type GitChangesOutput = {
  isGitRepo: boolean;
  branch: string | null;
  files: GitChangeFile[];
  truncated: boolean;
};
const GIT_CHANGES_TTL_MS = 5_000;
const gitChangesCache = new Map<string, { ts: number; data: GitChangesOutput }>();
function readGitChangesCache(projectRoot: string): GitChangesOutput | null {
  const entry = gitChangesCache.get(projectRoot);
  if (!entry) return null;
  if (Date.now() - entry.ts > GIT_CHANGES_TTL_MS) {
    gitChangesCache.delete(projectRoot);
    return null;
  }
  return entry.data;
}
function writeGitChangesCache(projectRoot: string, data: GitChangesOutput): void {
  gitChangesCache.set(projectRoot, { ts: Date.now(), data });
  if (gitChangesCache.size > 32) {
    const firstKey = gitChangesCache.keys().next().value;
    if (firstKey !== undefined) gitChangesCache.delete(firstKey);
  }
}

// ---- git child_process helper ----

interface GitRunResult {
  ok: boolean;
  stdout: string;
}

/**
 * spawn git with safety knobs：
 *   - shell:false 关掉 shell injection 表面
 *   - 5s 超时——dashboard 是 UI 路径，不该被恶意 / 巨型 repo 卡住
 *   - 1MB stdout 上限（histogram 365 行 / numstat 大 repo 也够）；超过截断不抛
 */
async function runGit(cwd: string, args: readonly string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let truncated = false;
    const MAX_BYTES = 1_048_576;
    let timer: NodeJS.Timeout | null = null;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    } catch {
      resolve({ ok: false, stdout: '' });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, stdout });
    }, 5_000);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => {
      if (truncated) return;
      if (stdout.length + text.length > MAX_BYTES) {
        stdout += text.slice(0, MAX_BYTES - stdout.length);
        truncated = true;
      } else {
        stdout += text;
      }
    });

    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, stdout });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, stdout });
    });
  });
}

function makeEmptyGitStats(): {
  isGitRepo: boolean;
  commits: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  contributors: number;
  dailyCommits: ProjectGitStatsDaily[];
  currentBranch: string | null;
} {
  return {
    isGitRepo: false,
    commits: 0,
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    contributors: 0,
    dailyCommits: [],
    currentBranch: null,
  };
}

// ---- module-level mtime cache ----
//
// dashboard 频繁切 range tab（All / 30d / 7d）会重复打这个 channel；5s TTL 让连点不
// 真跑 git。key=`${projectRoot}|${sinceDays}` —— 同 root 不同 range 独立缓存。

interface CacheEntry {
  ts: number;
  value: Awaited<ReturnType<typeof makeEmptyGitStats>>;
}
const gitStatsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000;

function cacheKey(projectRoot: string, sinceDays: number | null): string {
  return `${projectRoot}|${sinceDays ?? 'all'}`;
}

function readGitStatsCache(
  projectRoot: string,
  sinceDays: number | null,
): CacheEntry['value'] | null {
  const entry = gitStatsCache.get(cacheKey(projectRoot, sinceDays));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    gitStatsCache.delete(cacheKey(projectRoot, sinceDays));
    return null;
  }
  return entry.value;
}

function writeGitStatsCache(
  projectRoot: string,
  sinceDays: number | null,
  value: CacheEntry['value'],
): void {
  // 简单 LRU-ish：超 32 条干脆全清，dashboard 用量小不值得做精细 LRU
  if (gitStatsCache.size > 32) gitStatsCache.clear();
  gitStatsCache.set(cacheKey(projectRoot, sinceDays), { ts: Date.now(), value });
}
