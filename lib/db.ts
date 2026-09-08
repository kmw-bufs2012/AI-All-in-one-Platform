import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface JobRow {
  id: number;
  mode: string;
  model: string | null;
  prompt: string | null;
  attachments: string | null;
  usage: string | null;
  unit_price: string | null;
  cost: number | null;
  currency: string | null;
  /** "actual"(NanoGPT 응답에 실린 실제 청구액) | "estimated"(카탈로그 단가로 계산한 추정치) | null(레거시 행). */
  cost_source: string | null;
  status: string;
  result: string | null;
  created_at: string;
}

export interface PromptRow {
  id: number;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __allInOneDb: DatabaseSync | undefined;
}

function openDatabase(): DatabaseSync {
  const target = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    return new DatabaseSync(target);
  } catch {
    return new DatabaseSync(":memory:");
  }
}

function seedInitialUser(db: DatabaseSync): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as unknown as { n: number }).n;
  if (count > 0) return;
  const password = process.env.APP_PASSWORD;
  if (!password) return;
  const username = process.env.APP_USERNAME || "admin";
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
}

export function getDb(): DatabaseSync {
  if (!globalThis.__allInOneDb) {
    const db = openDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        model TEXT,
        prompt TEXT,
        attachments TEXT,
        usage TEXT,
        unit_price TEXT,
        cost REAL,
        currency TEXT,
        cost_source TEXT,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureCostSourceColumn(db);
    seedInitialUser(db);
    globalThis.__allInOneDb = db;
  }
  return globalThis.__allInOneDb;
}

/*
 * cost_source는 기존 jobs 테이블에 나중에 추가된 컬럼이라, 이미 만들어진
 * 데이터베이스 파일에는 CREATE TABLE IF NOT EXISTS만으로는 추가되지 않습니다.
 * PRAGMA로 존재를 확인한 뒤 없을 때만 ALTER TABLE로 더합니다.
 */
function ensureCostSourceColumn(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(jobs)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "cost_source")) {
    db.exec("ALTER TABLE jobs ADD COLUMN cost_source TEXT");
  }
}

export function findUserByUsername(db: DatabaseSync, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as UserRow | undefined;
}

export function insertJob(db: DatabaseSync, job: {
  mode: string;
  model: string | null;
  prompt: string | null;
  attachments: unknown;
  usage: unknown;
  unitPrice: unknown;
  cost: number | null;
  currency: string | null;
  costSource: string | null;
  status: string;
  result: unknown;
}): JobRow {
  const result = db.prepare(`
    INSERT INTO jobs (mode, model, prompt, attachments, usage, unit_price, cost, currency, cost_source, status, result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.mode,
    job.model,
    job.prompt,
    job.attachments === null || job.attachments === undefined ? null : JSON.stringify(job.attachments),
    job.usage === null || job.usage === undefined ? null : JSON.stringify(job.usage),
    job.unitPrice === null || job.unitPrice === undefined ? null : JSON.stringify(job.unitPrice),
    job.cost,
    job.currency,
    job.costSource,
    job.status,
    job.result === null || job.result === undefined ? null : JSON.stringify(job.result),
  );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow;
}

export function listJobs(db: DatabaseSync, filters: { mode?: string; date?: string; model?: string; limit?: number }): JobRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.mode) {
    clauses.push("mode = ?");
    params.push(filters.mode);
  }
  if (filters.date) {
    clauses.push("date(created_at) = ?");
    params.push(filters.date);
  }
  if (filters.model) {
    clauses.push("model = ?");
    params.push(filters.model);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 300;
  params.push(limit);
  return db.prepare(`SELECT * FROM jobs${where} ORDER BY id DESC LIMIT ?`).all(...params) as unknown as JobRow[];
}

export function insertPrompt(db: DatabaseSync, name: string, content: string): PromptRow {
  const result = db.prepare("INSERT INTO prompts (name, content) VALUES (?, ?)").run(name, content);
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as unknown as PromptRow;
}

export function listPrompts(db: DatabaseSync): PromptRow[] {
  return db.prepare("SELECT * FROM prompts ORDER BY updated_at DESC, id DESC").all() as unknown as PromptRow[];
}

export function findPrompt(db: DatabaseSync, id: number): PromptRow | undefined {
  return db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as unknown as PromptRow | undefined;
}

export function deletePrompt(db: DatabaseSync, id: number): boolean {
  const result = db.prepare("DELETE FROM prompts WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}