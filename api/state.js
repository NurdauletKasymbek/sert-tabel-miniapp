import { appendAdvance, appendHistory, loadStore, publicState } from "./_lib/sheets.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sendTelegramText(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN жоқ");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  return response.ok;
}

// Суретті алғаш рет жүктеп жіберу — қайтарған file_id-ні кейінгілерге пайдаланамыз.
async function sendTelegramPhotoUpload(chatId, buffer, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN жоқ");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
  form.append("photo", new Blob([buffer], { type: "image/jpeg" }), "photo.jpg");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  const photos = result.result?.photo || [];
  return { ok: Boolean(result.ok), fileId: photos.length ? photos[photos.length - 1].file_id : "" };
}

async function sendTelegramPhotoById(chatId, fileId, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: fileId, caption, parse_mode: "HTML" }),
  });
  const result = await response.json().catch(() => ({}));
  return Boolean(result.ok);
}

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
      const reqAction = String(body.action || "").toLowerCase();

      if (reqAction === "register-request") {
        const telegramId = String(body.telegramId || "").trim();
        const name = String(body.name || "").trim();
        const role = String(body.role || "Қызметкер").trim();
        const username = String(body.username || "").trim();
        const firstName = String(body.firstName || "").trim();

        if (!telegramId || !name) {
          res.status(400).json({ error: "Telegram ID немесе аты-жөні бос" });
          return;
        }

        const store = await loadStore();
        const existing = store.employees.find(
          (e) => String(e.telegramId || "").trim() === telegramId,
        );
        if (existing) {
          res.status(400).json({ error: "Сіз бұрыннан тіркелгенсіз" });
          return;
        }

        try {
          await appendHistory([{
            at: new Date().toISOString(),
            action: "Тіркеу күтуде",
            employeeId: telegramId,
            name,
            date: "",
            oldLabel: role,
            newLabel: username || firstName || "",
          }]);
        } catch {}

        const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        const text = [
          "📥 <b>Жаңа тіркеу сұранысы</b>",
          "",
          `<b>Аты-жөні:</b> ${escapeHtml(name)}`,
          `<b>Рөлі:</b> ${escapeHtml(role)}`,
          username ? `<b>Telegram:</b> @${escapeHtml(username)}` : `<b>Аты:</b> ${escapeHtml(firstName)}`,
          `<b>ID:</b> <code>${escapeHtml(telegramId)}</code>`,
        ].join("\n");
        const keyboard = {
          inline_keyboard: [[
            { text: "✅ Растау", callback_data: `reg_approve:${telegramId}` },
            { text: "❌ Бас тарту", callback_data: `reg_reject:${telegramId}` },
          ]],
        };
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          for (const adminId of adminIds) {
            try {
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  chat_id: adminId,
                  text,
                  parse_mode: "HTML",
                  reply_markup: keyboard,
                }),
              });
            } catch {}
          }
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (reqAction === "broadcast") {
        const text = String(body.text || "").trim();
        const photoData = String(body.photo || "");
        let photoBuffer = null;
        if (photoData.startsWith("data:")) {
          const b64 = photoData.split(",")[1] || "";
          if (b64) photoBuffer = Buffer.from(b64, "base64");
        }
        if (!text && !photoBuffer) {
          res.status(400).json({ error: "Хабарлама не сурет керек" });
          return;
        }
        const store = await loadStore();
        const recipients = (store.employees || []).filter(
          (e) => e.status !== "archived" && e.telegramId,
        );
        const caption = (text ? `📢 <b>Хабарландыру</b>\n\n${escapeHtml(text)}` : "📢 <b>Хабарландыру</b>").slice(0, 1000);
        const textMsg = `📢 <b>Хабарландыру</b>\n\n${escapeHtml(text)}`;
        let sent = 0;
        let failed = 0;
        let fileId = "";
        for (const employee of recipients) {
          try {
            if (photoBuffer) {
              if (!fileId) {
                const r = await sendTelegramPhotoUpload(employee.telegramId, photoBuffer, caption);
                if (r.ok) { sent += 1; if (r.fileId) fileId = r.fileId; } else failed += 1;
              } else {
                const ok = await sendTelegramPhotoById(employee.telegramId, fileId, caption);
                if (ok) sent += 1; else failed += 1;
              }
            } else {
              const ok = await sendTelegramText(employee.telegramId, textMsg);
              if (ok) sent += 1; else failed += 1;
            }
          } catch {
            failed += 1;
          }
        }
        try {
          await appendHistory([{
            at: new Date().toISOString(),
            action: "Хабарландыру жіберілді",
            employeeId: "",
            name: "",
            date: "",
            oldLabel: photoBuffer ? "сурет" : "",
            newLabel: (text || "[сурет]").slice(0, 200),
          }]);
        } catch {}
        res.status(200).json({ sent, failed, total: recipients.length });
        return;
      }

      if (reqAction !== "advance") {
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
