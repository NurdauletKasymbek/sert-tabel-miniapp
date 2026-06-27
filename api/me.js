import { loadStore, monthlyHours, salaryReport } from "./_lib/sheets.js";

function todayInTashkent() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentMonth() {
  return todayInTashkent().slice(0, 7);
}

// Айлық жалақы есептемесі (барлық белсенді қызметкер) — бот PDF жасау үшін.
// Бөлек serverless функция болмас үшін осы /api/me ішінде report=monthly режимі.
async function monthlyReport(req, res) {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
    ? String(req.query.month)
    : currentMonth();
  const store = await loadStore();
  const employees = store.employees
    .filter((e) => e.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name, "kk"));

  const rows = employees.map((employee) => {
    const s = salaryReport(store, employee.id, month);
    return {
      id: employee.id,
      name: employee.name,
      role: employee.role || "Қызметкер",
      workedEquivalentDays: s.workedEquivalentDays,
      totalHours: s.totalHours,
      advanceTotal: s.advanceTotal,
      monthlySalary: s.monthlySalary,
      earned: s.earned,
      net: s.net,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.workedEquivalentDays += r.workedEquivalentDays;
      acc.totalHours += r.totalHours;
      acc.advanceTotal += r.advanceTotal;
      acc.monthlySalary += r.monthlySalary;
      acc.earned += r.earned;
      acc.net += r.net;
      return acc;
    },
    { workedEquivalentDays: 0, totalHours: 0, advanceTotal: 0, monthlySalary: 0, earned: 0, net: 0 },
  );
  totals.workedEquivalentDays = Math.round(totals.workedEquivalentDays * 100) / 100;
  totals.totalHours = Math.round(totals.totalHours * 10) / 10;

  res.status(200).json({ month, rows, totals });
}

export default async function handler(req, res) {
  try {
    if (req.query.report === "monthly") {
      await monthlyReport(req, res);
      return;
    }
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
