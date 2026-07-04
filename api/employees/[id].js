import { appendHistory, loadStore, publicState, rebuildSummary, saveEmployees } from "../_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "PATCH") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const employee = store.employees.find((item) => item.id === req.query.id);
    if (!employee) {
      res.status(404).json({ error: "Қызметкер табылмады" });
      return;
    }
    // Жұмысшының өзі айлығын енгізуі (Mini App бір реттік сұрау терезесі).
    // selfUserId келсе — тек өз жазбасына және айлық әлі қойылмаған кезде ғана.
    const selfUserId = String(body.selfUserId || "").trim();
    if (selfUserId) {
      if (String(employee.telegramId || "").trim() !== selfUserId) {
        res.status(403).json({ error: "Бұл әрекетке рұқсатыңыз жоқ" });
        return;
      }
      if (Number(employee.monthlySalary) > 0) {
        res.status(409).json({ error: "Айлық жалақы бұрын қойылған. Өзгерту — тек әкімші арқылы." });
        return;
      }
      const value = Number(String(body.monthlySalary ?? "").replace(/[^\d]/g, "")) || 0;
      if (value <= 0) {
        res.status(400).json({ error: "Дұрыс сома енгізіңіз" });
        return;
      }
      employee.monthlySalary = value;
      await saveEmployees(store.employees);
      await appendHistory([{ at: new Date().toISOString(), action: "Айлық жалақы енгізілді (өзі)", employeeId: employee.id, name: employee.name, date: "", oldLabel: "0", newLabel: String(value) }]);
      await rebuildSummary(store);
      res.status(200).json({ ok: true, monthlySalary: value });
      return;
    }
    if (body.name !== undefined) employee.name = String(body.name).trim();
    if (body.role !== undefined) employee.role = String(body.role).trim() || "Қызметкер";
    if (body.schedule !== undefined) employee.schedule = body.schedule === "school-half" ? "school-half" : "standard";
    if (body.telegramId !== undefined) {
      const newTid = body.telegramId ? String(body.telegramId).trim() : "";
      employee.telegramId = newTid;
      // Бір Telegram ID — бір адам: басқа қызметкерден сол ID-ді алып тастаймыз.
      if (newTid) {
        for (const other of store.employees) {
          if (other.id !== employee.id && String(other.telegramId || "").trim() === newTid) {
            other.telegramId = "";
          }
        }
      }
    }
    if (body.monthlySalary !== undefined) employee.monthlySalary = Number(String(body.monthlySalary).replace(/[^\d.-]/g, "")) || 0;
    if (body.status === "archived" || body.status === "active") {
      const oldStatus = employee.status === "archived" ? "Архив" : "Белсенді";
      employee.status = body.status;
      employee.archivedAt = body.status === "archived" ? new Date().toISOString() : "";
      const newStatus = employee.status === "archived" ? "Архив" : "Белсенді";
      await appendHistory([{ at: new Date().toISOString(), action: employee.status === "archived" ? "Архивке жіберілді" : "Архивтен қайтарылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: oldStatus, newLabel: newStatus }]);
    }
    await saveEmployees(store.employees);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Қызметкер өзгертілмеді: ${error.message}` });
  }
}
