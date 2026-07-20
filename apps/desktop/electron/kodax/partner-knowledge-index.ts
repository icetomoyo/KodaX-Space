import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import {
  canonProjectRoot,
  partnerEvidenceLocatorSchema,
  type PartnerEvidenceLocatorT,
  type PartnerEvidenceUnitT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';

const INDEX_SCHEMA_VERSION = 2;
export const PARTNER_TOKENIZER_GENERATION = 'unicode-cjk-bigram-v1';
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 64;
const MAX_QUERY_CHARS = 2_000;
const isWindows = process.platform === 'win32';
const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'are',
  'do',
  'does',
  'for',
  'in',
  'is',
  'me',
  'of',
  'on',
  'please',
  'tell',
  'the',
  'to',
  'what',
  'who',
]);

export interface PartnerIndexedVersion {
  readonly sourceVersionId: string;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly parserGeneration: string;
  readonly current?: boolean;
}

export interface PartnerKnowledgeSearchOptions {
  readonly sourceIds?: readonly string[];
  readonly sourceVersionIds?: readonly string[];
  readonly currentOnly?: boolean;
  readonly limit?: number;
}

export interface PartnerKnowledgeSearchMatch {
  readonly chunkId: string;
  readonly unitId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly ordinal: number;
  readonly relativePath?: string;
  readonly locator: PartnerEvidenceLocatorT;
  readonly text: string;
  readonly rank: number;
}

function projectKey(projectRoot: string): string {
  return canonProjectRoot(projectRoot, isWindows);
}

function projectBucket(projectRoot: string): string {
  return createHash('sha256').update(projectKey(projectRoot)).digest('hex').slice(0, 32);
}

function tokenize(value: string, deduplicate = true): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  const tokens: string[] = [];
  const seen = new Set<string>();
  const add = (token: string): void => {
    if (!token || (deduplicate && seen.has(token))) return;
    if (deduplicate) seen.add(token);
    tokens.push(token);
  };
  for (const match of normalized.matchAll(/[\p{L}\p{N}_-]+/gu)) {
    const segment = match[0];
    const cjk = [...segment].every((char) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char),
    );
    if (!cjk) {
      add(segment);
      continue;
    }
    const characters = [...segment];
    for (const character of characters) add(character);
    for (let index = 0; index + 1 < characters.length; index += 1) {
      add(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return tokens;
}

export function normalizePartnerSearchText(value: string): string {
  return tokenize(value, false).join(' ');
}

function matchExpression(
  query: string,
): { expression: string; tokens: readonly string[]; quoted: boolean } | null {
  const bounded = query.slice(0, MAX_QUERY_CHARS).trim();
  const quoted = bounded.length >= 2 && bounded.startsWith('"') && bounded.endsWith('"');
  const tokenized = tokenize(quoted ? bounded.slice(1, -1) : bounded);
  const withoutStopWords = quoted
    ? tokenized
    : tokenized.filter((token) => !QUERY_STOP_WORDS.has(token));
  const rawTokens = withoutStopWords.length > 0 ? withoutStopWords : tokenized;
  const hasCjkBigram = rawTokens.some(
    (token) =>
      [...token].length > 1 &&
      [...token].every((char) =>
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char),
      ),
  );
  const tokens = hasCjkBigram
    ? rawTokens.filter(
        (token) =>
          [...token].length > 1 ||
          !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token),
      )
    : rawTokens;
  if (tokens.length === 0) return null;
  if (quoted) {
    return {
      expression: `"${tokens.join(' ').replace(/"/g, '""')}"`,
      tokens,
      quoted,
    };
  }
  return {
    expression: tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR '),
    tokens,
    quoted,
  };
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

function quarantineDerivedDatabase(dbPath: string): void {
  const suffix = `.corrupt-${Date.now()}`;
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (existsSync(candidate)) renameSync(candidate, `${candidate}${suffix}`);
    } catch {
      // Best effort: the subsequent open still fails closed if an alias cannot be moved.
    }
  }
}

export class PartnerKnowledgeIndex {
  private readonly databases = new Map<string, BetterSqlite3.Database>();

  constructor(
    private readonly rootDir: string = path.join(getSpaceDataDir(), 'partner-knowledge-indexes'),
  ) {}

