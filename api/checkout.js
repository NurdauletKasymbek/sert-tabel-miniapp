import { appendHistory, loadStore, publicState, saveAttendance } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const date = String(body.date || "");
    const employeeId = String(body.employeeId || "");
    const checkOutTime = String(body.checkOutTime || "");
    const earlyMinutes = Number(body.earlyMinutes) || 0;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employeeId) {
      res.status(400).json({ error: "Күн немесе қызметкер ID қате" });
      return;
    }

    const store = await loadStore();
    const employee = store.employees.find((e) => e.id === employeeId)
      || store.employees.find((e) => e.id === employeeId); // also check all
    if (!employee) {
      res.status(400).json({ error: "Қызметкер табылмады" });
      return;
    }

    const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
    if (!existing) {
      res.status(400).json({ error: "Бүгінгі кіру белгісі табылмады" });
      return;
    }

    store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
    store.attendance.push({
      ...existing,
      checkOutTime,
      earlyMinutes,
      updatedAt: new Date().toISOString(),
    });

    await saveAttendance(store.attendance);
    await appendHistory([{
      at: new Date().toISOString(),
      action: "Шығу белгіленді",
      employeeId,
      name: employee.name,
      date,
      oldLabel: existing.label,
      newLabel: `Шығу: ${checkOutTime}${earlyMinutes > 0 ? ` (${earlyMinutes} мин ерте)` : ""}`,
    }]);

    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Шығу сақталмады: ${error.message}` });
  }
}
