import { appendHistory, loadStore, nextEmployeeId, publicState, rebuildSummary, saveEmployees } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const name = String(body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Қызметкер аты керек" });
      return;
    }
    const telegramId = String(body.telegramId || "").trim();
    // Қайта тіркеу/қайта растау қорғанысы: сол Telegram ID-мен белсенді қызметкер
    // бұрыннан бар болса — жаңа жазба жасамаймыз (бұрынғы дерек жоғалмайды).
    if (telegramId) {
      const dup = store.employees.find(
        (e) => e.status !== "archived" && String(e.telegramId || "").trim() === telegramId,
      );
      if (dup) {
        res.status(200).json({ ...publicState(store), alreadyRegistered: true, employeeId: dup.id });
        return;
      }
    }
    const schedule = body.schedule === "school-half" ? "school-half" : "standard";
    const employee = {
      id: nextEmployeeId(store.employees),
      name,
      role: String(body.role || "Қызметкер").trim() || "Қызметкер",
      status: "active",
      createdAt: new Date().toISOString(),
      archivedAt: "",
      schedule,
      telegramId: String(body.telegramId || "").trim(),
    };
    store.employees.push(employee);
    await saveEmployees(store.employees);
    await appendHistory([{ at: new Date().toISOString(), action: "Қызметкер қосылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: "", newLabel: "Белсенді" }]);
    await rebuildSummary(store);
    res.status(201).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Қызметкер сақталмады: ${error.message}` });
  }
}
