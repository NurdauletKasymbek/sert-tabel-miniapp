import {
  appendHistory,
  currentTime,
  loadStore,
  nextEmployeeId,
  publicState,
  saveAttendance,
  saveEmployees,
  STATUSES,
  statusToLabel,
  todayDate,
} from "./_lib/sheets.js";

const TIME_ZONE = process.env.BOT_TIMEZONE || "Asia/Almaty";
const ADMIN_IDS = new Set(
  (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
);
const MINI_APP_URL = (process.env.MINI_APP_URL || "").trim();
const WORKPLACE_LAT = Number.parseFloat(process.env.WORKPLACE_LAT || "");
const WORKPLACE_LON = Number.parseFloat(process.env.WORKPLACE_LON || "");
const WORKPLACE_RADIUS_M = Number.parseInt(process.env.WORKPLACE_RADIUS_M || "200", 10);
const WORKPLACE_CONFIGURED = Number.isFinite(WORKPLACE_LAT) && Number.isFinite(WORKPLACE_LON);

function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function isAdmin(userId) {
  return ADMIN_IDS.has(String(userId));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function tg(method, payload) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN орнатылмаған");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description || "Telegram қатесі"}`);
  return result.result;
}

async function send(chatId, text, extra = {}) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function edit(chatId, messageId, text, extra = {}) {
  return tg("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
}

async function answer(callbackId, text = "") {
  return tg("answerCallbackQuery", { callback_query_id: callbackId, text });
}

function workerKeyboard() {
  return {
    keyboard: [
      [{ text: "📍 Мен келдім", request_location: true }],
      [{ text: "📅 Менің табелім" }, { text: "📊 Осы ай" }],
    ],
    resize_keyboard: true,
  };
}

function miniAppButton() {
  if (!MINI_APP_URL) return null;
  return { inline_keyboard: [[{ text: "Mini App ашу", web_app: { url: MINI_APP_URL } }]] };
}

function setAttendanceRecord(store, date, employeeId, status) {
  const employee = store.employees.find((e) => e.id === employeeId);
  const label = statusToLabel(status);
  const time = currentTime();
  const idx = store.attendance.findIndex((r) => r.date === date && r.employeeId === employeeId);
  const record = {
    date,
    employeeId,
    name: employee?.name || "",
    role: employee?.role || "",
    label,
    time,
    updatedAt: new Date().toISOString(),
  };
  const oldLabel = idx >= 0 ? store.attendance[idx].label : "";
  if (idx >= 0) store.attendance[idx] = record;
  else store.attendance.push(record);
  return { oldLabel, employee };
}

function findEmployeeByTelegramId(employees, userId) {
  return employees.find((e) => String(e.telegramId || "").trim() === String(userId));
}

async function handleAdminStart(chatId) {
  const markup = miniAppButton();
  await send(
    chatId,
    [
      "<b>Sert табель — әкімші</b>",
      "",
      "Барлық басқару Mini App арқылы жасалады.",
      "",
      "Командалар:",
      "/report — бүгінгі есеп",
    ].join("\n"),
    markup ? { reply_markup: markup } : { reply_markup: { remove_keyboard: true } },
  );
}

async function handleAdminReport(chatId) {
  const store = await loadStore();
  const state = publicState(store);
  const today = state.today;
  const attendanceMap = state.attendance || {};
  const records = attendanceMap[today] || {};
  const employees = state.employees || [];

  const counts = { present: 0, half: 0, absent: 0, dayoff: 0, unmarked: 0 };
  for (const emp of employees) {
    const status = records[emp.id]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
    else counts.unmarked += 1;
  }

  const lines = [
    `<b>Бүгінгі табель — ${today}</b>`,
    "",
    `Барлығы: <b>${employees.length}</b>`,
    `Жұмыста: <b>${counts.present}</b>`,
    `Жарты күн: <b>${counts.half}</b>`,
    `Жоқ: <b>${counts.absent}</b>`,
    `Демалыс: <b>${counts.dayoff}</b>`,
    `Белгі жоқ: <b>${counts.unmarked}</b>`,
  ];

  if (counts.unmarked > 0) {
    lines.push("", "<b>Белгіленбегендер:</b>");
    for (const emp of employees) {
      if (!records[emp.id]) lines.push(`- ${escapeHtml(emp.name)}`);
    }
  }

  const markup = miniAppButton();
  await send(chatId, lines.join("\n"), markup ? { reply_markup: markup } : {});
}

async function notifyAdminsToBind(fromUser, store) {
  const unbound = store.employees.filter((e) => e.status !== "archived" && !e.telegramId);
  const buttons = unbound.slice(0, 30).map((e) => [{ text: e.name, callback_data: `bind:${e.id}:${fromUser.id}` }]);

  const header = [
    "<b>🔔 Жаңа тіркеу сұранысы</b>",
    "",
    `Аты: ${escapeHtml([fromUser.first_name, fromUser.last_name].filter(Boolean).join(" "))}`,
    fromUser.username ? `Username: @${escapeHtml(fromUser.username)}` : "",
    `Telegram ID: <code>${fromUser.id}</code>`,
    "",
    unbound.length
      ? "Қай қызметкерге бекітеміз?"
      : "⚠️ Тіркеуге бос қызметкер жоқ. Mini App-та жаңа қызметкер қосыңыз.",
  ].filter(Boolean).join("\n");

  for (const adminId of ADMIN_IDS) {
    try {
      await send(adminId, header, unbound.length ? { reply_markup: { inline_keyboard: buttons } } : {});
    } catch {}
  }
}

async function handleWorkerStart(chatId, fromUser) {
  const greeting = fromUser?.first_name ? `Сәлем, ${escapeHtml(fromUser.first_name)}! 👋` : "Сәлем! 👋";
  await send(
    chatId,
    [
      greeting,
      "",
      "Жұмысқа келгенде <b>📍 Мен келдім</b> түймесін басып, орналасуыңды жіберіңіз.",
      "",
      "Өзіңнің табеліңді көру үшін: <b>📅 Менің табелім</b>",
    ].join("\n"),
    { reply_markup: workerKeyboard() },
  );
}

async function handleQrStart(chatId, fromUser, employeeId) {
  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await send(chatId, `Жүйеге қосылу мүмкін болмады: ${escapeHtml(error.message)}`);
    return;
  }

  const employee = store.employees.find((e) => e.id === employeeId);
  if (!employee) {
    await send(chatId, "Қызметкер табылмады. Жауаптыға хабарласыңыз.");
    return;
  }

  const state = publicState(store);
  const today = state.today;
  const existing = state.attendance?.[today]?.[employeeId];
  if (existing?.status === "present") {
    await send(
      chatId,
      `<b>${escapeHtml(employee.name)}</b>\n\n✅ Сіз бүгін <b>${existing.time || ""}</b> кезінде белгіленгенсіз.`,
      { reply_markup: { remove_keyboard: true } },
    );
    return;
  }

  const greeting = fromUser?.first_name ? `Сәлем, ${escapeHtml(fromUser.first_name)}!` : "Сәлем!";
  await send(
    chatId,
    [
      greeting,
      "",
      `<b>${escapeHtml(employee.name)}</b> (${escapeHtml(employee.role || "Қызметкер")})`,
      `Бүгін: <b>${today}</b>`,
      "",
      "Жұмысқа келдіңіз бе? Растаңыз:",
    ].join("\n"),
    {
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Иә, келдім", callback_data: `checkin:${employeeId}` }]],
      },
    },
  );
}

