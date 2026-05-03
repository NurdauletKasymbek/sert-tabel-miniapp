import { appendHistory, loadStore, nextEmployeeId, publicState, rebuildSummary, saveEmployees } from "./_lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const store = await loadStore();
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Қызметкер аты керек" });
    return;
  }
  const employee = {
    id: nextEmployeeId(store.employees),
    name,
    role: String(req.body?.role || "Қызметкер").trim() || "Қызметкер",
    status: "active",
    createdAt: new Date().toISOString(),
    archivedAt: "",
  };
  store.employees.push(employee);
  await saveEmployees(store.employees);
  await appendHistory([{ at: new Date().toISOString(), action: "Қызметкер қосылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: "", newLabel: "Белсенді" }]);
  await rebuildSummary(store);
  res.status(201).json(publicState(store));
}
