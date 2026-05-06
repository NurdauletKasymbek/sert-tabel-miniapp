import { loadStore, publicState } from "./_lib/sheets.js";

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
