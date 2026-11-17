import type { Env, FileJob, ReindexJob } from '../env';
import { getOwnerChatId, setSettingIfAbsent } from '../db/settings';
import { deleteEntry, insertEntry, insertMessage, updateEntryMeta } from '../db/entries';
import { addDays, isoNow, localDate, safeEqual } from '../lib/util';
import { notifyEnabled, sendDailyReport, setNotify } from '../cron';
import { buildMorningReminder } from '../brain/report';
import { sendMessage, sendRich, sendTyping, tg } from './api';
import { handleCoreCallback, handleCoreCommand } from './core-ui';
import { applyExtraction, doAnswer } from './actions';
import { answer } from '../brain/answer';
import { understand, type Intent } from '../brain/understand';
import { MODEL_CHOICES, friendlyAiError, getModel, parseModelArg, switchModel } from '../brain/gemini';
import { createTasks, formatDue, formatTask, listOpenTasks, setTaskStatus } from '../memory/tasks';
import { hybridSearch } from '../memory/search';
import { deleteEntryVectors, indexEntrySafe } from '../memory/vectors';
import { processReindexJob } from '../files/reindex';
import { MAX_FILE_BYTES, UNSUPPORTED_HINT, detectKind, processFileJob } from '../files/process';
import type { TgCallbackQuery, TgMessage, TgUpdate } from './types';

const MAX_TEXT = 20_000;

const HELP = `🤖 DIGITAL TWIN

Cứ nhắn tự nhiên, tôi tự hiểu bạn đang:
• ghi chú / cập nhật công việc → lưu, tách việc cần làm, quyết định
• hỏi / nhờ tra cứu / "nếu là tôi thì…" → trả lời từ trí nhớ
• nhờ chuẩn bị báo cáo → tạo việc có hạn + soạn bản nháp

Lệnh:
/tasks – việc đang mở  •  /done <id> – xong
/search <nội dung> – tìm theo từ khóa và theo nghĩa
/reindex – đánh chỉ mục ngữ nghĩa lại toàn bộ
/note <…> – ép lưu thành ghi chú  •  /ask <…> – ép hỏi
/core – trí nhớ cốt lõi (/core help)
/whoami – tôi hiểu bạn là ai
/forget <id> – xóa một ghi chú
/report [YYYY-MM-DD] – báo cáo ngày (mặc định hôm nay)
/remind – xem nhắc việc ngay
/notify – bật/tắt báo cáo 21:00 và nhắc việc 8:00
/model lite|hydrogen – đổi model AI (gõ /model để xem)
/help – hướng dẫn`;

/** Điểm vào cho mỗi update; mọi lỗi được bắt ở đây để webhook luôn trả 200. */
export async function processUpdate(env: Env, update: TgUpdate) {
  try {
    if (typeof update?.update_id !== 'number') return;
    const fresh = await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates (update_id, received_at) VALUES (?, ?)')
      .bind(update.update_id, isoNow())
      .run();
    if (!fresh.meta.changes) return; // đã xử lý rồi
    // Log metadata (không log nội dung tin nhắn)
    console.log('update', update.update_id, update.message ? `message chat=${update.message.chat?.type}` : update.callback_query ? 'callback' : 'other');

    if (update.message) await handleMessage(env, update.message);
    else if (update.callback_query) await handleCallback(env, update.callback_query);
  } catch (err) {
    console.error('processUpdate failed', String(err));
  }
}

