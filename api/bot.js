import { sendTelegramMessage } from "./_lib/telegram.js";

// Telegram ботының webhook-ы (Vercel serverless). Railway/long-polling керек емес.
// Барлық дерек әрекеттері бар API endpoint-теріне бағытталады (логика қайталанбайды).

const token = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const base = () => (process.env.MINI_APP_URL || "").trim();
const secret = () => (process.env.WEBHOOK_SECRET || "").trim();
const envAdmins = () => (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

function esc(v) {
  return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}
const answerCb = (id, text = "") => tg("answerCallbackQuery", { callback_query_id: id, text });
const editText = (chat, mid, text, extra = {}) => tg("editMessageText", { chat_id: chat, message_id: mid, text, parse_mode: "HTML", ...extra });
const openBtn = () => (base() ? { inline_keyboard: [[{ text: "📱 Табель ашу", web_app: { url: base() } }]] } : undefined);

async function apiCall(path, opts = {}) {
  const r = await fetch(`${base()}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
const jsonPost = (path, body) => apiCall(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Рөл: "admin" | "monitor" | "" (env админдер әрқашан admin).
async function roleOf(userId) {
  if (envAdmins().includes(String(userId))) return "admin";
  const me = await apiCall(`/api/me?full=1&userId=${encodeURIComponent(userId)}`);
  return me.data?.role || "";
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || "");
  const text = (msg.text || "").trim();
  if (!text.startsWith("/")) return;
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*/, "");
  const arg = text.slice(cmd.length).trim();
  const who = msg.from?.first_name || msg.from?.username || "";

  if (cmd === "/pdf") {
    const month = /^\d{4}-\d{2}$/.test(arg) ? arg : "";
    await sendTelegramMessage(chatId, "⏳ Айлық жалақы PDF дайындалуда...");
    const r = await apiCall(`/api/me?report=monthly&format=pdf&send=${encodeURIComponent(userId)}${month ? `&month=${month}` : ""}`);
    if (!r.ok) await sendTelegramMessage(chatId, `❌ ${esc(r.data?.error || "PDF жасалмады")}`);
    return;
  }

  // /start, /help, /menu — сәлемдесу
  const me = await apiCall(`/api/me?full=1&userId=${encodeURIComponent(userId)}`);
  if (me.data?.isAdmin) {
    await sendTelegramMessage(chatId, "Sert табель — басқару Mini App-та. 👇", { reply_markup: openBtn() });
  } else if (me.data?.employee) {
    await sendTelegramMessage(chatId, `Ассалаумағалейкум${who ? `, <b>${esc(who)}</b>` : ""}! 👋`, { reply_markup: openBtn() });
  } else {
    await sendTelegramMessage(chatId, [
      `Сәлем${who ? `, ${esc(who)}` : ""}! 👋`,
      "",
      "Жұмысқа кіру, шығу, табеліңді көру — бәрі <b>Mini App</b>-та.",
      "",
      "Төмендегі <b>📱 Табель ашу</b> батырмасын басып, тіркеліңіз 👇",
    ].join("\n"), { reply_markup: openBtn() });
  }
}

async function onCallback(cb) {
  const data = cb.data || "";
  const chatId = cb.message?.chat?.id;
  const mid = cb.message?.message_id;
  const userId = String(cb.from?.id || "");

  if (data.startsWith("reg_approve:") || data.startsWith("reg_reject:")) {
    if ((await roleOf(userId)) !== "admin") return answerCb(cb.id, "Рұқсат жоқ");
    const tgId = data.split(":")[1];
    const approve = data.startsWith("reg_approve:");
    if (!approve) {
      await answerCb(cb.id, "Бас тартылды ❌");
      await editText(chatId, mid, "❌ Тіркеу сұранысы бас тартылды.", { reply_markup: { inline_keyboard: [] } });
      await tg("sendMessage", { chat_id: tgId, text: "❌ Тіркеу сұранысыңыз қабылданбады. Әкімшіге хабарласыңыз." }).catch(() => {});
      return;
    }
    const t = cb.message.text || "";
    const name = (t.match(/Аты-жөні:\s*([^\n]+)/)?.[1] || "").trim();
    const role = (t.match(/Рөлі:\s*([^\n]+)/)?.[1] || "Қызметкер").trim();
    if (!name) return answerCb(cb.id, "Аты-жөні табылмады");
    const r = await jsonPost("/api/employees", { name, role, telegramId: tgId });
    if (!r.ok) { await answerCb(cb.id, "Қате"); return; }
    await answerCb(cb.id, "Расталды ✅");
    await editText(chatId, mid, `✅ <b>${esc(name)}</b> тіркелді (ID: <code>${esc(tgId)}</code>)`, { reply_markup: { inline_keyboard: [] } });
    await tg("sendMessage", {
      chat_id: tgId, parse_mode: "HTML",
      text: `✅ <b>Сіз тіркелдіңіз!</b>\n\nАты-жөні: <b>${esc(name)}</b>\nРөлі: <b>${esc(role)}</b>\n\nТөмендегі батырмамен табеліңізді ашыңыз 👇`,
      reply_markup: openBtn(),
    }).catch(() => {});
    return;
  }

  if (data.startsWith("bind:")) {
    if ((await roleOf(userId)) !== "admin") return answerCb(cb.id, "Рұқсат жоқ");
    const [, empId, tgId] = data.split(":");
    const r = await apiCall(`/api/employees/${encodeURIComponent(empId)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramId: tgId }),
    });
    if (!r.ok) return answerCb(cb.id, "Қате");
    await answerCb(cb.id, "Бекітілді ✅");
    await editText(chatId, mid, `✅ Бекітілді (Telegram ID: <code>${esc(tgId)}</code>)`, { reply_markup: { inline_keyboard: [] } });
    await tg("sendMessage", { chat_id: tgId, parse_mode: "HTML", text: "✅ Сіз тіркелдіңіз! Табеліңізді ашыңыз 👇", reply_markup: openBtn() }).catch(() => {});
    return;
  }

  if (data.startsWith("qmark:")) {
    const role = await roleOf(userId);
    if (role !== "admin" && role !== "monitor") return answerCb(cb.id, "Рұқсат жоқ");
    const [, status, empId] = data.split(":");
    if (status !== "present" && status !== "absent") return answerCb(cb.id, "Қате");
    const today = await apiCall("/api/state").then((s) => s.data?.today || new Date().toISOString().slice(0, 10));
    const r = await jsonPost("/api/attendance", { date: today, employeeId: empId, status });
    if (!r.ok) return answerCb(cb.id, "Сақталмады");
    await answerCb(cb.id, status === "present" ? "✅ Жұмыста" : "❌ Жоқ");
    const rows = (cb.message.reply_markup?.inline_keyboard || []).filter(
      (row) => !row.some((b) => String(b.callback_data || "").endsWith(`:${empId}`)),
    );
    const onlyAll = rows.every((row) => row.every((b) => String(b.callback_data || "").startsWith("qallpresent:")));
    if (onlyAll) await editText(chatId, mid, "✅ <b>Барлық телефонсыз қызметкер белгіленді.</b>", { reply_markup: { inline_keyboard: [] } });
    else await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: mid, reply_markup: { inline_keyboard: rows } });
    return;
  }

  if (data.startsWith("qallpresent:")) {
    const role = await roleOf(userId);
    if (role !== "admin" && role !== "monitor") return answerCb(cb.id, "Рұқсат жоқ");
    const date = data.split(":")[1];
    const state = (await apiCall("/api/state")).data || {};
    const todayRecords = state.attendance?.[date] || {};
    const pending = (state.employees || []).filter((e) => !String(e.telegramId || "").trim() && !todayRecords[e.id]);
    let ok = 0;
    for (const e of pending) {
      const r = await jsonPost("/api/attendance", { date, employeeId: e.id, status: "present" });
      if (r.ok) ok += 1;
    }
    await answerCb(cb.id, `✅ ${ok} белгіленді`);
    await editText(chatId, mid, `✅ <b>${ok} телефонсыз қызметкер «Жұмыста» деп белгіленді.</b>`, { reply_markup: { inline_keyboard: [] } });
    return;
  }

  await answerCb(cb.id);
}

