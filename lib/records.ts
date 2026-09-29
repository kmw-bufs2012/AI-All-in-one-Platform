import {
  deleteJob as sqliteDeleteJob,
  deletePrompt as sqliteDeletePrompt,
  getDb,
  insertJob as sqliteInsertJob,
  insertPrompt as sqliteInsertPrompt,
  listJobs as sqliteListJobs,
  listPrompts as sqliteListPrompts,
  type JobRow,
  type PromptRow,
} from "@/lib/db";
import { readJsonDoc, updateJsonDoc, usingR2 } from "@/lib/object-store";
import { kstDateKey } from "@/lib/time";

/*
 * 작업 기록(라이브러리·작업 기록 화면의 원본)과 프롬프트 저장소.
 *
 * Cloudflare R2 가 설정돼 있으면 R2 의 JSON 문서에 저장하고, 아니면 기존
 * SQLite(lib/db.ts)를 씁니다. 행 모양(JobRow·PromptRow)은 두 방식이 같아
 * API 라우트는 저장 위치를 신경 쓰지 않습니다.
 * - records/jobs.json     작업 기록(최신 MAX_JOBS 개)
 * - records/prompts.json  저장한 프롬프트
 * 계정(users) 정보는 로그인 확인용이라 지금처럼 SQLite·환경 변수로 둡니다.
 */

const JOBS_KEY = "records/jobs.json";
const PROMPTS_KEY = "records/prompts.json";
const MAX_JOBS = 5000;

/** SQLite datetime('now') 와 같은 "YYYY-MM-DD HH:MM:SS"(UTC) 형식. */
function sqliteNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export interface NewJob {
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
}

export async function insertJob(job: NewJob): Promise<JobRow> {
  if (!usingR2()) return sqliteInsertJob(getDb(), job);
  return updateJsonDoc<JobRow[], JobRow>(JOBS_KEY, [], (rows) => {
    const row: JobRow = {
      id: rows.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      mode: job.mode,
      model: job.model,
      prompt: job.prompt,
      attachments: json(job.attachments),
      usage: json(job.usage),
      unit_price: json(job.unitPrice),
      cost: job.cost,
      currency: job.currency,
      cost_source: job.costSource,
      status: job.status,
      result: json(job.result),
      created_at: sqliteNow(),
    };
    return { next: [row, ...rows].slice(0, MAX_JOBS), result: row };
  });
}

export async function listJobs(filters: { mode?: string; date?: string; model?: string; limit?: number }): Promise<JobRow[]> {
  if (!usingR2()) return sqliteListJobs(getDb(), filters);
  const rows = await readJsonDoc<JobRow[]>(JOBS_KEY, []);
  return rows
    .filter((row) => !filters.mode || row.mode === filters.mode)
    .filter((row) => !filters.date || kstDateKey(row.created_at) === filters.date)
    .filter((row) => !filters.model || row.model === filters.model)
    .sort((a, b) => b.id - a.id)
    .slice(0, filters.limit ?? 300);
}

export async function deleteJob(id: number): Promise<void> {
  if (!usingR2()) return sqliteDeleteJob(getDb(), id);
  await updateJsonDoc<JobRow[], void>(JOBS_KEY, [], (rows) => ({ next: rows.filter((row) => row.id !== id), result: undefined }));
}

export async function insertPrompt(name: string, content: string): Promise<PromptRow> {
  if (!usingR2()) return sqliteInsertPrompt(getDb(), name, content);
  return updateJsonDoc<PromptRow[], PromptRow>(PROMPTS_KEY, [], (rows) => {
    const now = sqliteNow();
    const row: PromptRow = {
      id: rows.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      name,
      content,
      created_at: now,
      updated_at: now,
    };
    return { next: [row, ...rows], result: row };
  });
}

export async function listPrompts(): Promise<PromptRow[]> {
  if (!usingR2()) return sqliteListPrompts(getDb());
  const rows = await readJsonDoc<PromptRow[]>(PROMPTS_KEY, []);
  return [...rows].sort((a, b) => (a.updated_at === b.updated_at ? b.id - a.id : a.updated_at < b.updated_at ? 1 : -1));
}

export async function deletePrompt(id: number): Promise<boolean> {
  if (!usingR2()) return sqliteDeletePrompt(getDb(), id);
  return updateJsonDoc<PromptRow[], boolean>(PROMPTS_KEY, [], (rows) => {
    const next = rows.filter((row) => row.id !== id);
    return { next, result: next.length !== rows.length };
  });
}
