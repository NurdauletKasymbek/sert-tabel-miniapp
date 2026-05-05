import { buildManagerReport, loadStore } from "./_lib/sheets.js";
import { idsFromEnv, miniAppKeyboard, sendTelegramMessage } from "./_lib/telegram.js";

function managerIds() {
  const managers = idsFromEnv("MANAGER_TELEGRAM_IDS");
  return managers.length ? managers : idsFromEnv("ADMIN_TELEGRAM_IDS");
}

function adminIds() {
  return idsFromEnv("ADMIN_TELEGRAM_IDS");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const ids = managerIds();
    if (!ids.length) {
      res.status(400).json({ error: "MANAGER_TELEGRAM_IDS Vercel Environment Variables ішінде жоқ" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const report = buildManagerReport(store, String(body.date || ""));
    await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, report.text, { reply_markup: miniAppKeyboard() })));
    const admins = adminIds();
    if (admins.length) {
      const managerList = ids.map((id) => `<code>${id}</code>`).join(", ");
      const copyText = [
        "<b>Басшылыққа есеп жіберілді</b>",
        `Кімге: ${managerList}`,
        `Күні: <b>${report.date}</b>`,
        "",
        "<b>Жіберілген ақпарат:</b>",
        report.text,
      ].join("\n");
      await Promise.all(admins.map((chatId) => sendTelegramMessage(chatId, copyText, { reply_markup: miniAppKeyboard() })));
    }
    res.status(200).json({ ok: true, sentTo: ids.length, date: report.date, counts: report.counts });
  } catch (error) {
    res.status(500).json({ error: `Басшылыққа есеп жіберілмеді: ${error.message}` });
  }
}
