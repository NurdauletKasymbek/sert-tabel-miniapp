import { appendHistory, loadStore, publicState, rebuildSummary, saveEmployees } from "../_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "PATCH") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const employee = store.employees.find((item) => item.id === req.query.id);
    if (!employee) {
      res.status(404).json({ error: "Қызметкер табылмады" });
      return;
    }
    if (body.name !== undefined) employee.name = String(body.name).trim();
    if (body.role !== undefined) employee.role = String(body.role).trim() || "Қызметкер";
    if (body.schedule !== undefined) employee.schedule = body.schedule === "school-half" ? "school-half" : "standard";
    if (body.telegramId !== undefined) employee.telegramId = body.telegramId ? String(body.telegramId).trim() : "";
    if (body.status === "archived" || body.status === "active") {
      const oldStatus = employee.status === "archived" ? "Архив" : "Белсенді";
      employee.status = body.status;
      employee.archivedAt = body.status === "archived" ? new Date().toISOString() : "";
      const newStatus = employee.status === "archived" ? "Архив" : "Белсенді";
      await appendHistory([{ at: new Date().toISOString(), action: employee.status === "archived" ? "Архивке жіберілді" : "Архивтен қайтарылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: oldStatus, newLabel: newStatus }]);
    }
    await saveEmployees(store.employees);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Қызметкер өзгертілмеді: ${error.message}` });
  }
}
