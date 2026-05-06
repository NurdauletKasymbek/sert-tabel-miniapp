export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN орнатылмаған" });
    return;
  }

  const secret = process.env.BOT_WEBHOOK_SECRET || "";
  const appUrl = (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.MINI_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) {
    res.status(500).json({ error: "MINI_APP_URL немесе VERCEL_URL орнатылмаған" });
    return;
  }

  const webhookUrl = `${appUrl}/api/bot`;

  try {
    const payload = { url: webhookUrl, allowed_updates: ["message", "callback_query"] };
    if (secret) payload.secret_token = secret;

    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!result.ok) {
      res.status(500).json({ error: result.description || "setWebhook сәтсіз болды" });
      return;
    }

    res.status(200).json({ ok: true, webhookUrl, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
