import { appendHistory, assertNotFutureDate, currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel, todayDate, STATUSES } from "./_lib/sheets.js";

const HALF_DAY_AFTER_HOUR = 12;
const HALF_DAY_THRESHOLD_HOURS = 4.5;

function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const date = String(body.date || "");
    const employeeId = String(body.employeeId || "");
    const action = String(body.action || "").toLowerCase();
    const employee = store.employees.find((item) => item.id === employeeId);

    if (action === "checkout") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee) {
        res.status(400).json({ error: "Күн немесе қызметкер ID қате" });
        return;
      }
      const checkOutTime = String(body.checkOutTime || "");
      const earlyMinutes = Number(body.earlyMinutes) || 0;
      const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
      if (!existing) {
        res.status(400).json({ error: "Бүгінгі кіру белгісі табылмады" });
        return;
      }

      let newLabel = existing.label;
      if (existing.checkInTime && checkOutTime) {
        const workedMinutes = timeToMinutes(checkOutTime) - timeToMinutes(existing.checkInTime);
        if (workedMinutes > 0 && workedMinutes < HALF_DAY_THRESHOLD_HOURS * 60 && existing.label === "Жұмыста") {
          newLabel = "Жарты күн";
        }
      }

      store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
      store.attendance.push({
        ...existing,
        label: newLabel,
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
        newLabel: `Шығу: ${checkOutTime}${earlyMinutes > 0 ? ` (${earlyMinutes} мин ерте)` : ""}${newLabel !== existing.label ? ` [${newLabel}]` : ""}`,
      }]);
      await rebuildSummary({ ...store });
      res.status(200).json(publicState(store));
      return;
    }

    let status = String(body.status || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee || !STATUSES[status]) {
      res.status(400).json({ error: "Күн, қызметкер немесе статус қате" });
      return;
    }
    assertNotFutureDate(date);

    const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
    const oldLabel = existing?.label || "";
    const role = employee.role || "Қызметкер";
    const now = currentTime();
    const isNewCheckIn = !existing && status === "present" && date === todayDate();

    if (isNewCheckIn) {
      const checkInHour = Number(now.split(":")[0] || 0);
      if (checkInHour >= HALF_DAY_AFTER_HOUR) {
        status = "half";
      }
    }
    const label = statusToLabel(status);

    // Keep only one record per employee per day so changing a mistaken mark really replaces it.
    store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
    const newCheckIn = existing?.checkInTime || ((status === "present" || status === "half") ? now : "");
    let lateMin = existing?.lateMinutes || 0;
    if (isNewCheckIn) {
      const total = timeToMinutes(now);
      lateMin = total > 9 * 60 ? total - 9 * 60 : 0;
    }
    store.attendance.push({
      date,
      employeeId,
      name: employee.name,
      role,
      label,
      time: now,
      updatedAt: new Date().toISOString(),
      checkInTime: newCheckIn,
      checkOutTime: existing?.checkOutTime || "",
      lateMinutes: lateMin,
      earlyMinutes: existing?.earlyMinutes || 0,
    });

    await saveAttendance(store.attendance);
    await appendHistory([{
      at: new Date().toISOString(),
      action: oldLabel ? "Белгі өзгерді" : "Белгі қойылды",
      employeeId,
      name: employee.name,
      date,
      oldLabel,
      newLabel: label,
    }]);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Белгі сақталмады: ${error.message}` });
  }
}
