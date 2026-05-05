function env(name) {
  return process.env[name] || "";
}

export function idsFromEnv(...names) {
  const ids = [];
  for (const name of names) {
    ids.push(...env(name).split(","));
  }
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function miniAppKeyboard() {
  const url = env("MINI_APP_URL").trim();
  if (!url) return undefined;
  return {
    inline_keyboard: [[{ text: "Mini App ашу", web_app: { url } }]],
  };
}

export async function sendTelegramMessage(chatId, text, extra = {}) {
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
      ...extra,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.description || "Telegram хабарлама жіберілмеді");
  return result;
}
