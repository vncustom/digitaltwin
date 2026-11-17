import type { Env } from '../env';
import { isoNow } from '../lib/util';

export type EntryKind = 'note' | 'meeting' | 'document' | 'request' | 'report';

export async function insertEntry(
  env: Env,
  e: { kind: EntryKind; content: string; title?: string | null; source?: string },
): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO entries (kind, title, content, source, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(e.kind, e.title ?? null, e.content, e.source ?? 'telegram', isoNow())
    .run();
  return Number(r.meta.last_row_id);
}

export async function updateEntryMeta(
  env: Env,
  id: number,
  m: { kind?: EntryKind; title?: string | null; summary?: string | null; processed: 1 | -1 },
) {
  await env.DB.prepare(
    'UPDATE entries SET kind = COALESCE(?, kind), title = COALESCE(?, title), summary = COALESCE(?, summary), processed = ? WHERE id = ?',
  )
    .bind(m.kind ?? null, m.title ?? null, m.summary ?? null, m.processed, id)
    .run();
}

export async function deleteEntry(env: Env, id: number) {
  const r = await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return r.meta.changes > 0;
}

export async function insertMessage(env: Env, role: 'user' | 'assistant', content: string) {
  await env.DB.prepare('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)')
    .bind(role, content.slice(0, 4000), isoNow())
    .run();
}
