import { loadStore, monthlyHours, salaryReport } from "./_lib/sheets.js";

function todayInTashkent() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function handler(req, res) {
  try {
    const userId = String(req.query.userId || "").trim();
    const full = req.query.full === "1";
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isAdmin = Boolean(userId) && adminIds.includes(userId);

    if (!full) {
      res.status(200).json({ isAdmin, userId });
      return;
    }

    if (!userId) {
      res.status(200).json({ isAdmin: false, userId: "", employee: null });
      return;
    }

    const store = await loadStore();
    const employee = store.employees.find(
      (e) => {
        const tid = String(e.telegramId || "").trim();
        return tid && tid === userId;
      },
    );

    if (!employee) {
      res.status(200).json({ isAdmin: Boolean(isAdmin), userId, employee: null });
      return;
    }

    const today = todayInTashkent();
    const month = today.slice(0, 7);

    const ownAttendance = store.attendance.filter(
      (row) => row.employeeId === employee.id && row.date.startsWith(month),
    );

    const todayRow = ownAttendance.find((row) => row.date === today) || null;
    const ownAdvances = (store.advances || []).filter(
      (adv) => adv.employeeId === employee.id && (adv.date || "").startsWith(month),
    );
    const advanceTotal = ownAdvances.reduce((sum, a) => sum + (a.amount || 0), 0);

    const labelToStatus = { "Жұмыста": "present", "Жарты күн": "half", "Жоқ": "absent", "Демалыс": "dayoff" };
    const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
    for (const row of ownAttendance) {
      const status = labelToStatus[row.label];
      if (status && counts[status] !== undefined) counts[status] += 1;
    }

    const hours = monthlyHours(store.attendance, employee.id, month);
    const salary = salaryReport(store, employee.id, month);

    const broadcasts = (store.history || [])
      .filter((h) => h.action === "Хабарландыру жіберілді")
      .slice(-10)
      .reverse()
      .map((h) => ({ at: h.at, text: h.newLabel }));

    res.status(200).json({
      isAdmin: Boolean(isAdmin),
      userId,
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        telegramId: employee.telegramId,
      },
      today,
      month,
      todayRow,
      ownAttendance,
      ownAdvances,
      advanceTotal,
      counts,
      hours,
      salary,
      broadcasts,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
