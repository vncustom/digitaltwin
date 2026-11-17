import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from '../env';
import { Layout, PostButton } from './layout';
import { checkKey, clearFails, clearSession, createSession, isLocked, recordFail, requireAdmin } from './auth';
import {
  SECTIONS,
  SECTION_LABEL,
  addCore,
  editCore,
  isSection,
  listCore,
  renderCore,
  setCoreStatus,
  CORE_BUDGET,
  MAX_CORE_ITEM,
  type CoreItem,
} from '../memory/core';
import { formatDue, setTaskStatus, type Task } from '../memory/tasks';
import { hybridSearch } from '../memory/search';
import { deleteEntryVectors, indexEntrySafe } from '../memory/vectors';
import { deleteEntry } from '../db/entries';
import { notifyEnabled, setNotify } from '../cron';
import { markdownToTelegramHtml } from '../telegram/api';
import { isoNow, localDate } from '../lib/util';
import { raw } from 'hono/html';
import { MODEL_CHOICES, getModel, switchModel } from '../brain/gemini';

type C = Context<AppEnv>;
export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('x-frame-options', 'DENY');
  c.header('x-content-type-options', 'nosniff');
  // same-origin: trình duyệt gửi Origin/Referer thật cho POST nội bộ (dùng để chống CSRF), không lộ ra ngoài
  c.header('referrer-policy', 'same-origin');
  c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
});

const ip = (c: C) => c.req.header('cf-connecting-ip') ?? 'local';
const back = (c: C, path: string, msg?: string, err = false) =>
  c.redirect(msg ? `${path}${path.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}` : path);
const fmtTime = (env: Env, iso: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + Number(env.TIMEZONE_OFFSET_HOURS ?? 7) * 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};
const KIND: Record<string, string> = { note: 'Ghi chú', meeting: 'Biên bản', document: 'Tài liệu', request: 'Yêu cầu', report: 'Báo cáo' };
const int = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function badges(env: Env) {
  const [p, o] = await Promise.all([
    env.DB.prepare("SELECT count(*) n FROM core_memory WHERE status='pending'").first<{ n: number }>(),
    env.DB.prepare("SELECT count(*) n FROM tasks WHERE status='open' AND due_date < ?").bind(localDate(env)).first<{ n: number }>(),
  ]);
  return { '/admin/core': p?.n ?? 0, '/admin/tasks': o?.n ?? 0 };
}

async function page(c: C, title: string, body: unknown) {
  return c.html(
    <Layout title={title} path={new URL(c.req.url).pathname} flash={c.req.query('msg')} error={c.req.query('err')} badges={await badges(c.env)}>
      {body as never}
    </Layout>,
  );
}

// ================= Đăng nhập =================
admin.get('/login', (c) =>
  c.html(
    <Layout title="Đăng nhập" error={c.req.query('err')}>
      <div class="card stack">
        <h1>Digital Twin</h1>
        <p class="sub">Nhập ADMIN_KEY để vào trang quản trị.</p>
        {c.req.query('err') ? <div class="flash err">{c.req.query('err')}</div> : null}
        <form method="post" action="/admin/login" class="stack">
          <input type="password" name="key" placeholder="ADMIN_KEY" autocomplete="current-password" required autofocus />
          <button class="primary" style="width:100%">Đăng nhập</button>
        </form>
      </div>
    </Layout>,
  ),
);

admin.post('/login', async (c) => {
  if (await isLocked(c.env, ip(c))) return back(c, '/admin/login', 'Sai quá nhiều lần. Thử lại sau 15 phút.', true);
  const f = await c.req.parseBody();
  if (!checkKey(c.env, f.key)) {
    await recordFail(c.env, ip(c));
    await new Promise((r) => setTimeout(r, 800));
    return back(c, '/admin/login', 'Sai khóa.', true);
  }
  await clearFails(c.env, ip(c));
  await createSession(c);
  return c.redirect('/admin');
});

admin.use('*', requireAdmin);

admin.post('/logout', (c) => {
  clearSession(c);
  return c.redirect('/admin/login');
});

