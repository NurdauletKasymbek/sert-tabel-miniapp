import { appendHistory, loadStore, publicState, rebuildSummary, saveEmployees } from "../_lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const store = await loadStore();
  const employee = store.employees.find((item) => item.id === req.query.id);
  if (!employee) {
    res.status(404).json({ error: "Қызметкер табылмады" });
    return;
  }
  if (req.body?.name !== undefined) employee.name = String(req.body.name).trim();
  if (req.body?.role !== undefined) employee.role = String(req.body.role).trim() || "Қызметкер";
  if (req.body?.status === "archived" || req.body?.status === "active") {
    const oldStatus = employee.status === "archived" ? "Архив" : "Белсенді";
    employee.status = req.body.status;
    employee.archivedAt = req.body.status === "archived" ? new Date().toISOString() : "";
    const newStatus = employee.status === "archived" ? "Архив" : "Белсенді";
    await appendHistory([{ at: new Date().toISOString(), action: employee.status === "archived" ? "Архивке жіберілді" : "Архивтен қайтарылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: oldStatus, newLabel: newStatus }]);
  }
  await saveEmployees(store.employees);
  await rebuildSummary(store);
  res.status(200).json(publicState(store));
}
