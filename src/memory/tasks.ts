import type { Env } from '../env';
import { isoNow } from '../lib/util';

export interface Task {
  id: number;
  title: string;
  owner: string | null;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'done' | 'cancelled';
  source_entry_id: number | null;
  created_at: string;
}

export interface NewTask {
  title: string;
  owner?: string | null;
  due_date?: string | null;
  priority?: Task['priority'];
}

const COLS = 'id, title, owner, due_date, priority, status, source_entry_id, created_at';

export async function listOpenTasks(env: Env, limit = 50): Promise<Task[]> {
  const r = await env.DB.prepare(
    `SELECT ${COLS} FROM tasks WHERE status = 'open'
     ORDER BY due_date IS NULL, due_date, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id DESC LIMIT ?`,
  )
    .bind(limit)
    .all<Task>();
  return r.results;
}

export async function getTasks(env: Env, ids: number[]): Promise<Task[]> {
  if (!ids.length) return [];
  const r = await env.DB.prepare(`SELECT ${COLS} FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<Task>();
  return r.results;
}

export async function createTasks(env: Env, tasks: NewTask[], sourceEntryId: number | null): Promise<Task[]> {
  const now = isoNow();
  const out: Task[] = [];
  for (const t of tasks) {
    const r = await env.DB.prepare(
      'INSERT INTO tasks (title, owner, due_date, priority, source_entry_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(t.title, t.owner ?? null, t.due_date ?? null, t.priority ?? 'normal', sourceEntryId, now)
      .run();
    out.push({
      id: Number(r.meta.last_row_id),
      title: t.title,
      owner: t.owner ?? null,
      due_date: t.due_date ?? null,
      priority: t.priority ?? 'normal',
      status: 'open',
      source_entry_id: sourceEntryId,
      created_at: now,
    });
  }
  return out;
}

export async function setTaskStatus(env: Env, id: number, status: 'done' | 'cancelled' | 'open'): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ? AND status ${status === 'open' ? "<> 'open'" : "= 'open'"}`,
  )
    .bind(status, status === 'done' ? isoNow() : null, id)
    .run();
  return r.meta.changes > 0;
}

export async function insertDecisions(env: Env, items: string[], sourceEntryId: number | null) {
  if (!items.length) return;
  const now = isoNow();
  await env.DB.batch(
    items.map((c) =>
      env.DB.prepare('INSERT INTO decisions (content, source_entry_id, created_at) VALUES (?, ?, ?)').bind(c, sourceEntryId, now),
    ),
  );
}

export function formatDue(d: string | null) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}${y ? '/' + y.slice(2) : ''}`;
}

export function formatTask(t: Pick<Task, 'id' | 'title' | 'owner' | 'due_date' | 'priority'>, today?: string) {
  const overdue = today && t.due_date && t.due_date < today ? ' ⚠️quá hạn' : '';
  return `#${t.id} ${t.priority === 'high' ? '🔴 ' : ''}${t.title}${t.owner ? ` — ${t.owner}` : ''}${t.due_date ? ` — hạn ${formatDue(t.due_date)}${overdue}` : ''}`;
}
