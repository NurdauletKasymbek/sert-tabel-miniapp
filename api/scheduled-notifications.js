import { buildManagerReport, loadStore, publicState, todayDate } from "./_lib/sheets.js";
import { idsFromEnv, miniAppKeyboard, sendTelegramMessage } from "./_lib/telegram.js";

function assertCron(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return;
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${secret}` && req.query?.secret !== secret) {
    throw new Error("Cron access denied");
  }
}

function localHourMinute() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
}

function isLastDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function sendReminder() {
  const ids = idsFromEnv("RESPONSIBLE_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "reminder", skipped: "no_recipients" };
  const store = await loadStore();
  const state = publicState(store);
  const unmarked = state.unmarkedEmployees || [];
  if (!unmarked.length) return { type: "reminder", skipped: "all_marked", date: state.today };

  const text = [
    "<b>Табель ескертуі</b>",
    `Күн: <b>${state.today}</b>`,
    "",
    `Әлі белгі қойылмаған: <b>${unmarked.length}</b>`,
    ...unmarked.map((employee) => `- ${employee.name}`),
    "",
    "Mini App ашып, бүгінгі белгілерді аяқтаңыз.",
  ].join("\n");

  await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, text, { reply_markup: miniAppKeyboard() })));
  return { type: "reminder", sentTo: ids.length, unmarked: unmarked.length, date: state.today };
}

async function sendDaily() {
  const ids = idsFromEnv("MANAGER_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "daily", skipped: "no_recipients" };
  const store = await loadStore();
  const report = buildManagerReport(store, "");
  const text = ["<b>Күндік және айлық табель есебі</b>", "", report.text].join("\n");
  await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, text, { reply_markup: miniAppKeyboard() })));
  return { type: "daily", sentTo: ids.length, date: report.date, counts: report.counts };
}

async function sendMonthly() {
  const date = todayDate();
  if (!isLastDay(date)) return { type: "monthly", skipped: "not_last_day", date };
  const ids = idsFromEnv("MANAGER_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "monthly", skipped: "no_recipients" };
  const store = await loadStore();
  const report = buildManagerReport(store, date);
  const text = ["<b>Ай соңындағы толық табель есебі</b>", "", report.text].join("\n");
  await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, text, { reply_markup: miniAppKeyboard() })));
  return { type: "monthly", sentTo: ids.length, date: report.date, counts: report.counts };
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    assertCron(req);

    const mode = String(req.query?.mode || "");
    const time = localHourMinute();
    let result;
    if (mode === "reminder" || (!mode && time === "18:00")) result = await sendReminder();
    else if (mode === "daily" || (!mode && time === "19:00")) result = await sendDaily();
    else if (mode === "monthly" || (!mode && time === "09:00")) result = await sendMonthly();
    else result = { skipped: "no_action_for_time", time };

    res.status(200).json({ ok: true, time, result });
  } catch (error) {
    res.status(500).json({ error: `Автоматты хабарлама қатесі: ${error.message}` });
  }
}
