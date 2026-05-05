import { appendHistory, assertNotFutureDate, currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel } from "./_lib/sheets.js";

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
    assertNotFutureDate(date);

    const label = statusToLabel(status);
    const targets = store.employees.filter((employee) => employee.status !== "archived" && (!role || employee.role === role));
    const targetIds = new Set(targets.map((employee) => employee.id));
    const previousByEmployee = new Map();

    for (const row of store.attendance) {
      if (row.date === date && targetIds.has(row.employeeId)) previousByEmployee.set(row.employeeId, row.label || "");
    }

    // Remove previous records first; bulk marking should also replace mistaken marks.
    store.attendance = store.attendance.filter((row) => !(row.date === date && targetIds.has(row.employeeId)));

    const now = new Date().toISOString();
    const time = currentTime();
    const history = [];
    for (const employee of targets) {
      const oldLabel = previousByEmployee.get(employee.id) || "";
      const employeeRole = employee.role || "Қызметкер";
      store.attendance.push({
        date,
        employeeId: employee.id,
        name: employee.name,
        role: employeeRole,
        label,
        time,
        updatedAt: now,
      });
      history.push({
        at: now,
        action: oldLabel ? "Жаппай өзгерді" : "Жаппай белгі қойылды",
        employeeId: employee.id,
        name: employee.name,
        date,
        oldLabel,
        newLabel: label,
      });
    }

    await saveAttendance(store.attendance);
    await appendHistory(history);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Жаппай белгі сақталмады: ${error.message}` });
  }
}
