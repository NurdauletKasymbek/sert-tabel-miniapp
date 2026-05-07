import { appendAdvance, loadStore, publicState } from "./_lib/sheets.js";

let botUsernameCache = null;

async function getBotUsername() {
  if (botUsernameCache) return botUsernameCache;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return "";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const result = await response.json();
    if (result.ok && result.result?.username) {
      botUsernameCache = result.result.username;
      return botUsernameCache;
    }
  } catch {}
  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (String(body.action || "").toLowerCase() !== "advance") {
        res.status(400).json({ error: "Әрекет көрсетілмеген" });
        return;
      }
      const date = String(body.date || "").trim();
      const employeeName = String(body.employeeName || "").trim();
      const amount = Number(String(body.amount || "0").replace(/[^\d.-]/g, "")) || 0;
      const note = String(body.note || "").trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "Күн форматы қате (YYYY-MM-DD)" });
        return;
      }
      if (!employeeName) {
        res.status(400).json({ error: "Аты-жөні міндетті" });
        return;
      }
      if (amount <= 0) {
        res.status(400).json({ error: "Сома 0-ден үлкен болуы керек" });
        return;
      }

      const store = await loadStore();
      const employee = store.employees.find(
        (e) => e.name.trim().toLowerCase() === employeeName.toLowerCase()
      );
      if (!employee) {
        res.status(400).json({ error: `Қызметкер табылмады: ${employeeName}` });
        return;
      }

      await appendAdvance(date, employeeName, amount, note);
      const fresh = await loadStore();
      res.status(200).json(publicState(fresh));
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const [store, botUsername] = await Promise.all([loadStore(), getBotUsername()]);
    res.status(200).json({ ...publicState(store), botUsername });
  } catch (error) {
    res.status(500).json({ error: `Дерек жүктелмеді: ${error.message}` });
  }
}
