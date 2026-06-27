import { loadStore, salaryReport } from "./_lib/sheets.js";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()).slice(0, 7);
}

// Айлық жалақы есептемесі — бот PDF жасау үшін осыдан алады.
// Барлық белсенді қызметкер бойынша: істелген күн эквиваленті, сағат,
// аванс, бекітілген айлық, есептелген және таза қолға тиетін сома.
export default async function handler(req, res) {
  try {
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
  } catch (error) {
    res.status(500).json({ error: `Айлық есеп алынбады: ${error.message}` });
  }
}
