import { loadStore, nextEmployeeId, publicState, rebuildSummary, saveEmployees } from "./_lib/sheets.js";

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
  store.employees.push({
    id: nextEmployeeId(store.employees),
    name,
    role: String(req.body?.role || "Қызметкер").trim() || "Қызметкер",
    status: "active",
    createdAt: new Date().toISOString(),
    archivedAt: "",
  });
  await saveEmployees(store.employees);
  await rebuildSummary(store);
  res.status(201).json(publicState(store));
}
