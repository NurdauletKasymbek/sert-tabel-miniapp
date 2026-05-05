import { buildManagerReport, loadStore } from "./_lib/sheets.js";

function env(name) {
  return process.env[name] || "";
}

function managerIds() {
  return (env("MANAGER_TELEGRAM_IDS") || env("ADMIN_TELEGRAM_IDS"))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function adminIds() {
  return env("ADMIN_TELEGRAM_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function sendTelegramMessage(chatId, text) {
  const token = env("TELEGRAM_BOT_TOKEN").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN Vercel Environment Variables ішінде жоқ");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.description || "Telegram хабарлама жіберілмеді");
  return result;
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
    await Promise.all(ids.map((chatId) => sendTelegramMessage(chatId, report.text)));
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
      await Promise.all(admins.map((chatId) => sendTelegramMessage(chatId, copyText)));
    }
    res.status(200).json({ ok: true, sentTo: ids.length, date: report.date, counts: report.counts });
  } catch (error) {
    res.status(500).json({ error: `Басшылыққа есеп жіберілмеді: ${error.message}` });
  }
}
