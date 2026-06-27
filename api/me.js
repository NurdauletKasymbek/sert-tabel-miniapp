import PDFDocument from "pdfkit";
import { loadStore, monthlyHours, salaryReport } from "./_lib/sheets.js";
import { DEJAVU_SANS_BASE64 } from "./_fonts/dejavu-sans.js";

const PDF_FONT = Buffer.from(DEJAVU_SANS_BASE64, "base64");

function pdfMoney(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₸`;
}

// Айлық жалақы есептемесінен PDF құрастыру (қазақ кириллица — DejaVu қаріп).
function buildMonthlyPdf(report) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.registerFont("DejaVu", PDF_FONT);
      doc.font("DejaVu");

      doc.fontSize(18).text(`Айлық жалақы есебі — ${report.month}`);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#555")
        .text(`Құрылған: ${new Date().toLocaleString("ru-RU", { timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent" })}`);
      doc.fillColor("#000").moveDown(0.8);

      const cols = [
        { title: "Аты-жөні", width: 150, align: "left" },
        { title: "Күн", width: 48, align: "right" },
        { title: "Сағат", width: 54, align: "right" },
        { title: "Айлық", width: 78, align: "right" },
        { title: "Аванс", width: 70, align: "right" },
        { title: "Таза қолға", width: 84, align: "right" },
      ];
      const startX = doc.page.margins.left;
      const rowHeight = 20;
      const tableWidth = cols.reduce((s, c) => s + c.width, 0);

      function drawRow(y, values, { header = false, total = false } = {}) {
        let x = startX;
        if (header || total) {
          doc.rect(x, y - 3, tableWidth, rowHeight).fill(header ? "#0b1b5f" : "#eef2f8");
        }
        doc.fontSize(9).fillColor(header ? "#ffffff" : "#07122b");
        for (let i = 0; i < cols.length; i += 1) {
          doc.text(String(values[i] ?? ""), x + 4, y, { width: cols[i].width - 8, align: cols[i].align, lineBreak: false });
          x += cols[i].width;
        }
        doc.fillColor("#000");
      }

      let y = doc.y;
      drawRow(y, cols.map((c) => c.title), { header: true });
      y += rowHeight;
      for (const row of report.rows) {
        if (y > doc.page.height - doc.page.margins.bottom - rowHeight * 2) {
          doc.addPage();
          y = doc.page.margins.top;
          drawRow(y, cols.map((c) => c.title), { header: true });
          y += rowHeight;
        }
        drawRow(y, [row.name, row.workedEquivalentDays, row.totalHours, pdfMoney(row.monthlySalary), pdfMoney(row.advanceTotal), pdfMoney(row.net)]);
        y += rowHeight;
      }
      const t = report.totals || {};
      drawRow(y, ["Барлығы", t.workedEquivalentDays ?? "", t.totalHours ?? "", pdfMoney(t.monthlySalary), pdfMoney(t.advanceTotal), pdfMoney(t.net)], { total: true });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

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

  const report = { month, rows, totals };
  if (String(req.query.format || "").toLowerCase() === "pdf") {
    const pdf = await buildMonthlyPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="jalaqy-esep-${month}.pdf"`);
    res.status(200).send(pdf);
    return;
  }
  res.status(200).json(report);
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
