export default async function handler(req, res) {
  try {
    const userId = String(req.query.userId || "").trim();
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isAdmin = adminIds.length === 0 || (userId && adminIds.includes(userId));
    res.status(200).json({ isAdmin: Boolean(isAdmin), userId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
