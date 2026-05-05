import { buildManagerReport, loadStore, todayDate } from "./_lib/sheets.js";
import { idsFromEnv, miniAppKeyboard, sendTelegramMessage } from "./_lib/telegram.js";

function assertCron(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return;
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${secret}` && req.query?.secret !== secret) {
    throw new Error("Cron access denied");
  }
}

function isLastDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    assertCron(req);

    const date = String(req.query?.date || todayDate());
    if (!isLastDay(date)) {
      res.status(200).json({ ok: true, skipped: "not_last_day", date });
      return;
    }

    const ids = idsFromEnv("MANAGER_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
    if (!ids.length) {
      res.status(400).json({ error: "MANAGER_TELEGRAM_IDS немесе ADMIN_TELEGRAM_IDS жоқ" });
      return;
    }

    const store = await loadStore();
    const report = buildManagerReport(store, date);
    const text = [
      "<b>Ай соңындағы толық табель есебі</b>",
      "",
      report.text,
    ].join("\n");

    await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, text, { reply_markup: miniAppKeyboard() })));
    res.status(200).json({ ok: true, sentTo: ids.length, date: report.date, counts: report.counts });
  } catch (error) {
    res.status(500).json({ error: `Айлық есеп жіберілмеді: ${error.message}` });
  }
}