/** Tách "/cmd@bot nội dung..." → giữ nguyên xuống dòng trong nội dung. */
function parseCommand(text: string): { cmd: string; arg: string } {
  if (!text.startsWith('/')) return { cmd: '', arg: text };
  const m = text.match(/^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return { cmd: text.split(/\s/)[0].toLowerCase(), arg: '' };
  return { cmd: '/' + m[1].toLowerCase(), arg: (m[2] ?? '').trim() };
}

const idArg = (s: string) => {
  const n = Number(s.trim().replace(/^#/, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

async function handleMessage(env: Env, msg: TgMessage) {
  const chatId = msg.chat?.id;
  if (!chatId || msg.chat.type !== 'private') return;
  const text = (msg.text ?? msg.caption ?? '').trim();

  const owner = await getOwnerChatId(env);
  if (!owner) {
    if (text.startsWith('/claim ')) {
      if (!safeEqual(text.slice(7).trim(), env.OWNER_CLAIM_CODE)) {
        await sendMessage(env, chatId, 'Mã không đúng.');
        return;
      }
      const won = await setSettingIfAbsent(env, 'owner_chat_id', String(chatId));
      await sendMessage(env, chatId, won ? '✅ Đã liên kết bạn là chủ sở hữu.\n\n' + HELP : 'Bot đã có chủ sở hữu.');
    } else {
      await sendMessage(env, chatId, 'Bot chưa được liên kết. Chủ sở hữu hãy gửi: /claim <MÃ>');
    }
    return;
  }
  if (String(chatId) !== owner) {
    console.log('ignored non-owner chat'); // im lặng với người lạ
    return;
  }

  if (msg.document || msg.photo) return void (await receiveFile(env, chatId, msg, text));
  if (!text) return;

  const { cmd, arg } = parseCommand(text);
  switch (cmd) {
    case '/start':
    case '/help':
      return void (await sendMessage(env, chatId, HELP));
    case '/claim':
      return void (await sendMessage(env, chatId, 'Bạn đã là chủ sở hữu.'));
    case '/core':
      return void (await handleCoreCommand(env, chatId, arg));
    case '/whoami':
      return void (await doAnswer(
        env,
        chatId,
        'Dựa trên trí nhớ cốt lõi, hãy mô tả tôi là ai: vai trò, mục tiêu, ưu tiên, nguyên tắc ra quyết định, phong cách. Chỉ nói điều có trong trí nhớ, trích [core #id], và nêu những nhóm còn trống mà tôi nên bổ sung.',
        { remember: false },
      ));
    case '/model':
      return void (await handleModelCommand(env, chatId, arg));
    case '/report': {
      const day = arg.match(/^\d{4}-\d{2}-\d{2}$/) ? arg : /^(hom qua|hôm qua|yesterday)$/i.test(arg) ? addDays(localDate(env), -1) : localDate(env);
      await sendTyping(env, chatId);
      return void (await sendDailyReport(env, chatId, day, true));
    }
    case '/remind': {
      const r = await buildMorningReminder(env, localDate(env));
      return void (await sendMessage(env, chatId, r ?? 'Không có việc quá hạn hay sắp đến hạn. 👍'));
    }
    case '/notify': {
      const m = arg.toLowerCase().match(/^(report|baocao|remind|nhac)\s+(on|off|bat|tat)$/);
      if (m) {
        const key = m[1] === 'report' || m[1] === 'baocao' ? 'notify_report' : 'notify_remind';
        await setNotify(env, key, m[2] === 'on' || m[2] === 'bat');
      }
      const [rep, rem] = await Promise.all([notifyEnabled(env, 'notify_report'), notifyEnabled(env, 'notify_remind')]);
      return void (await sendMessage(
        env,
        chatId,
        `🔔 Thông báo tự động\n• Báo cáo cuối ngày 21:00: ${rep ? 'BẬT' : 'TẮT'}\n• Nhắc việc 08:00: ${rem ? 'BẬT' : 'TẮT'}\n\nĐổi: /notify report on|off  •  /notify remind on|off`,
      ));
    }
    case '/tasks':
      return void (await showTasks(env, chatId));
    case '/done': {
      const id = idArg(arg);
      if (!id) return void (await sendMessage(env, chatId, 'Cú pháp: /done <id>'));
      const ok = await setTaskStatus(env, id, 'done');
      return void (await sendMessage(env, chatId, ok ? `✅ Đã hoàn thành việc #${id}.` : `Không tìm thấy việc đang mở #${id}.`));
    }
    case '/search':
      if (!arg) return void (await sendMessage(env, chatId, 'Cú pháp: /search <từ khóa>'));
      return void (await doSearch(env, chatId, arg));
    case '/forget': {
      const id = idArg(arg);
      if (!id) return void (await sendMessage(env, chatId, 'Cú pháp: /forget <id ghi chú>'));
      await deleteEntryVectors(env, id).catch((e) => console.error('delete vectors failed', String(e)));
      const ok = await deleteEntry(env, id);
      return void (await sendMessage(env, chatId, ok ? `🗑 Đã xóa ghi chú #${id}.` : `Không tìm thấy ghi chú #${id}.`));
    }
    case '/reindex': {
      if (!env.VEC) return void (await sendMessage(env, chatId, 'Chưa cấu hình Vectorize.'));
      const job: ReindexJob = { type: 'reindex', chatId, afterId: 0, done: 0 };
      await sendMessage(env, chatId, '🔄 Bắt đầu đánh chỉ mục ngữ nghĩa cho toàn bộ ghi chú/tài liệu…');
      if (env.JOBS) await env.JOBS.send(job);
      else await processReindexJob(env, job);
      return;
    }
    case '/note':
      if (!arg) return void (await sendMessage(env, chatId, 'Cú pháp: /note <nội dung>'));
      return void (await handleText(env, chatId, arg, 'note'));
    case '/ask':
      if (!arg) return void (await sendMessage(env, chatId, 'Cú pháp: /ask <câu hỏi>'));
      return void (await handleText(env, chatId, arg, 'question'));
    case '':
      return void (await handleText(env, chatId, text));
    default:
      await sendMessage(env, chatId, `Lệnh ${cmd} chưa hỗ trợ. Gõ /help.`);
  }
}

function modelHelp(current: string) {
  const line = (m: string) => `${m === current ? '▶️' : '▫️'} ${MODEL_CHOICES[m].label} (${m}) — ${MODEL_CHOICES[m].hint}`;
  return `🧠 MODEL AI ĐANG DÙNG
${line('gemini-flash-lite-latest')}
${line('gemini-4-hydrogen')}

Đổi model:
/model lite — dùng gemini-flash-lite-latest
/model hydrogen — dùng gemini-4-hydrogen
/model — xem model hiện tại

Model đã chọn lỗi hoặc quá tải thì bot tự dùng Flash-Lite cho câu đó và báo ở cuối câu trả lời.`;
}

async function handleModelCommand(env: Env, chatId: number, arg: string) {
  const current = await getModel(env);
  if (!arg) return void (await sendMessage(env, chatId, modelHelp(current)));
  const target = parseModelArg(arg);
  if (!target) return void (await sendMessage(env, chatId, `Không nhận ra "${arg.slice(0, 40)}". Chỉ có: lite hoặc hydrogen.\n\n${modelHelp(current)}`));
  if (target === current) return void (await sendMessage(env, chatId, `Đang dùng ${MODEL_CHOICES[target].label} rồi (${target}).`));
  await sendMessage(env, chatId, `🔄 Đang thử ${target}…`);
  const r = await switchModel(env, target);
  if (!r.ok) return void (await sendMessage(env, chatId, `❌ ${r.note}`));
  await sendMessage(env, chatId, `✅ Đã đổi sang ${MODEL_CHOICES[target].label} (${target}).${r.note ? `\n⚠️ ${r.note}` : ''}\nÁp dụng từ tin nhắn tiếp theo.`);
}

/** Luồng chính cho tin nhắn tự nhiên: hiểu ý định → lưu/trích xuất hoặc trả lời. */
async function handleText(env: Env, chatId: number, input: string, force?: Intent) {
  const text = input.slice(0, MAX_TEXT);
  await sendTyping(env, chatId);

  let u;
  try {
    u = await understand(env, text, force);
  } catch (err) {
    // AI lỗi: nếu không chắc là câu hỏi thì vẫn lưu nguyên văn để không mất dữ liệu.
    console.error('understand failed', String(err));
    if (force !== 'question') {
      const id = await insertEntry(env, { kind: 'note', content: text });
      await insertMessage(env, 'user', text);
      await sendMessage(env, chatId, `📝 Đã lưu nguyên văn ghi chú #${id}.\n${friendlyAiError(err)}`);
      await indexEntrySafe(env, id);
    } else await sendMessage(env, chatId, friendlyAiError(err));
    return;
  }

  if (u.intent === 'question') {
    return doAnswer(env, chatId, text, { searchQuery: u.search_query });
  }

  if (u.intent === 'report_request') {
    const entryId = await insertEntry(env, { kind: 'request', content: text, title: u.title });
    await updateEntryMeta(env, entryId, { processed: 1, summary: u.summary });
    await indexEntrySafe(env, entryId);
    const created = await createTasks(env, u.tasks.slice(0, 1), entryId);
    await sendMessage(
      env,
      chatId,
      `🗂 Đã ghi yêu cầu báo cáo #${entryId}: ${u.report_topic ?? u.title}` +
        (created[0] ? `\n📌 Việc #${created[0].id}${created[0].due_date ? ` — hạn ${formatDue(created[0].due_date)}` : ''}` : '') +
        '\n✍️ Đang soạn bản nháp từ trí nhớ…',
    );
    await sendTyping(env, chatId);
    try {
      const draft = await answer(env, text, { mode: 'report', searchQuery: u.search_query });
      await env.DB.prepare('INSERT INTO reports (kind, report_date, topic, content, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('requested', u.report_due_date ?? localDate(env), u.report_topic ?? u.title, draft, isoNow(), isoNow())
        .run();
      await insertMessage(env, 'user', text);
      await insertMessage(env, 'assistant', draft);
      await sendRich(env, chatId, draft);
    } catch (err) {
      console.error('report draft failed', String(err));
      await sendMessage(env, chatId, friendlyAiError(err));
    }
    return;
  }

  // intent = note
  const entryId = await insertEntry(env, { kind: 'note', content: text, title: u.title });
  await updateEntryMeta(env, entryId, { processed: 1, summary: u.summary });
  await insertMessage(env, 'user', text);
  await applyExtraction(env, chatId, entryId, u, [`📝 Đã lưu #${entryId} — ${u.title}`]);
  await indexEntrySafe(env, entryId); // sau khi đã trả lời để người dùng không phải chờ
}

/** Nhận file: kiểm tra nhanh rồi đẩy vào hàng đợi (xử lý có thể mất vài phút). */
async function receiveFile(env: Env, chatId: number, msg: TgMessage, caption: string) {
  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : undefined; // ảnh lớn nhất
  const job: FileJob = msg.document
    ? {
        type: 'file',
        chatId,
        fileId: msg.document.file_id,
        fileName: msg.document.file_name || 'file',
        mime: msg.document.mime_type || 'application/octet-stream',
        size: msg.document.file_size ?? 0,
        caption,
      }
    : {
        type: 'file',
        chatId,
        fileId: photo!.file_id,
        fileName: `anh_${localDate(env)}_${msg.message_id}.jpg`,
        mime: 'image/jpeg',
        size: photo!.file_size ?? 0,
        caption,
      };

  if (job.size > MAX_FILE_BYTES) {
    return void (await sendMessage(env, chatId, `❌ File quá lớn (${(job.size / 1048576).toFixed(1)} MB). Bot Telegram chỉ tải được file ≤ 20 MB.`));
  }
  if (!detectKind(job.fileName, job.mime)) {
    return void (await sendMessage(env, chatId, `❌ Chưa hỗ trợ "${job.fileName}".\n${UNSUPPORTED_HINT}`));
  }
  if (env.JOBS) {
    await env.JOBS.send(job);
    await sendMessage(env, chatId, `⏳ Đang đọc "${job.fileName}"… (file lớn có thể mất 1-2 phút)`);
  } else {
    await processFileJob(env, job); // không có Queue: xử lý ngay (giới hạn ~30s)
  }
}

async function showTasks(env: Env, chatId: number) {
  const tasks = await listOpenTasks(env, 50);
  if (!tasks.length) return void (await sendMessage(env, chatId, 'Không có việc nào đang mở. 🎉'));
  const today = localDate(env);
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today).length;
  await sendMessage(
    env,
    chatId,
    `📋 VIỆC ĐANG MỞ (${tasks.length}${overdue ? `, ${overdue} quá hạn` : ''})\n\n` +
      tasks.map((t) => formatTask(t, today)).join('\n') +
      '\n\n/done <id> để đánh dấu xong',
  );
}

async function doSearch(env: Env, chatId: number, q: string) {
  const hits = await hybridSearch(env, q, 10);
  if (!hits.length) return void (await sendMessage(env, chatId, `Không tìm thấy ghi chú nào liên quan "${q}".`));
  const snippet = (h: (typeof hits)[number]) =>
    (h.snip ?? h.matched.find((c) => c.idx > 0)?.text ?? h.matched[0]?.text ?? h.summary ?? h.content).replace(/\s+/g, ' ').slice(0, 180);
  await sendMessage(
    env,
    chatId,
    `🔎 ${hits.length} kết quả cho "${q}":\n\n` +
      hits
        .map((h) => `#${h.id} (${localDate(env, new Date(h.created_at))}) ${h.title ?? ''} [${h.how.join(' + ')}]\n   ${snippet(h)}`)
        .join('\n\n') +
      '\n\nHỏi thêm về một mục: nhắn câu hỏi bình thường.',
  );
}

async function handleTaskCallback(env: Env, cq: TgCallbackQuery): Promise<boolean> {
  const m = cq.data?.match(/^t:(done|drop):(\d+)$/);
  if (!m) return false;
  const id = Number(m[2]);
  const ok = await setTaskStatus(env, id, m[1] === 'done' ? 'done' : 'cancelled');
  const status = ok ? (m[1] === 'done' ? `✅ Việc #${id} đã xong` : `❌ Đã bỏ việc #${id}`) : `ℹ️ Việc #${id} đã được xử lý trước đó`;
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: status }).catch(() => undefined);
  if (cq.message?.chat.id) await sendMessage(env, cq.message.chat.id, status);
  return true;
}

async function handleCallback(env: Env, cq: TgCallbackQuery) {
  const owner = await getOwnerChatId(env);
  if (!owner || String(cq.from.id) !== owner) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => undefined);
    return;
  }
  if (await handleCoreCallback(env, cq)) return;
  if (await handleTaskCallback(env, cq)) return;
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Chưa hỗ trợ' }).catch(() => undefined);
}