// ================= Tổng quan =================
admin.get('/', async (c) => {
  const env = c.env;
  const today = localDate(env);
  const [stats, due, recent, pending] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT count(*) FROM core_memory WHERE status='confirmed') core,
              (SELECT count(*) FROM entries WHERE source <> 'core_import') entries,
              (SELECT count(*) FROM tasks WHERE status='open') open,
              (SELECT count(*) FROM tasks WHERE status='open' AND due_date < ?) overdue,
              (SELECT count(*) FROM chunks) chunks`,
    )
      .bind(today)
      .first<Record<string, number>>(),
    env.DB.prepare("SELECT * FROM tasks WHERE status='open' AND due_date IS NOT NULL AND due_date <= date(?, '+3 days') ORDER BY due_date LIMIT 12")
      .bind(today)
      .all<Task>(),
    env.DB.prepare("SELECT id, kind, title, created_at FROM entries WHERE source <> 'core_import' ORDER BY id DESC LIMIT 8").all<{
      id: number;
      kind: string;
      title: string | null;
      created_at: string;
    }>(),
    listCore(env, 'pending'),
  ]);
  const s = stats ?? {};
  return page(
    c,
    'Tổng quan',
    <>
      <h1>Tổng quan</h1>
      <p class="sub">Hôm nay {today.split('-').reverse().join('/')}</p>
      <div class="grid">
        <a class="card stat" href="/admin/core"><b>{s.core}</b><span>mục trí nhớ cốt lõi</span></a>
        <a class="card stat" href="/admin/entries"><b>{s.entries}</b><span>ghi chú & tài liệu</span></a>
        <a class="card stat" href="/admin/tasks"><b>{s.open}</b><span>việc đang mở</span></a>
        <a class="card stat" href="/admin/tasks?f=overdue"><b style={s.overdue ? 'color:var(--warn)' : ''}>{s.overdue}</b><span>việc quá hạn</span></a>
        <div class="card stat"><b>{s.chunks}</b><span>đoạn đã đánh chỉ mục</span></div>
      </div>

      {pending.length ? (
        <>
          <h2>Đề xuất trí nhớ cốt lõi đang chờ ({pending.length})</h2>
          <CoreTable items={pending} />
        </>
      ) : null}

      <h2>Quá hạn & đến hạn trong 3 ngày</h2>
      <TaskTable tasks={due.results} today={today} />

      <div class="section-title"><h2>Ghi chú mới nhất</h2><a href="/admin/entries">Xem tất cả →</a></div>
      <table class="resp">
        <tbody>
          {recent.results.map((e) => (
            <tr>
              <td class="num">#{e.id}</td>
              <td><a href={`/admin/entries/${e.id}`}>{e.title ?? '(không tiêu đề)'}</a></td>
              <td><span class="pill">{KIND[e.kind] ?? e.kind}</span></td>
              <td class="num">{fmtTime(env, e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!recent.results.length ? <div class="empty">Chưa có ghi chú nào.</div> : null}
    </>,
  );
});

// ================= Trí nhớ cốt lõi =================
function CoreTable(p: { items: CoreItem[] }) {
  return (
    <table class="resp">
      <tbody>
        {p.items.map((it) => (
          <tr>
            <td class="num">#{it.id}</td>
            <td><span class="pill accent">{SECTION_LABEL[it.section]}</span></td>
            <td class="grow">{it.content}</td>
            <td style="white-space:nowrap">
              {it.status === 'pending' ? (
                <>
                  <PostButton action={`/admin/core/${it.id}/status`} fields={{ status: 'confirmed' }} label="✓ Xác nhận" cls="primary" />{' '}
                  <PostButton action={`/admin/core/${it.id}/status`} fields={{ status: 'rejected' }} label="Bỏ" />
                </>
              ) : (
                <>
                  <a class="btn small" href={`/admin/core?edit=${it.id}#f`}>Sửa</a>{' '}
                  <PostButton action={`/admin/core/${it.id}/status`} fields={{ status: 'archived' }} label="Xóa" cls="danger" />
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

admin.get('/core', async (c) => {
  const [confirmed, pending] = await Promise.all([listCore(c.env, 'confirmed'), listCore(c.env, 'pending')]);
  const edit = confirmed.find((i) => i.id === int(c.req.query('edit')));
  const rendered = renderCore(confirmed);
  return page(
    c,
    'Trí nhớ cốt lõi',
    <>
      <h1>Trí nhớ cốt lõi</h1>
      <p class="sub">
        Luôn được đưa vào mọi câu trả lời. {rendered.text.length.toLocaleString('vi')}/{CORE_BUDGET.toLocaleString('vi')} ký tự
        {rendered.truncated ? <span class="pill warn">{rendered.truncated} mục cũ đang bị cắt khỏi prompt</span> : null}
      </p>

      {pending.length ? (
        <>
          <div class="section-title">
            <h2>Đang chờ xác nhận ({pending.length})</h2>
            <span class="row">
              <PostButton action="/admin/core/pending" fields={{ status: 'confirmed' }} label="Xác nhận tất cả" cls="primary" />
              <PostButton action="/admin/core/pending" fields={{ status: 'rejected' }} label="Bỏ tất cả" />
            </span>
          </div>
          <CoreTable items={pending} />
        </>
      ) : null}

      {SECTIONS.map((s) => {
        const items = confirmed.filter((i) => i.section === s);
        return (
          <>
            <h2>{SECTION_LABEL[s]} <span class="muted" style="font-weight:400">({items.length})</span></h2>
            {items.length ? <CoreTable items={items} /> : <div class="card empty">Chưa có</div>}
          </>
        );
      })}

      <h2 id="f">{edit ? `Sửa mục #${edit.id}` : 'Thêm mục'}</h2>
      <form class="card stack" method="post" action={edit ? `/admin/core/${edit.id}` : '/admin/core'}>
        <div>
          <label>Nhóm</label>
          <select name="section">
            {SECTIONS.map((s) => (
              <option value={s} selected={edit?.section === s}>{SECTION_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Nội dung (viết ngôi thứ nhất, một ý mỗi mục)</label>
          <textarea name="content" maxlength={MAX_CORE_ITEM} required>{edit?.content ?? ''}</textarea>
        </div>
        <div class="row">
          <button class="primary">{edit ? 'Lưu' : 'Thêm'}</button>
          {edit ? <a class="btn" href="/admin/core">Hủy</a> : null}
        </div>
      </form>
    </>,
  );
});

admin.post('/core', async (c) => {
  const f = await c.req.parseBody();
  const content = str(f.content, MAX_CORE_ITEM);
  if (!isSection(f.section) || !content) return back(c, '/admin/core', 'Thiếu nhóm hoặc nội dung.', true);
  const id = await addCore(c.env, f.section, content, 'confirmed');
  return back(c, '/admin/core', `Đã thêm #${id}.`);
});

admin.post('/core/pending', async (c) => {
  const f = await c.req.parseBody();
  const status = f.status === 'confirmed' ? 'confirmed' : 'rejected';
  const r = await c.env.DB.prepare("UPDATE core_memory SET status=?, updated_at=? WHERE status='pending'").bind(status, isoNow()).run();
  return back(c, '/admin/core', `${status === 'confirmed' ? 'Đã xác nhận' : 'Đã bỏ'} ${r.meta.changes} mục.`);
});

admin.post('/core/:id', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const content = str(f.content, MAX_CORE_ITEM);
  if (!id || !content || !isSection(f.section)) return back(c, '/admin/core', 'Dữ liệu không hợp lệ.', true);
  const ok = await editCore(c.env, id, content, f.section);
  return back(c, '/admin/core', ok ? `Đã lưu #${id}.` : `Không tìm thấy #${id}.`, !ok);
});

admin.post('/core/:id/status', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const status = f.status;
  if (!id || (status !== 'confirmed' && status !== 'rejected' && status !== 'archived')) return back(c, '/admin/core', 'Không hợp lệ.', true);
  await setCoreStatus(c.env, id, status);
  const ref = c.req.header('referer');
  const to = ref && new URL(ref).origin === new URL(c.req.url).origin ? new URL(ref).pathname : '/admin/core';
  return back(c, to, { confirmed: 'Đã xác nhận', rejected: 'Đã bỏ', archived: 'Đã xóa' }[status] + ` #${id}.`);
});

// ================= Ghi chú & tài liệu =================
admin.get('/entries', async (c) => {
  const q = str(c.req.query('q'), 200);
  const kind = c.req.query('kind') ?? '';
  const p = Math.max(1, int(c.req.query('p')) ?? 1);
  const per = 30;
  let rows: { id: number; kind: string; title: string | null; summary: string | null; created_at: string; file_name?: string | null; how?: string }[];
  let total = 0;
  if (q) {
    const hits = await hybridSearch(c.env, q, 20);
    rows = hits.map((h) => ({ ...h, how: h.how.join(' + ') }));
    total = rows.length;
  } else {
    const where = `WHERE source <> 'core_import'${kind ? ' AND kind = ?' : ''}`;
    const binds = kind ? [kind] : [];
    const [r, n] = await Promise.all([
      c.env.DB.prepare(`SELECT id, kind, title, summary, created_at, file_name FROM entries ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .bind(...binds, per, (p - 1) * per)
        .all<(typeof rows)[number]>(),
      c.env.DB.prepare(`SELECT count(*) n FROM entries ${where}`).bind(...binds).first<{ n: number }>(),
    ]);
    rows = r.results;
    total = n?.n ?? 0;
  }
  const pages = Math.ceil(total / per);
  const link = (o: Record<string, string | number>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ kind, ...o } as Record<string, string | number>)) {
      if (v !== '' && !(k === 'p' && String(v) === '1')) params.set(k, String(v));
    }
    return '/admin/entries?' + params.toString();
  };
  return page(
    c,
    'Ghi chú & tài liệu',
    <>
      <h1>Ghi chú & tài liệu</h1>
      <p class="sub">{q ? `${total} kết quả cho “${q}”` : `${total} mục`}</p>
      <form class="row" method="get" action="/admin/entries" style="margin-bottom:12px">
        <input class="grow" name="q" value={q} placeholder="Tìm theo từ khóa hoặc theo nghĩa…" />
        <button class="primary">Tìm</button>
        {q ? <a class="btn" href="/admin/entries">Xóa lọc</a> : null}
      </form>
      {!q ? (
        <div class="tabs">
          <a href="/admin/entries" class={!kind ? 'on' : ''}>Tất cả</a>
          {Object.entries(KIND).map(([k, v]) => (
            <a href={link({ kind: k, p: 1 })} class={kind === k ? 'on' : ''}>{v}</a>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <table class="resp">
          <thead><tr><th>#</th><th>Tiêu đề</th><th>Loại</th><th>Thời gian</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr>
                <td class="num">#{e.id}</td>
                <td>
                  <a href={`/admin/entries/${e.id}`}>{e.title ?? '(không tiêu đề)'}</a>
                  {e.summary ? <div class="muted" style="font-size:13px">{e.summary.replace(/\s+/g, ' ').slice(0, 160)}</div> : null}
                </td>
                <td>
                  <span class="pill">{KIND[e.kind] ?? e.kind}</span> {e.how ? <span class="pill accent">{e.how}</span> : null}
                </td>
                <td class="num">{fmtTime(c.env, e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="card empty">Không có mục nào.</div>
      )}
      {pages > 1 ? (
        <div class="row" style="margin-top:12px">
          {p > 1 ? <a class="btn" href={link({ p: p - 1 })}>← Trước</a> : null}
          <span class="muted">Trang {p}/{pages}</span>
          {p < pages ? <a class="btn" href={link({ p: p + 1 })}>Sau →</a> : null}
        </div>
      ) : null}
    </>,
  );
});

admin.get('/entries/:id', async (c) => {
  const id = int(c.req.param('id'));
  const e = id
    ? await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<{
        id: number; kind: string; title: string | null; content: string; summary: string | null; source: string;
        file_name: string | null; created_at: string;
      }>()
    : null;
  if (!e) return back(c, '/admin/entries', 'Không tìm thấy.', true);
  const [tasks, decisions, chunks] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM tasks WHERE source_entry_id = ? ORDER BY id').bind(e.id).all<Task>(),
    c.env.DB.prepare('SELECT id, content FROM decisions WHERE source_entry_id = ?').bind(e.id).all<{ id: number; content: string }>(),
    c.env.DB.prepare('SELECT count(*) n FROM chunks WHERE entry_id = ?').bind(e.id).first<{ n: number }>(),
  ]);
  const editing = c.req.query('edit') === '1';
  return page(
    c,
    `#${e.id}`,
    <>
      <p><a href="/admin/entries">← Ghi chú & tài liệu</a></p>
      <h1>#{e.id} {e.title ?? '(không tiêu đề)'}</h1>
      <p class="sub row">
        <span class="pill">{KIND[e.kind] ?? e.kind}</span>
        <span>{fmtTime(c.env, e.created_at)}</span>
        {e.file_name ? <span>📎 {e.file_name}</span> : null}
        <span>{e.content.length.toLocaleString('vi')} ký tự</span>
        <span class={chunks?.n ? 'pill ok' : 'pill amber'}>{chunks?.n ? `${chunks.n} đoạn đã chỉ mục` : 'chưa chỉ mục ngữ nghĩa'}</span>
      </p>

      {editing ? (
        <form class="card stack" method="post" action={`/admin/entries/${e.id}`}>
          <div><label>Tiêu đề</label><input name="title" value={e.title ?? ''} maxlength={200} /></div>
          <div><label>Tóm tắt</label><textarea name="summary">{e.summary ?? ''}</textarea></div>
          <div><label>Nội dung</label><textarea name="content" style="min-height:360px" required>{e.content}</textarea></div>
          <div class="row"><button class="primary">Lưu & chỉ mục lại</button><a class="btn" href={`/admin/entries/${e.id}`}>Hủy</a></div>
        </form>
      ) : (
        <>
          <div class="row" style="margin-bottom:14px">
            <a class="btn" href={`/admin/entries/${e.id}?edit=1`}>Sửa</a>
            <PostButton action={`/admin/entries/${e.id}/reindex`} label="Chỉ mục lại" />
            <PostButton action={`/admin/entries/${e.id}/delete`} label="Xóa vĩnh viễn" cls="danger" />
          </div>
          {e.summary ? (
            <>
              <h2>Tóm tắt</h2>
              <div class="card prose">{e.summary}</div>
            </>
          ) : null}
          {tasks.results.length ? (
            <>
              <h2>Việc trích ra</h2>
              <TaskTable tasks={tasks.results} today={localDate(c.env)} />
            </>
          ) : null}
          {decisions.results.length ? (
            <>
              <h2>Quyết định</h2>
              <div class="card"><ul style="margin:0;padding-left:18px">{decisions.results.map((d) => <li>{d.content}</li>)}</ul></div>
            </>
          ) : null}
          <h2>Nội dung</h2>
          <div class="card prose">{e.content}</div>
        </>
      )}
    </>,
  );
});

admin.post('/entries/:id', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const content = str(f.content, 200_000);
  if (!id || !content) return back(c, '/admin/entries', 'Nội dung không được trống.', true);
  await c.env.DB.prepare('UPDATE entries SET title = ?, summary = ?, content = ? WHERE id = ?')
    .bind(str(f.title, 200) || null, str(f.summary, 3000) || null, content, id)
    .run();
  c.executionCtx.waitUntil(indexEntrySafe(c.env, id));
  return back(c, `/admin/entries/${id}`, 'Đã lưu. Đang chỉ mục lại (khoảng 1 phút để tìm theo nghĩa).');
});

admin.post('/entries/:id/reindex', async (c) => {
  const id = int(c.req.param('id'));
  if (!id) return back(c, '/admin/entries');
  await indexEntrySafe(c.env, id);
  return back(c, `/admin/entries/${id}`, 'Đã chỉ mục lại.');
});

admin.post('/entries/:id/delete', async (c) => {
  const id = int(c.req.param('id'));
  if (!id) return back(c, '/admin/entries');
  await deleteEntryVectors(c.env, id).catch(() => undefined);
  const ok = await deleteEntry(c.env, id);
  return back(c, '/admin/entries', ok ? `Đã xóa #${id}.` : `Không tìm thấy #${id}.`, !ok);
});

// ================= Việc =================
function TaskTable(p: { tasks: Task[]; today: string }) {
  if (!p.tasks.length) return <div class="card empty">Không có việc nào.</div>;
  return (
    <table class="resp">
      <thead><tr><th>#</th><th>Việc</th><th>Phụ trách</th><th>Hạn</th><th></th></tr></thead>
      <tbody>
        {p.tasks.map((t) => {
          const overdue = t.status === 'open' && t.due_date && t.due_date < p.today;
          return (
            <tr>
              <td class="num">#{t.id}</td>
              <td>
                {t.priority === 'high' ? <span class="pill warn">Ưu tiên cao</span> : null} {t.title}
                {t.source_entry_id ? <div style="font-size:12px"><a href={`/admin/entries/${t.source_entry_id}`}>nguồn #{t.source_entry_id}</a></div> : null}
              </td>
              <td>{t.owner ?? <span class="muted">Tôi</span>}</td>
              <td class="num">
                {t.due_date ? <span class={overdue ? 'pill warn' : t.due_date === p.today ? 'pill amber' : ''}>{formatDue(t.due_date)}</span> : '—'}
              </td>
              <td style="white-space:nowrap">
                {t.status === 'open' ? (
                  <>
                    <PostButton action={`/admin/tasks/${t.id}/status`} fields={{ status: 'done' }} label="✓ Xong" />{' '}
                    <a class="btn small" href={`/admin/tasks?edit=${t.id}#f`}>Sửa</a>{' '}
                    <PostButton action={`/admin/tasks/${t.id}/status`} fields={{ status: 'cancelled' }} label="Bỏ" cls="danger" />
                  </>
                ) : (
                  <>
                    <span class={t.status === 'done' ? 'pill ok' : 'pill'}>{t.status === 'done' ? 'Đã xong' : 'Đã bỏ'}</span>{' '}
                    <PostButton action={`/admin/tasks/${t.id}/status`} fields={{ status: 'open' }} label="Mở lại" />
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

admin.get('/tasks', async (c) => {
  const f = c.req.query('f') ?? 'open';
  const today = localDate(c.env);
  const sql: Record<string, [string, unknown[]]> = {
    open: ["status='open' ORDER BY due_date IS NULL, due_date, id DESC", []],
    overdue: ["status='open' AND due_date < ? ORDER BY due_date", [today]],
    mine: ["status='open' AND owner IS NULL ORDER BY due_date IS NULL, due_date", []],
    others: ["status='open' AND owner IS NOT NULL ORDER BY owner, due_date", []],
    done: ["status IN ('done','cancelled') ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 100", []],
  };
  const [where, binds] = sql[f] ?? sql.open;
  const tasks = (await c.env.DB.prepare(`SELECT * FROM tasks WHERE ${where}`).bind(...binds).all<Task>()).results;
  const editId = int(c.req.query('edit'));
  const edit = editId ? await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(editId).first<Task>() : null;
  const tabs: [string, string][] = [['open', 'Đang mở'], ['overdue', 'Quá hạn'], ['mine', 'Của tôi'], ['others', 'Giao người khác'], ['done', 'Đã xong / bỏ']];
  return page(
    c,
    'Việc',
    <>
      <h1>Việc</h1>
      <p class="sub">{tasks.length} việc</p>
      <div class="tabs">{tabs.map(([k, v]) => <a href={`/admin/tasks?f=${k}`} class={f === k ? 'on' : ''}>{v}</a>)}</div>
      <TaskTable tasks={tasks} today={today} />

      <h2 id="f">{edit ? `Sửa việc #${edit.id}` : 'Thêm việc'}</h2>
      <form class="card stack" method="post" action={edit ? `/admin/tasks/${edit.id}` : '/admin/tasks'}>
        <div><label>Việc</label><input name="title" value={edit?.title ?? ''} maxlength={240} required /></div>
        <div class="row">
          <div class="grow"><label>Phụ trách (để trống = tôi)</label><input name="owner" value={edit?.owner ?? ''} maxlength={80} /></div>
          <div class="grow"><label>Hạn</label><input type="date" name="due_date" value={edit?.due_date ?? ''} /></div>
          <div class="grow">
            <label>Ưu tiên</label>
            <select name="priority">
              {(['normal', 'high', 'low'] as const).map((p) => (
                <option value={p} selected={(edit?.priority ?? 'normal') === p}>{{ normal: 'Bình thường', high: 'Cao', low: 'Thấp' }[p]}</option>
              ))}
            </select>
          </div>
        </div>
        <div class="row">
          <button class="primary">{edit ? 'Lưu' : 'Thêm'}</button>
          {edit ? <a class="btn" href="/admin/tasks">Hủy</a> : null}
        </div>
      </form>
    </>,
  );
});

function taskFields(f: Record<string, unknown>) {
  const due = str(f.due_date, 10);
  const pr = f.priority === 'high' || f.priority === 'low' ? f.priority : 'normal';
  return { title: str(f.title, 240), owner: str(f.owner, 80) || null, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, pr };
}

admin.post('/tasks', async (c) => {
  const t = taskFields(await c.req.parseBody());
  if (!t.title) return back(c, '/admin/tasks', 'Thiếu tên việc.', true);
  const r = await c.env.DB.prepare('INSERT INTO tasks (title, owner, due_date, priority, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(t.title, t.owner, t.due, t.pr, isoNow())
    .run();
  return back(c, '/admin/tasks', `Đã thêm việc #${r.meta.last_row_id}.`);
});

admin.post('/tasks/:id', async (c) => {
  const id = int(c.req.param('id'));
  const t = taskFields(await c.req.parseBody());
  if (!id || !t.title) return back(c, '/admin/tasks', 'Dữ liệu không hợp lệ.', true);
  await c.env.DB.prepare('UPDATE tasks SET title=?, owner=?, due_date=?, priority=?, reminded_at=NULL WHERE id=?')
    .bind(t.title, t.owner, t.due, t.pr, id)
    .run();
  return back(c, '/admin/tasks', `Đã lưu việc #${id}.`);
});

admin.post('/tasks/:id/status', async (c) => {
  const id = int(c.req.param('id'));
  const s = (await c.req.parseBody()).status;
  if (!id || (s !== 'done' && s !== 'cancelled' && s !== 'open')) return back(c, '/admin/tasks', 'Không hợp lệ.', true);
  await setTaskStatus(c.env, id, s);
  const ref = c.req.header('referer');
  const to = ref && new URL(ref).origin === new URL(c.req.url).origin ? new URL(ref).pathname + new URL(ref).search.replace(/[?&](msg|err)=[^&]*/g, '') : '/admin/tasks';
  return back(c, to, { done: 'Đã xong', cancelled: 'Đã bỏ', open: 'Đã mở lại' }[s] + ` việc #${id}.`);
});

// ================= Báo cáo =================
admin.get('/reports', async (c) => {
  const id = int(c.req.query('id'));
  const list = await c.env.DB.prepare('SELECT id, kind, report_date, topic, created_at FROM reports ORDER BY id DESC LIMIT 100').all<{
    id: number; kind: string; report_date: string; topic: string | null; created_at: string;
  }>();
  const sel = id ? await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<{ id: number; kind: string; report_date: string; topic: string | null; content: string }>() : null;
  return page(
    c,
    'Báo cáo',
    <>
      <h1>Báo cáo</h1>
      <p class="sub">Báo cáo cuối ngày và bản nháp báo cáo theo yêu cầu.</p>
      {sel ? (
        <>
          <p><a href="/admin/reports">← Danh sách</a></p>
          <h2>{sel.kind === 'daily' ? `Báo cáo ngày ${sel.report_date.split('-').reverse().join('/')}` : sel.topic}</h2>
          <div class="card prose">{raw(markdownToTelegramHtml(sel.content))}</div>
        </>
      ) : list.results.length ? (
        <table class="resp">
          <tbody>
            {list.results.map((r) => (
              <tr>
                <td><a href={`/admin/reports?id=${r.id}`}>{r.kind === 'daily' ? `Báo cáo ngày ${r.report_date.split('-').reverse().join('/')}` : r.topic ?? 'Báo cáo'}</a></td>
                <td><span class={r.kind === 'daily' ? 'pill' : 'pill accent'}>{r.kind === 'daily' ? 'Hằng ngày' : 'Theo yêu cầu'}</span></td>
                <td class="num">{fmtTime(c.env, r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="card empty">Chưa có báo cáo. Báo cáo ngày được gửi lúc 21:00, hoặc gõ /report trên Telegram.</div>
      )}
    </>,
  );
});

// ================= Cài đặt =================
admin.get('/settings', async (c) => {
  const [model, rep, rem, vec] = await Promise.all([
    getModel(c.env),
    notifyEnabled(c.env, 'notify_report'),
    notifyEnabled(c.env, 'notify_remind'),
    c.env.DB.prepare("SELECT (SELECT count(*) FROM entries WHERE source <> 'core_import') e, (SELECT count(DISTINCT entry_id) FROM chunks) i").first<{ e: number; i: number }>(),
  ]);
  const Toggle = (p: { k: string; on: boolean; label: string; hint: string }) => (
    <div class="card row" style="justify-content:space-between;margin-bottom:10px">
      <div><b>{p.label}</b><div class="muted" style="font-size:13px">{p.hint}</div></div>
      <PostButton action="/admin/settings/notify" fields={{ key: p.k, on: p.on ? '0' : '1' }} label={p.on ? 'Đang BẬT — tắt' : 'Đang TẮT — bật'} cls={p.on ? '' : 'primary'} />
    </div>
  );
  return page(
    c,
    'Cài đặt',
    <>
      <h1>Cài đặt</h1>
      <h2>Thông báo tự động</h2>
      <Toggle k="notify_report" on={rep} label="Báo cáo cuối ngày" hint="21:00 giờ Việt Nam, do Gemini soạn" />
      <Toggle k="notify_remind" on={rem} label="Nhắc việc buổi sáng" hint="08:00 giờ Việt Nam: quá hạn, đến hạn, sắp đến hạn" />
      <h2>Model AI</h2>
      <div class="card stack">
        {Object.entries(MODEL_CHOICES).map(([m, info]) => (
          <div class="row" style="justify-content:space-between">
            <div>
              <b>{info.label}</b> <span class="muted">({m})</span>
              <div class="muted" style="font-size:13px">{info.hint}</div>
            </div>
            {m === model ? (
              <span class="pill ok">Đang dùng</span>
            ) : (
              <PostButton action="/admin/settings/model" fields={{ model: m }} label="Dùng model này" cls="primary" />
            )}
          </div>
        ))}
        <div class="muted" style="font-size:13px">Model đã chọn lỗi hoặc quá tải thì bot tự dùng Flash-Lite cho câu đó. Trên Telegram: /model lite hoặc /model hydrogen.</div>
      </div>
      <h2>Tìm kiếm theo nghĩa</h2>
      <div class="card row" style="justify-content:space-between">
        <div>
          <b>{vec?.i ?? 0}/{vec?.e ?? 0}</b> ghi chú đã có chỉ mục ngữ nghĩa
          <div class="muted" style="font-size:13px">Mục thiếu sẽ được tự bổ sung lúc 08:00 mỗi sáng.</div>
        </div>
        <PostButton action="/admin/settings/reindex" label="Chỉ mục lại toàn bộ" />
      </div>
      <h2>Thông tin</h2>
      <div class="card muted" style="font-size:14px">
        Model: {model} • Múi giờ: UTC+{c.env.TIMEZONE_OFFSET_HOURS} • Phiên đăng nhập hết hạn sau 7 ngày (đổi ADMIN_KEY để đăng xuất mọi nơi).
      </div>
    </>,
  );
});

admin.post('/settings/notify', async (c) => {
  const f = await c.req.parseBody();
  if (f.key !== 'notify_report' && f.key !== 'notify_remind') return back(c, '/admin/settings');
  await setNotify(c.env, f.key, f.on === '1');
  return back(c, '/admin/settings', 'Đã lưu.');
});

admin.post('/settings/model', async (c) => {
  const target = String((await c.req.parseBody()).model ?? '');
  if (!(target in MODEL_CHOICES)) return back(c, '/admin/settings', 'Model không hợp lệ.', true);
  const r = await switchModel(c.env, target);
  if (!r.ok) return back(c, '/admin/settings', r.note ?? 'Không đổi được model.', true);
  return back(c, '/admin/settings', `Đã đổi sang ${MODEL_CHOICES[target].label}.${r.note ? ' ' + r.note : ''}`);
});

admin.post('/settings/reindex', async (c) => {
  const owner = Number((await c.env.DB.prepare("SELECT value FROM settings WHERE key='owner_chat_id'").first<{ value: string }>())?.value);
  if (!c.env.JOBS || !owner) return back(c, '/admin/settings', 'Cần Queue và bot đã được /claim.', true);
  await c.env.JOBS.send({ type: 'reindex', chatId: owner, afterId: 0, done: 0 });
  return back(c, '/admin/settings', 'Đã bắt đầu chỉ mục lại. Bot sẽ báo qua Telegram khi xong.');
});