export default async function handler(req, res) {
  try {
    // Бір реттік орнату: /api/bot?action=setup&key=<WEBHOOK_SECRET>
    if (req.method === "GET" && req.query?.action === "setup") {
      if (!secret() || req.query.key !== secret()) {
        res.status(403).json({ error: "key қате немесе WEBHOOK_SECRET орнатылмаған" });
        return;
      }
      const result = await tg("setWebhook", {
        url: `${base()}/api/bot`,
        secret_token: secret(),
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      res.status(200).json({ ok: true, base: base(), setWebhook: result });
      return;
    }
    // Диагностика: /api/bot?action=info&key=<secret> → webhook күйі
    if (req.method === "GET" && req.query?.action === "info") {
      if (!secret() || req.query.key !== secret()) {
        res.status(403).json({ error: "key қате" });
        return;
      }
      const info = await tg("getWebhookInfo", {});
      res.status(200).json({ base: base(), hasToken: Boolean(token()), info });
      return;
    }
    if (req.method !== "POST") {
      res.status(200).json({ ok: true, info: "Telegram webhook endpoint" });
      return;
    }
    // Қауіпсіздік: Telegram жіберген secret тексеру
    if (secret() && req.headers["x-telegram-bot-api-secret-token"] !== secret()) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
    res.status(200).json({ ok: true });
  } catch (error) {
    // Telegram қайта жібермеуі үшін әрқашан 200
    res.status(200).json({ ok: false, error: error.message });
  }
}
