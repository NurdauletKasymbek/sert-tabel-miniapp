import { loadStore, publicState } from "./_lib/sheets.js";
import { idsFromEnv, miniAppKeyboard, sendTelegramMessage } from "./_lib/telegram.js";

function assertCron(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return;
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${secret}` && req.query?.secret !== secret) {
    throw new Error("Cron access denied");
  }
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    assertCron(req);

    const ids = idsFromEnv("RESPONSIBLE_TELEGRAM_IDS", "ADMIN_TELEGRAM_IDS");
    if (!ids.length) {
      res.status(400).json({ error: "RESPONSIBLE_TELEGRAM_IDS немесе ADMIN_TELEGRAM_IDS жоқ" });
      return;
    }

    const store = await loadStore();
    const state = publicState(store);
    const unmarked = state.unmarkedEmployees || [];
    if (!unmarked.length) {
      res.status(200).json({ ok: true, skipped: "all_marked", date: state.today });
      return;
    }

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
    res.status(200).json({ ok: true, sentTo: ids.length, unmarked: unmarked.length, date: state.today });
  } catch (error) {
    res.status(500).json({ error: `Ескерту жіберілмеді: ${error.message}` });
  }
}
