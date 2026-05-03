import { currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel, STATUSES } from "./_lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const store = await loadStore();
  const date = String(req.body?.date || "");
  const employeeId = String(req.body?.employeeId || "");
  const status = String(req.body?.status || "");
  const employee = store.employees.find((item) => item.id === employeeId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee || !STATUSES[status]) {
    res.status(400).json({ error: "Күн, қызметкер немесе статус қате" });
    return;
  }
  const label = statusToLabel(status);
  const existing = store.attendance.find((row) => row.date === date && row.employeeId === employeeId);
  if (existing) {
    existing.name = employee.name;
    existing.role = employee.role || "Қызметкер";
    existing.label = label;
    existing.time = currentTime();
    existing.updatedAt = new Date().toISOString();
  } else {
    store.attendance.push({
      date,
      employeeId,
      name: employee.name,
      role: employee.role || "Қызметкер",
      label,
      time: currentTime(),
      updatedAt: new Date().toISOString(),
    });
  }
  await saveAttendance(store.attendance);
  await rebuildSummary(store);
  res.status(200).json(publicState(store));
}
