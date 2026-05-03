import { appendHistory, currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const date = String(body.date || "");
    const role = String(body.role || "");
    const status = String(body.status || "present");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || status !== "present") {
      res.status(400).json({ error: "Күн немесе статус қате" });
      return;
    }
    const label = statusToLabel(status);
    const targets = store.employees.filter((employee) => employee.status !== "archived" && (!role || employee.role === role));
    const history = [];
    for (const employee of targets) {
      const existing = store.attendance.find((row) => row.date === date && row.employeeId === employee.id);
      const oldLabel = existing?.label || "";
      if (existing) {
        existing.name = employee.name;
        existing.role = employee.role || "Қызметкер";
        existing.label = label;
        existing.time = currentTime();
        existing.updatedAt = new Date().toISOString();
      } else {
        store.attendance.push({ date, employeeId: employee.id, name: employee.name, role: employee.role || "Қызметкер", label, time: currentTime(), updatedAt: new Date().toISOString() });
      }
      history.push({ at: new Date().toISOString(), action: oldLabel ? "Жаппай өзгерді" : "Жаппай белгі қойылды", employeeId: employee.id, name: employee.name, date, oldLabel, newLabel: label });
    }
    await saveAttendance(store.attendance);
    await appendHistory(history);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Жаппай белгі сақталмады: ${error.message}` });
  }
}