  commitVersion(
    projectRoot: string,
    version: PartnerIndexedVersion,
    units: readonly PartnerEvidenceUnitT[],
  ): void {
    const db = this.database(projectRoot);
    const commit = db.transaction(() => {
      if (version.current !== false) {
        db.prepare('UPDATE source_versions SET current = 0 WHERE source_id = ?').run(
          version.sourceId,
        );
      }
      db.prepare(
        `INSERT INTO source_versions
          (source_version_id, source_id, content_hash, parser_generation, current, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_version_id) DO UPDATE SET
           source_id = excluded.source_id,
           content_hash = excluded.content_hash,
           parser_generation = excluded.parser_generation,
           current = excluded.current,
           indexed_at = excluded.indexed_at`,
      ).run(
        version.sourceVersionId,
        version.sourceId,
        version.contentHash,
        version.parserGeneration,
        version.current === false ? 0 : 1,
        Date.now(),
      );
      db.prepare('DELETE FROM chunks WHERE source_version_id = ?').run(version.sourceVersionId);
      const insert = db.prepare(
        `INSERT INTO chunks
          (chunk_id, unit_id, source_version_id, ordinal, relative_path, locator_json, raw_text, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const unit of units) {
        insert.run(
          `${version.sourceVersionId}:${unit.id}`,
          unit.id,
          version.sourceVersionId,
          unit.ordinal,
          unit.relativePath ?? null,
          JSON.stringify(unit.locator),
          unit.text,
          normalizePartnerSearchText(`${unit.relativePath ?? ''} ${unit.text}`),
        );
      }
    });
    commit();
  }

  hasVersion(projectRoot: string, sourceVersionId: string): boolean {
    const row = this.database(projectRoot)
      .prepare('SELECT 1 AS found FROM source_versions WHERE source_version_id = ? LIMIT 1')
      .get(sourceVersionId) as { found: number } | undefined;
    return row?.found === 1;
  }

  search(
    projectRoot: string,
    query: string,
    options: PartnerKnowledgeSearchOptions = {},
  ): PartnerKnowledgeSearchMatch[] {
    const match = matchExpression(query);
    if (!match) return [];
    const sourceIds = [...new Set(options.sourceIds ?? [])].slice(0, 512);
    const sourceVersionIds = [...new Set(options.sourceVersionIds ?? [])].slice(0, 512);
    if (options.sourceIds && sourceIds.length === 0) return [];
    if (options.sourceVersionIds && sourceVersionIds.length === 0) return [];
    const clauses = ['chunks_fts MATCH ?'];
    const params: Array<string | number> = [match.expression];
    if (options.currentOnly !== false) clauses.push('versions.current = 1');
    if (sourceIds.length > 0) {
      clauses.push(`versions.source_id IN (${placeholders(sourceIds.length)})`);
      params.push(...sourceIds);
    }
    if (sourceVersionIds.length > 0) {
      clauses.push(`versions.source_version_id IN (${placeholders(sourceVersionIds.length)})`);
      params.push(...sourceVersionIds);
    }
    const limit = Math.max(
      1,
      Math.min(Math.trunc(options.limit ?? DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT),
    );
    const candidateLimit = match.quoted ? limit : Math.min(MAX_SEARCH_LIMIT * 8, limit * 8);
    params.push(candidateLimit);
    const rows = this.database(projectRoot)
      .prepare(
        `SELECT chunks.chunk_id, chunks.unit_id, versions.source_id,
                versions.source_version_id, chunks.ordinal, chunks.relative_path,
                chunks.locator_json, chunks.raw_text, bm25(chunks_fts) AS rank
           FROM chunks_fts
           JOIN chunks ON chunks.rowid = chunks_fts.rowid
           JOIN source_versions AS versions
             ON versions.source_version_id = chunks.source_version_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY rank ASC, versions.source_id ASC, chunks.ordinal ASC, chunks.chunk_id ASC
          LIMIT ?`,
      )
      .all(...params) as Array<{
      chunk_id: string;
      unit_id: string;
      source_id: string;
      source_version_id: string;
      ordinal: number;
      relative_path: string | null;
      locator_json: string;
      raw_text: string;
      rank: number;
    }>;
    return rows
      .flatMap((row) => {
        const parsed = partnerEvidenceLocatorSchema.safeParse(JSON.parse(row.locator_json));
        if (!parsed.success) return [];
        const indexedTokens = new Set(tokenize(`${row.relative_path ?? ''} ${row.raw_text}`));
        const matchedTokens = match.tokens.filter((token) => indexedTokens.has(token)).length;
        return [
          {
            chunkId: row.chunk_id,
            unitId: row.unit_id,
            sourceId: row.source_id,
            sourceVersionId: row.source_version_id,
            ordinal: row.ordinal,
            ...(row.relative_path ? { relativePath: row.relative_path } : {}),
            locator: parsed.data,
            text: row.raw_text,
            rank: row.rank - matchedTokens / match.tokens.length,
          },
        ];
      })
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.sourceId.localeCompare(right.sourceId) ||
          left.ordinal - right.ordinal ||
          left.chunkId.localeCompare(right.chunkId),
      )
      .slice(0, limit);
  }

  close(): void {
    for (const db of this.databases.values()) db.close();
    this.databases.clear();
  }

  private database(projectRoot: string): BetterSqlite3.Database {
    const key = projectKey(projectRoot);
    const existing = this.databases.get(key);
    if (existing) return existing;
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(this.rootDir, `${projectBucket(projectRoot)}.sqlite`);
    let db: BetterSqlite3.Database | undefined;
    try {
      db = new DatabaseConstructor(dbPath);
      const integrity = db.pragma('quick_check', { simple: true });
      if (integrity !== 'ok') throw new Error('SQLite quick_check failed');
      this.initialize(db);
    } catch (_error) {
      try {
        db?.close();
      } catch {
        // Ignore close failures while quarantining a derived database.
      }
      quarantineDerivedDatabase(dbPath);
      db = new DatabaseConstructor(dbPath);
      this.initialize(db);
    }
    if (!db) throw new Error('Partner knowledge index could not be opened');
    this.databases.set(key, db);
    return db;
  }

  private initialize(db: BetterSqlite3.Database): void {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        schema_version INTEGER NOT NULL,
        tokenizer_generation TEXT NOT NULL,
        rebuilt_at INTEGER NOT NULL
      );
    `);
    const meta = db
      .prepare('SELECT schema_version, tokenizer_generation FROM index_meta LIMIT 1')
      .get() as { schema_version: number; tokenizer_generation: string } | undefined;
    if (
      meta &&
      (meta.schema_version !== INDEX_SCHEMA_VERSION ||
        meta.tokenizer_generation !== PARTNER_TOKENIZER_GENERATION)
    ) {
      db.exec(`
        DROP TABLE IF EXISTS chunks_fts;
        DROP TRIGGER IF EXISTS chunks_ai;
        DROP TRIGGER IF EXISTS chunks_ad;
        DROP TRIGGER IF EXISTS chunks_au;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS source_versions;
        DROP TABLE IF EXISTS retrieval_traces;
        DROP TABLE IF EXISTS citations;
        DELETE FROM index_meta;
      `);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_versions (
        source_version_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        parser_generation TEXT NOT NULL,
        current INTEGER NOT NULL CHECK(current IN (0, 1)),
        indexed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS source_versions_source_current
        ON source_versions(source_id, current);
      CREATE TABLE IF NOT EXISTS chunks (
        rowid INTEGER PRIMARY KEY,
        chunk_id TEXT NOT NULL UNIQUE,
        unit_id TEXT NOT NULL,
        source_version_id TEXT NOT NULL REFERENCES source_versions(source_version_id),
        ordinal INTEGER NOT NULL,
        relative_path TEXT,
        locator_json TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_source_version ON chunks(source_version_id, ordinal);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        search_text,
        content='chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, search_text)
          VALUES ('delete', old.rowid, old.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, search_text)
          VALUES ('delete', old.rowid, old.search_text);
        INSERT INTO chunks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
    `);
    if (!meta) {
      db.prepare(
        'INSERT INTO index_meta(schema_version, tokenizer_generation, rebuilt_at) VALUES (?, ?, ?)',
      ).run(INDEX_SCHEMA_VERSION, PARTNER_TOKENIZER_GENERATION, Date.now());
    } else {
      const count = db.prepare('SELECT COUNT(*) AS count FROM index_meta').get() as {
        count: number;
      };
      if (count.count === 0) {
        db.prepare(
          'INSERT INTO index_meta(schema_version, tokenizer_generation, rebuilt_at) VALUES (?, ?, ?)',
        ).run(INDEX_SCHEMA_VERSION, PARTNER_TOKENIZER_GENERATION, Date.now());
      }
    }
  }
}

export const partnerKnowledgeIndex = new PartnerKnowledgeIndex();
