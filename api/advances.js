import { appendAdvance, loadStore, publicState } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
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
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Аванс сақталмады: ${error.message}` });
  }
}
