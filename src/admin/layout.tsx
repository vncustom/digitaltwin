import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';

const CSS = `
:root{--bg:#f6f7f9;--panel:#fff;--text:#1b1f24;--muted:#667085;--line:#e4e7ec;--accent:#3b5bdb;--accent-weak:#edf2ff;
--ok:#2b8a3e;--ok-weak:#ebfbee;--warn:#c92a2a;--warn-weak:#fff5f5;--amber:#b35c00;--amber-weak:#fff4e6;--radius:10px}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#171a21;--text:#e6e8eb;--muted:#98a2b3;--line:#262b36;
--accent:#91a7ff;--accent-weak:#1c2340;--ok:#69db7c;--ok-weak:#13261a;--warn:#ff8787;--warn-weak:#2c1517;--amber:#ffc078;--amber-weak:#2b2010}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
nav.side{border-right:1px solid var(--line);padding:20px 14px;position:sticky;top:0;height:100vh;background:var(--panel)}
.brand{font-weight:700;font-size:16px;margin:0 8px 18px}.brand small{display:block;color:var(--muted);font-weight:400;font-size:12px}
nav.side a{display:flex;justify-content:space-between;padding:8px 10px;border-radius:8px;color:var(--text);margin-bottom:2px}
nav.side a:hover{background:var(--bg);text-decoration:none}nav.side a.on{background:var(--accent-weak);color:var(--accent);font-weight:600}
nav.side form{margin-top:18px;padding:0 8px}
main{padding:28px 32px;max-width:1100px;width:100%}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.stat span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
tr:last-child td{border-bottom:0}.num{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted)}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;background:var(--bg);color:var(--muted);border:1px solid var(--line);white-space:nowrap}
.pill.ok{background:var(--ok-weak);color:var(--ok);border-color:transparent}.pill.warn{background:var(--warn-weak);color:var(--warn);border-color:transparent}
.pill.amber{background:var(--amber-weak);color:var(--amber);border-color:transparent}.pill.accent{background:var(--accent-weak);color:var(--accent);border-color:transparent}
input,select,textarea{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%}
textarea{min-height:90px;resize:vertical}input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
button,.btn{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:8px;padding:7px 12px;white-space:nowrap;display:inline-block}
button:hover,.btn:hover{border-color:var(--accent);text-decoration:none}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){button.primary{color:#0f1115}}
button.danger{color:var(--warn)}button.small{padding:3px 9px;font-size:13px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{flex:0 0 auto}.grow{flex:1 1 200px!important}
form.inline{display:inline}.stack>*+*{margin-top:10px}label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
.tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tabs a{padding:5px 12px;border-radius:99px;border:1px solid var(--line);color:var(--text)}
.tabs a.on{background:var(--accent);border-color:var(--accent);color:#fff}
.flash{padding:10px 14px;border-radius:8px;background:var(--ok-weak);color:var(--ok);margin-bottom:16px}
.flash.err{background:var(--warn-weak);color:var(--warn)}
.prose{white-space:pre-wrap;word-wrap:break-word}.muted{color:var(--muted)}.empty{color:var(--muted);padding:18px;text-align:center}
.section-title{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
details summary{cursor:pointer;color:var(--accent)}
@media (max-width:800px){.shell{grid-template-columns:1fr}nav.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.brand{margin:0 12px 0 0;width:100%}nav.side a{padding:6px 10px}nav.side form{margin:0 0 0 auto;padding:0}main{padding:18px 16px}
table.resp thead{display:none}table.resp tr{display:block;border-bottom:1px solid var(--line);padding:8px 0}table.resp td{display:block;border:0;padding:3px 12px}}
`;

const NAV: [string, string][] = [
  ['/admin', 'Tổng quan'],
  ['/admin/core', 'Trí nhớ cốt lõi'],
  ['/admin/entries', 'Ghi chú & tài liệu'],
  ['/admin/tasks', 'Việc'],
  ['/admin/reports', 'Báo cáo'],
  ['/admin/settings', 'Cài đặt'],
];

export function Layout(p: { title: string; path?: string; flash?: string | null; error?: string | null; badges?: Record<string, number>; children?: Child }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>{p.title} · Digital Twin</title>
        <style>{raw(CSS)}</style>
      </head>
      <body>
        {p.path === undefined ? (
          <main style="max-width:420px;margin:12vh auto">{p.children}</main>
        ) : (
          <div class="shell">
            <nav class="side">
              <div class="brand">
                Digital Twin<small>Quản trị</small>
              </div>
              {NAV.map(([href, label]) => (
                <a href={href} class={(href === '/admin' ? p.path === href : p.path?.startsWith(href)) ? 'on' : ''}>
                  {label}
                  {p.badges?.[href] ? <span class="pill warn">{p.badges[href]}</span> : null}
                </a>
              ))}
              <form method="post" action="/admin/logout">
                <button class="small">Đăng xuất</button>
              </form>
            </nav>
            <main>
              {p.flash ? <div class="flash">{p.flash}</div> : null}
              {p.error ? <div class="flash err">{p.error}</div> : null}
              {p.children}
            </main>
          </div>
        )}
      </body>
    </html>
  );
}

/** Nút POST nhỏ (xác nhận/xóa/đổi trạng thái) — không cần JavaScript. */
export function PostButton(p: { action: string; label: string; cls?: string; fields?: Record<string, string> }) {
  return (
    <form class="inline" method="post" action={p.action}>
      {Object.entries(p.fields ?? {}).map(([k, v]) => (
        <input type="hidden" name={k} value={v} />
      ))}
      <button class={`small ${p.cls ?? ''}`}>{p.label}</button>
    </form>
  );
}
