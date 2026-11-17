import type { Env } from '../env';
import {
  SECTIONS,
  SECTION_LABEL,
  addCore,
  editCore,
  getCore,
  listCore,
  normalizeKey,
  parseSection,
  renderCore,
  setCoreStatus,
  setPendingByEntry,
  CORE_BUDGET,
  MAX_CORE_ITEM,
  type CoreItem,
  type Section,
} from '../memory/core';
import { splitProfile } from '../brain/core-extract';
import { friendlyAiError } from '../brain/gemini';
import { insertEntry } from '../db/entries';
import { sendMessage, sendTyping, tg } from './api';
import type { TgCallbackQuery } from './types';

export const CORE_HELP = `🧠 TRÍ NHỚ CỐT LÕI — luôn được dùng trong mọi câu trả lời

/core – xem toàn bộ
/core <nhóm>: <nội dung> – thêm (đã xác nhận)
   vd: /core muc-tieu: Hoàn thành lộ trình AI cho phòng trong Q1/2027
/core edit <id> <nội dung mới> – sửa
/core del <id> – xóa (lưu trữ)
/core pending – các đề xuất đang chờ bạn xác nhận
/core import <bản tự mô tả dài> – AI tách thành các mục để bạn duyệt

Nhóm: ${SECTIONS.map((s) => `${s} (${SECTION_LABEL[s]})`).join(', ')}
Có thể viết tiếng Việt: toi, vai-tro, muc-tieu, uu-tien, nguyen-tac, phong-cach, quan-trong.`;

const keyboardFor = (id: number) => ({
  inline_keyboard: [
    [
      { text: '✅ Xác nhận', callback_data: `c:ok:${id}` },
      { text: '✏️ Sửa', callback_data: `c:ed:${id}` },
      { text: '❌ Bỏ', callback_data: `c:no:${id}` },
    ],
  ],
});

/** Gửi một đề xuất trí nhớ cốt lõi kèm nút xác nhận. */
export async function sendProposal(env: Env, chatId: number | string, item: Pick<CoreItem, 'id' | 'section' | 'content'>) {
  await sendMessage(env, chatId, `💡 Đề xuất ghi nhớ cốt lõi #${item.id}\n[${SECTION_LABEL[item.section]}]\n${item.content}`, {
    reply_markup: keyboardFor(item.id),
  });
}

function formatList(items: CoreItem[]) {
  const by = new Map<Section, CoreItem[]>();
  for (const it of items) by.set(it.section, [...(by.get(it.section) ?? []), it]);
  return SECTIONS.filter((s) => by.has(s))
    .map((s) => `▪️ ${SECTION_LABEL[s]}\n` + by.get(s)!.map((i) => `  #${i.id} ${i.content}`).join('\n'))
    .join('\n\n');
}

