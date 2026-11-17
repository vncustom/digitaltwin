// Các hành động dùng chung giữa tin nhắn văn bản và xử lý file.
import type { Env } from '../env';
import { insertMessage } from '../db/entries';
import { localDate } from '../lib/util';
import { sendMessage, sendRich, sendTyping } from './api';
import { sendProposal } from './core-ui';
import { answer } from '../brain/answer';
import { friendlyAiError } from '../brain/gemini';
import type { Understanding } from '../brain/understand';
import { addCore } from '../memory/core';
import { createTasks, formatTask, getTasks, insertDecisions } from '../memory/tasks';

/** Lưu kết quả trích xuất (việc, quyết định, đề xuất core) của một entry và báo lại cho người dùng. */
export async function applyExtraction(env: Env, chatId: number, entryId: number, u: Understanding, header: string[]) {
  const created = await createTasks(env, u.tasks, entryId);
  await insertDecisions(env, u.decisions, entryId);

  const today = localDate(env);
  const lines = [...header];
  if (created.length) lines.push('', '📌 Việc mới:', ...created.map((t) => '  ' + formatTask(t, today)));
  if (u.decisions.length) lines.push('', '🧭 Quyết định:', ...u.decisions.map((d) => '  • ' + d));
  const done = await getTasks(env, u.completed_task_ids);
  if (done.length) lines.push('', '✔️ Có vẻ đã xong (bấm để xác nhận):', ...done.map((t) => '  ' + formatTask(t, today)));

  const buttons = [
    ...done.map((t) => [{ text: `✅ Xong #${t.id}`, callback_data: `t:done:${t.id}` }]),
    ...(created.length ? [created.map((t) => ({ text: `❌ Bỏ việc #${t.id}`, callback_data: `t:drop:${t.id}` }))] : []),
  ];
  await sendMessage(env, chatId, lines.join('\n'), buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {});

  for (const c of u.core_candidates) {
    const coreId = await addCore(env, c.section, c.content, 'pending', entryId);
    await sendProposal(env, chatId, { id: coreId, section: c.section, content: c.content });
  }
}

export async function doAnswer(
  env: Env,
  chatId: number,
  question: string,
  o: { searchQuery?: string; remember?: boolean } = {},
) {
  await sendTyping(env, chatId);
  let reply: string;
  try {
    reply = await answer(env, question, { searchQuery: o.searchQuery });
  } catch (err) {
    console.error('answer failed', String(err));
    return void (await sendMessage(env, chatId, friendlyAiError(err)));
  }
  if (o.remember !== false) {
    await insertMessage(env, 'user', question);
    await insertMessage(env, 'assistant', reply);
  }
  await sendRich(env, chatId, reply);
}
