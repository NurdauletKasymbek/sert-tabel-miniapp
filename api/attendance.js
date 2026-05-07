import { appendHistory, assertNotFutureDate, currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel, todayDate, STATUSES } from "./_lib/sheets.js";

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
    const status = String(body.status || "");
    const employee = store.employees.find((item) => item.id === employeeId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee || !STATUSES[status]) {
      res.status(400).json({ error: "Күн, қызметкер немесе статус қате" });
      return;
    }
    assertNotFutureDate(date);

    const label = statusToLabel(status);
    const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
    const oldLabel = existing?.label || "";
    const role = employee.role || "Қызметкер";

    // Keep only one record per employee per day so changing a mistaken mark really replaces it.
    store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
    const now = currentTime();
    const isNewCheckIn = !existing && status === "present" && date === todayDate();
    const newCheckIn = existing?.checkInTime || (status === "present" ? now : "");
    let lateMin = existing?.lateMinutes || 0;
    if (isNewCheckIn) {
      const timeZone = process.env.BOT_TIMEZONE || "Asia/Almaty";
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(new Date());
      const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
      const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
      const total = h * 60 + m;
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