export async function handleCoreCommand(env: Env, chatId: number, arg: string) {
  if (!arg) {
    const items = await listCore(env, 'confirmed');
    if (!items.length) {
      await sendMessage(env, chatId, 'Chưa có trí nhớ cốt lõi nào.\n\n' + CORE_HELP);
      return;
    }
    const { text, truncated } = renderCore(items);
    const warn = truncated
      ? `\n\n⚠️ Vượt ngân sách ${CORE_BUDGET} ký tự (${text.length}); ${truncated} mục cũ nhất đang bị bỏ khỏi prompt. Nên gộp/xóa bớt.`
      : '';
    const pending = (await listCore(env, 'pending')).length;
    await sendMessage(
      env,
      chatId,
      `🧠 TRÍ NHỚ CỐT LÕI\n\n${formatList(items)}${warn}${pending ? `\n\n⏳ ${pending} đề xuất đang chờ: /core pending` : ''}\n\n/core help – cách thêm/sửa`,
    );
    return;
  }

  const [subRaw, ...restParts] = arg.split(/\s+/);
  const sub = subRaw.toLowerCase();
  const rest = arg.slice(subRaw.length).trim();

  if (sub === 'help') return void (await sendMessage(env, chatId, CORE_HELP));

  if (sub === 'pending') {
    const items = await listCore(env, 'pending');
    if (!items.length) return void (await sendMessage(env, chatId, 'Không có đề xuất nào đang chờ.'));
    for (const it of items.slice(0, 15)) await sendProposal(env, chatId, it);
    if (items.length > 15) await sendMessage(env, chatId, `… và ${items.length - 15} đề xuất khác.`);
    return;
  }

  if (sub === 'del' || sub === 'xoa') {
    const id = Number(restParts[0]);
    if (!Number.isSafeInteger(id) || id < 1) return void (await sendMessage(env, chatId, 'Cú pháp: /core del <id>'));
    const ok = await setCoreStatus(env, id, 'archived');
    await sendMessage(env, chatId, ok ? `🗑 Đã xóa core #${id} khỏi trí nhớ cốt lõi.` : `Không tìm thấy core #${id}.`);
    return;
  }

  if (sub === 'edit' || sub === 'sua') {
    const id = Number(restParts[0]);
    const content = rest.slice(String(restParts[0] ?? '').length).trim();
    if (!Number.isSafeInteger(id) || id < 1 || !content)
      return void (await sendMessage(env, chatId, 'Cú pháp: /core edit <id> <nội dung mới>'));
    if (content.length > MAX_CORE_ITEM) return void (await sendMessage(env, chatId, `Tối đa ${MAX_CORE_ITEM} ký tự/mục.`));
    const ok = await editCore(env, id, content);
    await sendMessage(env, chatId, ok ? `✅ Đã sửa và xác nhận core #${id}.` : `Không tìm thấy core #${id}.`);
    return;
  }

  if (sub === 'import') {
    if (rest.length < 20) return void (await sendMessage(env, chatId, 'Cú pháp: /core import <bản tự mô tả của bạn>'));
    await sendTyping(env, chatId);
    // Lưu bản gốc để đối chiếu; source='core_import' → không đưa vào tìm kiếm (đã có trong trí nhớ cốt lõi)
    const entryId = await insertEntry(env, { kind: 'note', title: 'Hồ sơ tự mô tả (import core)', content: rest, source: 'core_import' });
    let items;
    try {
      items = await splitProfile(env, rest);
    } catch (err) {
      console.error('splitProfile failed', String(err));
      return void (await sendMessage(env, chatId, `${friendlyAiError(err)}\nBản gốc đã lưu ở ghi chú #${entryId}.`));
    }
    if (!items.length) return void (await sendMessage(env, chatId, 'AI không tách được mục nào. Thử viết rõ hơn theo từng nhóm.'));
    // Bỏ các mục trùng nguyên văn với trí nhớ đã có / đang chờ
    const norm = (s: string) => normalizeKey(s).replace(/[^a-z0-9]/g, '');
    const known = new Set([...(await listCore(env, 'confirmed')), ...(await listCore(env, 'pending'))].map((i) => norm(i.content)));
    const fresh = items.filter((it) => !known.has(norm(it.content)));
    const skipped = items.length - fresh.length;
    if (!fresh.length) return void (await sendMessage(env, chatId, `Tất cả ${items.length} mục đã có sẵn trong trí nhớ cốt lõi.`));
    const added: CoreItem[] = [];
    for (const it of fresh) {
      const id = await addCore(env, it.section, it.content, 'pending', entryId);
      added.push({ id, section: it.section, content: it.content, status: 'pending', source_entry_id: entryId, updated_at: '' });
    }
    await sendMessage(
      env,
      chatId,
      `📥 AI tách được ${added.length} mục mới (chưa xác nhận)${skipped ? `, bỏ ${skipped} mục trùng` : ''}:\n\n${formatList(added)}\n\nSửa từng mục: /core edit <id> …  •  Bỏ: /core del <id>`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✅ Xác nhận tất cả`, callback_data: `c:all:${entryId}` },
              { text: '❌ Bỏ tất cả', callback_data: `c:none:${entryId}` },
            ],
          ],
        },
      },
    );
    return;
  }

  // /core <nhóm>: <nội dung>   hoặc   /core <nhóm> <nội dung>
  // Ưu tiên phần trước dấu ":" (cho phép "Mục tiêu: ..."), nếu không thì lấy từ đầu tiên.
  const colon = arg.indexOf(':');
  let section: Section | null = null;
  let content = '';
  if (colon > 0 && colon <= 40) {
    section = parseSection(arg.slice(0, colon));
    content = arg.slice(colon + 1).trim();
  }
  if (!section) {
    section = parseSection(subRaw);
    content = rest.replace(/^:\s*/, '');
  }
  if (!section || !content) return void (await sendMessage(env, chatId, 'Không nhận ra nhóm.\n\n' + CORE_HELP));
  if (content.length > MAX_CORE_ITEM) return void (await sendMessage(env, chatId, `Tối đa ${MAX_CORE_ITEM} ký tự/mục.`));
  const id = await addCore(env, section, content, 'confirmed');
  await sendMessage(env, chatId, `✅ Đã thêm core #${id} [${SECTION_LABEL[section]}].`);
}

/** Xử lý nút inline của trí nhớ cốt lõi. Trả false nếu callback không thuộc module này. */
export async function handleCoreCallback(env: Env, cq: TgCallbackQuery): Promise<boolean> {
  const m = cq.data?.match(/^c:(ok|no|ed|all|none):(\d+)$/);
  if (!m) return false;
  const action = m[1];
  const id = Number(m[2]);
  const chatId = cq.message?.chat.id;
  let toast = '';
  let status = '';

  if (action === 'ok' || action === 'no') {
    const ok = await setCoreStatus(env, id, action === 'ok' ? 'confirmed' : 'rejected', 'pending');
    toast = ok ? (action === 'ok' ? 'Đã xác nhận' : 'Đã bỏ') : 'Đề xuất không còn chờ';
    status = ok ? (action === 'ok' ? '✅ Đã xác nhận' : '❌ Đã bỏ') : 'ℹ️ Đã xử lý trước đó';
  } else if (action === 'all' || action === 'none') {
    const n = await setPendingByEntry(env, id, action === 'all' ? 'confirmed' : 'rejected');
    if (!n) {
      toast = 'Không còn mục nào đang chờ';
      status = 'ℹ️ Đã xử lý trước đó';
    } else {
      toast = action === 'all' ? `Đã xác nhận ${n} mục` : `Đã bỏ ${n} mục`;
      status = action === 'all' ? `✅ Đã xác nhận ${n} mục` : `❌ Đã bỏ ${n} mục`;
    }
  } else if (action === 'ed') {
    const item = await getCore(env, id);
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => undefined);
    if (chatId && item)
      await sendMessage(env, chatId, `Gửi nội dung mới theo mẫu (sửa xong sẽ tự xác nhận):\n\n/core edit ${id} ${item.content}`);
    return true;
  }

  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: toast }).catch(() => undefined);
  if (chatId && cq.message?.message_id) {
    const original = cq.message.text ?? '';
    await tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: cq.message.message_id,
      text: `${original}\n\n${status}`.slice(0, 4000),
    }).catch(() => undefined);
  }
  return true;
}
