import { appendHistory, assertNotFutureDate, currentTime, invalidateStoreCache, loadStore, publicState, rebuildSummary, statusToLabel, upsertAttendance } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    invalidateStoreCache();
    const store = await loadStore();
    const date = String(body.date || "");
    const role = String(body.role || "");
    const status = String(body.status || "present");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || status !== "present") {
      res.status(400).json({ error: "Күн немесе статус қате" });
      return;
    }
    assertNotFutureDate(date);

    const targets = store.employees.filter((employee) => employee.status !== "archived" && (!role || employee.role === role));
    const targetIds = new Set(targets.map((employee) => employee.id));
    const previousByEmployee = new Map();

    for (const row of store.attendance) {
      if (row.date === date && targetIds.has(row.employeeId)) previousByEmployee.set(row.employeeId, row.label || "");
    }

    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;

    const now = new Date().toISOString();
    const time = currentTime();
    const history = [];
    const changed = [];
    for (const employee of targets) {
      const oldLabel = previousByEmployee.get(employee.id) || "";
      const employeeRole = employee.role || "Қызметкер";
      const employeeStatus = employee.schedule === "school-half" && !isWeekend ? "half" : status;
      const label = statusToLabel(employeeStatus);
      // Бар жазбаның Кіру/Шығу сағатын жоғалтпаймыз — тек белгіні (статусты) жаңартамыз.
      const prev = store.attendance.find((row) => row.date === date && row.employeeId === employee.id);
      changed.push({
        date,
        employeeId: employee.id,
        name: employee.name,
        role: employeeRole,
        label,
        time: prev?.time || time,
        updatedAt: now,
        checkInTime: prev?.checkInTime || "",
        checkOutTime: prev?.checkOutTime || "",
        lateMinutes: prev?.lateMinutes || 0,
        earlyMinutes: prev?.earlyMinutes || 0,
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

    await upsertAttendance(changed);
    await appendHistory(history);
    invalidateStoreCache();
    const fresh = await loadStore();
    await rebuildSummary(fresh);
    res.status(200).json(publicState(fresh));
  } catch (error) {
    res.status(500).json({ error: `Жаппай белгі сақталмады: ${error.message}` });
  }
}
