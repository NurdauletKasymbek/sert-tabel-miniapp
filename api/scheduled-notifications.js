import { buildManagerReport, loadStore, publicState, todayDate } from "./_lib/sheets.js";
import { idsFromEnv, miniAppKeyboard, sendTelegramMessage } from "./_lib/telegram.js";

// Әкімшіге арналған ескерту алушылары: env айнымалылары + «Әкімшілер»
// парағындағы Telegram ID-і бар барлық адам (қосарланбай).
function recipientIds(store, ...envNames) {
  const envIds = idsFromEnv(...envNames);
  const sheetIds = (store.admins || [])
    .map((a) => String(a.telegramId || "").trim())
    .filter(Boolean);
  return [...new Set([...envIds, ...sheetIds])];
}

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
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
}

// Конфигурацияланған уақыт белдеуінде бүгін жексенбі ме?
function isSundayLocal() {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    weekday: "short",
  }).format(new Date());
  return wd === "Sun";
}

function isLastDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function sendReminder() {
  const store = await loadStore();
  const ids = recipientIds(store, "RESPONSIBLE_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "reminder", skipped: "no_recipients" };
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
  const store = await loadStore();
  const ids = recipientIds(store, "MANAGER_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "daily", skipped: "no_recipients" };
  const report = buildManagerReport(store, "");
  const text = ["<b>Күндік және айлық табель есебі</b>", "", report.text].join("\n");
  await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, text, { reply_markup: miniAppKeyboard() })));
  return { type: "daily", sentTo: ids.length, date: report.date, counts: report.counts };
}

async function sendCheckoutReminder() {
  const store = await loadStore();
  const today = todayDate();
  const candidates = (store.employees || []).filter((e) => {
    if (e.status === "archived") return false;
    if (!String(e.telegramId || "").trim()) return false;
    const todayRow = [...store.attendance].reverse().find(
      (row) => row.date === today && row.employeeId === e.id,
    );
    return todayRow?.checkInTime && !todayRow?.checkOutTime;
  });
  if (!candidates.length) {
    return { type: "checkout-reminder", skipped: "no_candidates", date: today };
  }
  const text = [
    "🔔 <b>Шығу басуды ұмытпаңыз!</b>",
    "",
    "Жұмыс уақыты аяқталуға жақын. Mini App-та шығу белгілеуді ұмытпаңыз.",
  ].join("\n");
  let sent = 0;
  for (const emp of candidates) {
    try {
      await sendTelegramMessage(emp.telegramId, text);
      sent += 1;
    } catch {}
  }
  return { type: "checkout-reminder", sentTo: sent, total: candidates.length, date: today };
}

async function sendMonthly() {
  const date = todayDate();
  if (!isLastDay(date)) return { type: "monthly", skipped: "not_last_day", date };
  const store = await loadStore();
  const ids = recipientIds(store, "MANAGER_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
  if (!ids.length) return { type: "monthly", skipped: "no_recipients" };
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
    if (mode === "checkout-reminder" || (!mode && time === "17:55")) result = await sendCheckoutReminder();
    else if (mode === "reminder" || (!mode && time === "18:00")) result = await sendReminder();
    else if (mode === "daily" || (!mode && time === "19:00")) result = await sendDaily();
    else if (mode === "monthly" || (!mode && time === "09:00")) result = await sendMonthly();
    else if (mode === "test") {
      // Тек бір ID-ге тексеру хабарын жібереді: ?mode=test&to=<telegramId>
      const to = String(req.query?.to || "").trim();
      if (!to) {
        result = { type: "test", skipped: "no_to" };
      } else {
        const store = await loadStore();
        const state = publicState(store);
        const unmarked = state.unmarkedEmployees || [];
        const text = [
          "🧪 <b>ТЕСТ — Табель ескертуі</b>",
          `Күн: <b>${state.today}</b>`,
          "",
          unmarked.length
            ? `Әлі белгі қойылмаған: <b>${unmarked.length}</b>\n${unmarked.map((e) => `- ${e.name}`).join("\n")}`
            : "Барлығы белгіленген ✅",
          "",
          "Бұл — тексеру хабары (нақты ескерту күн сайын 09:30-да келеді).",
        ].join("\n");
        await sendTelegramMessage(to, text, { reply_markup: miniAppKeyboard() });
        result = { type: "test", sentTo: to, unmarked: unmarked.length, date: state.today };
      }
    }
    else if (mode === "evening") {
      // Белгі қойылмағандар ескертуі (жексенбіде келмейді) + ай соңы болса айлық есеп.
      const reminder = isSundayLocal()
        ? { type: "reminder", skipped: "sunday" }
        : await sendReminder();
      const monthly = isLastDay(todayDate()) ? await sendMonthly() : { type: "monthly", skipped: "not_last_day" };
      result = { evening: true, reminder, monthly };
    }
    else result = { skipped: "no_action_for_time", time };

    res.status(200).json({ ok: true, time, result });
  } catch (error) {
    res.status(500).json({ error: `Автоматты хабарлама қатесі: ${error.message}` });
  }
}
