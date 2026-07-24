export const GIT_CHANGES_STATUS_ARGS = [
  'status',
  '--porcelain=v1',
  '-b',
  '-z',
  '--untracked-files=all',
] as const;

export type GitChangeFile = {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U';
  staged: boolean;
};

export type ParsedGitChanges = {
  branch: string | null;
  files: GitChangeFile[];
  truncated: boolean;
};

function parseBranch(rawRecord: string): string {
  const body = rawRecord.slice(3);
  const dotsIndex = body.indexOf('...');
  const bracketIndex = body.indexOf(' [');
  const branchEnd = dotsIndex >= 0 ? dotsIndex : bracketIndex >= 0 ? bracketIndex : body.length;
  const branch = body.slice(0, branchEnd).trim();
  return branch.length > 0 ? branch.slice(0, 256) : 'HEAD';
}

function normalizeStatus(x: string, y: string): Pick<GitChangeFile, 'status' | 'staged'> {
  if (x === '?' && y === '?') return { status: 'U', staged: false };
  if (x === 'A' || y === 'A') return { status: 'A', staged: x === 'A' };
  if (x === 'D' || y === 'D') return { status: 'D', staged: x === 'D' };
  if (x === 'R' || y === 'R') return { status: 'R', staged: x === 'R' };
  if (x === 'M' || y === 'M') return { status: 'M', staged: x === 'M' };
  return { status: 'M', staged: x !== ' ' && x !== '?' };
}

/** Parse the NUL-delimited porcelain format so Git never quotes or escapes paths. */
export function parseGitChangesStatus(stdout: string): ParsedGitChanges {
  const records = stdout.split('\0');
  const files: GitChangeFile[] = [];
  let branch: string | null = null;
  let truncated = false;

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('## ')) {
      branch = parseBranch(record);
      continue;
    }
    if (files.length >= 200) {
      truncated = true;
      break;
    }
    if (record.length < 4) continue;

    const x = record.charAt(0);
    const y = record.charAt(1);
    const filePath = record.slice(3);
    // With -z, rename/copy destination comes first and the following record is the source path.
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') index++;
    if (filePath.length === 0 || filePath.length > 2048) continue;
    if (filePath.startsWith('..') || filePath.includes('\0')) continue;

    files.push({ path: filePath, ...normalizeStatus(x, y) });
  }

  return { branch, files, truncated };
}