async function handleWorkerLocation(chatId, fromUser, location) {
  const userId = String(fromUser?.id || "");

  if (!WORKPLACE_CONFIGURED) {
    await send(chatId, "Жұмыс орны әлі баптауланбаған. Әкімшіге хабарласыңыз.", {
      reply_markup: workerKeyboard(),
    });
    return;
  }

  const dist = distanceMeters(WORKPLACE_LAT, WORKPLACE_LON, location.latitude, location.longitude);

  if (dist > WORKPLACE_RADIUS_M) {
    await send(
      chatId,
      [
        "❌ <b>Сіз жұмыс орнында емессіз.</b>",
        "",
        `Қашықтық: ~<b>${Math.round(dist)} м</b>`,
        `Рұқсат: <b>${WORKPLACE_RADIUS_M} м</b>`,
      ].join("\n"),
      { reply_markup: workerKeyboard() },
    );
    return;
  }

  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await send(chatId, `Қате: ${escapeHtml(error.message)}`, { reply_markup: workerKeyboard() });
    return;
  }

  const employee = findEmployeeByTelegramId(store.employees, userId);
  if (!employee) {
    await notifyAdminsToBind(fromUser, store);
    await send(
      chatId,
      [
        "🔒 Сіздің Telegram-ыңыз әлі тіркелмеген.",
        "",
        "Әкімшіге сұрау жіберілді. Растағаннан кейін қайта <b>📍 Мен келдім</b> басыңыз.",
      ].join("\n"),
      { reply_markup: workerKeyboard() },
    );
    return;
  }

  const today = todayDate();
  const state = publicState(store);
  const existing = state.attendance?.[today]?.[employee.id];
  if (existing?.status === "present") {
    await send(
      chatId,
      `✅ Сіз бүгін <b>${existing.time || ""}</b> кезінде белгіленгенсіз.`,
      { reply_markup: workerKeyboard() },
    );
    return;
  }

  const { oldLabel } = setAttendanceRecord(store, today, employee.id, "present");
  await saveAttendance(store.attendance);
  await appendHistory([{
    at: new Date().toISOString(),
    action: oldLabel ? "Белгі өзгерді" : "Белгі қойылды",
    employeeId: employee.id,
    name: employee.name,
    date: today,
    oldLabel: oldLabel || "",
    newLabel: statusToLabel("present"),
  }]);

  const time = formatTime();
  await send(
    chatId,
    [
      `✅ <b>${escapeHtml(employee.name)}</b>`,
      "",
      `Бүгін <b>${time}</b> кезінде жұмысқа келді деп белгіленді.`,
      `Қашықтық: ~${Math.round(dist)} м`,
    ].join("\n"),
    { reply_markup: workerKeyboard() },
  );

  for (const adminId of ADMIN_IDS) {
    try {
      await send(adminId, `📍 <b>${escapeHtml(employee.name)}</b> жұмысқа келді (${time})`);
    } catch {}
  }
}

async function handleWorkerMonthly(chatId, userId) {
  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await send(chatId, `Қате: ${escapeHtml(error.message)}`, { reply_markup: workerKeyboard() });
    return;
  }

  const employee = findEmployeeByTelegramId(store.employees, userId);
  if (!employee) {
    await send(chatId, "Сіз әлі тіркелмегенсіз. Алдымен есік алдындағы QR-ды сканерлеп, әкімшінің растауын күтіңіз.", {
      reply_markup: workerKeyboard(),
    });
    return;
  }

  const today = todayDate();
  const month = today.slice(0, 7);
  const state = publicState(store);
  const records = [];
  for (const [date, dayMap] of Object.entries(state.attendance || {})) {
    if (!date.startsWith(month)) continue;
    const r = dayMap[employee.id];
    if (r) records.push({ date, status: r.status, time: r.time || "" });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));

  const emoji = { present: "✅", half: "🟡", absent: "❌", sick: "🤒", dayoff: "🌴" };
  const lines = records.length
    ? records.map((r) => `${emoji[r.status] || "•"} ${r.date}${r.time ? " — " + r.time : ""}`)
    : ["Жазба әлі жоқ."];

  await send(
    chatId,
    [`<b>${escapeHtml(employee.name)} — ${month}</b>`, "", ...lines].join("\n"),
    { reply_markup: workerKeyboard() },
  );
}

async function handleWorkerStats(chatId, userId) {
  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await send(chatId, `Қате: ${escapeHtml(error.message)}`, { reply_markup: workerKeyboard() });
    return;
  }

  const employee = findEmployeeByTelegramId(store.employees, userId);
  if (!employee) {
    await send(chatId, "Сіз әлі тіркелмегенсіз.", { reply_markup: workerKeyboard() });
    return;
  }

  const today = todayDate();
  const month = today.slice(0, 7);
  const state = publicState(store);
  let present = 0, half = 0, absent = 0, dayoff = 0, sick = 0;

  for (const [date, dayMap] of Object.entries(state.attendance || {})) {
    if (!date.startsWith(month)) continue;
    const r = dayMap[employee.id];
    if (!r) continue;
    if (r.status === "present") present++;
    else if (r.status === "half") half++;
    else if (r.status === "absent") absent++;
    else if (r.status === "dayoff") dayoff++;
    else if (r.status === "sick") sick++;
  }

  await send(
    chatId,
    [
      `<b>${escapeHtml(employee.name)} — ${month}</b>`,
      "",
      `✅ Жұмыста: <b>${present}</b>`,
      `🟡 Жарты күн: <b>${half}</b>`,
      `❌ Жоқ: <b>${absent}</b>`,
      `🤒 Ауырып: <b>${sick}</b>`,
      `🌴 Демалыс: <b>${dayoff}</b>`,
    ].join("\n"),
    { reply_markup: workerKeyboard() },
  );
}

async function handleCheckinCallback(callback, employeeId) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;

  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await answer(callback.id, "Қате");
    await send(chatId, `Жүйеге қосылу мүмкін болмады: ${escapeHtml(error.message)}`);
    return;
  }

  const employee = store.employees.find((e) => e.id === employeeId);
  if (!employee) {
    await answer(callback.id, "Қызметкер табылмады");
    return;
  }

  const today = todayDate();
  const state = publicState(store);
  const existing = state.attendance?.[today]?.[employeeId];
  if (existing?.status === "present") {
    await answer(callback.id, "Бұрын белгіленген");
    await edit(chatId, messageId, `✅ <b>${escapeHtml(employee.name)}</b>\nБүгін <b>${existing.time || ""}</b> кезінде белгіленген.`, {
      reply_markup: { inline_keyboard: [] },
    });
    return;
  }

  const { oldLabel } = setAttendanceRecord(store, today, employeeId, "present");
  await saveAttendance(store.attendance);
  await appendHistory([{
    at: new Date().toISOString(),
    action: oldLabel ? "Белгі өзгерді" : "Белгі қойылды",
    employeeId,
    name: employee.name,
    date: today,
    oldLabel: oldLabel || "",
    newLabel: statusToLabel("present"),
  }]);

  const time = formatTime();
  await answer(callback.id, "Белгіленді ✅");
  await edit(
    chatId,
    messageId,
    `✅ <b>${escapeHtml(employee.name)}</b>\nБүгін <b>${time}</b> кезінде жұмысқа келді деп белгіленді.`,
    { reply_markup: { inline_keyboard: [] } },
  );

  for (const adminId of ADMIN_IDS) {
    try {
      await send(adminId, `📍 <b>${escapeHtml(employee.name)}</b> жұмысқа келді (${time})`);
    } catch {}
  }
}

async function handleBindCallback(callback, employeeId, telegramId) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;

  let store;
  try {
    store = await loadStore();
  } catch (error) {
    await answer(callback.id, "Қате");
    await send(chatId, `Жүйеге қосылу мүмкін болмады: ${escapeHtml(error.message)}`);
    return;
  }

  const employee = store.employees.find((e) => e.id === employeeId);
  if (!employee) {
    await answer(callback.id, "Қызметкер табылмады");
    return;
  }

  employee.telegramId = String(telegramId);
  await saveEmployees(store.employees);
  await appendHistory([{
    at: new Date().toISOString(),
    action: "Telegram бекітілді",
    employeeId,
    name: employee.name,
    date: "",
    oldLabel: "",
    newLabel: `Telegram ID: ${telegramId}`,
  }]);

  await answer(callback.id, "Бекітілді ✅");
  await edit(
    chatId,
    messageId,
    `✅ <b>${escapeHtml(employee.name)}</b> бекітілді (Telegram ID: <code>${telegramId}</code>)`,
    { reply_markup: { inline_keyboard: [] } },
  );

  try {
    await send(
      telegramId,
      `✅ Сіз тіркелдіңіз: <b>${escapeHtml(employee.name)}</b>!\n\nЕнді <b>📍 Мен келдім</b> түймесін басыңыз.`,
      { reply_markup: workerKeyboard() },
    );
  } catch {}
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from?.id || "");
  const text = (message.text || "").trim();
  const lower = text.toLowerCase();

  if (isAdmin(userId)) {
    if (lower.startsWith("/start") || lower === "/menu") {
      await handleAdminStart(chatId);
      return;
    }
    if (lower === "/report" || lower === "есеп") {
      await handleAdminReport(chatId);
      return;
    }
    if (lower === "/help") {
      await send(chatId, [
        "<b>Sert табель — командалар</b>",
        "",
        "/report — бүгінгі табель есебі",
        "/menu — мәзір",
      ].join("\n"), miniAppButton() ? { reply_markup: miniAppButton() } : {});
      return;
    }
    return;
  }

  if (lower.startsWith("/start")) {
    const arg = text.slice("/start".length).trim();
    if (arg.startsWith("in_") || arg.startsWith("checkin_")) {
      const employeeId = arg.replace(/^(in_|checkin_)/, "").trim();
      if (employeeId) {
        await handleQrStart(chatId, message.from, employeeId);
        return;
      }
    }
    await handleWorkerStart(chatId, message.from);
    return;
  }

  if (message.location) {
    await handleWorkerLocation(chatId, message.from, message.location);
    return;
  }

  if (text === "📍 Мен келдім") {
    await send(chatId, "📍 Орналасу батырмасын басыңыз ↓", { reply_markup: workerKeyboard() });
    return;
  }

  if (text === "📅 Менің табелім") {
    await handleWorkerMonthly(chatId, userId);
    return;
  }

  if (text === "📊 Осы ай") {
    await handleWorkerStats(chatId, userId);
    return;
  }

  await send(chatId, "Төмендегі түймелерді пайдаланыңыз.", { reply_markup: workerKeyboard() });
}

async function handleCallback(callback) {
  const userId = String(callback.from.id);
  const data = callback.data || "";

  if (data.startsWith("checkin:")) {
    await handleCheckinCallback(callback, data.slice("checkin:".length));
    return;
  }

  if (data.startsWith("bind:")) {
    if (!isAdmin(userId)) {
      await answer(callback.id, "Рұқсат жоқ");
      return;
    }
    const parts = data.split(":");
    await handleBindCallback(callback, parts[1], parts[2]);
    return;
  }

  await answer(callback.id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.BOT_WEBHOOK_SECRET || "";
  if (secret) {
    const incomingSecret = req.headers["x-telegram-bot-api-secret-token"] || "";
    if (incomingSecret !== secret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  } catch (error) {
    console.error("Bot webhook error:", error.message);
  }

  res.status(200).json({ ok: true });
}
