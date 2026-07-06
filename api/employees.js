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
      // Аты бірдей, бірақ Telegram-сыз белсенді қызметкер бұрыннан бар болса —
      // жаңа жазба жасамай, соған telegramId-ді байлаймыз. Осылайша қолмен
      // қосылған адам кейін өзі Telegram арқылы тіркелгенде дубликат болмайды.
      const sameName = store.employees.find(
        (e) => e.status !== "archived"
          && !String(e.telegramId || "").trim()
          && e.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (sameName) {
        sameName.telegramId = telegramId;
        await saveEmployees(store.employees);
        await appendHistory([{ at: new Date().toISOString(), action: "Telegram байланды", employeeId: sameName.id, name: sameName.name, date: "", oldLabel: "", newLabel: telegramId }]);
        res.status(200).json({ ...publicState(store), boundExisting: true, employeeId: sameName.id });
        return;
      }
    }
    // Терминалдан тіркеу: карта UID бірге келеді. Карта бос болуы тексеріледі.
    const cardUid = String(body.cardUid || "").trim();
    if (cardUid) {
      const owner = store.employees.find(
        (e) => e.status !== "archived" &&
          String(e.cardUid || "").trim().toLowerCase() === cardUid.toLowerCase(),
      );
      if (owner) {
        res.status(409).json({ error: `Бұл карта тіркелген: ${owner.name}` });
        return;
      }
    }
    // Табель № автоматты: бар нөмірлердің ең үлкені + 1
    let tabNumber = String(body.tabNumber || "").trim();
    if (!tabNumber) {
      const maxTab = store.employees.reduce((m, e) => {
        const n = parseInt(String(e.tabNumber || "").replace(/\D/g, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      tabNumber = String(maxTab + 1);
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
      cardUid,
      tabNumber,
    };
    store.employees.push(employee);
    await saveEmployees(store.employees);
    await appendHistory([{ at: new Date().toISOString(), action: "Қызметкер қосылды", employeeId: employee.id, name: employee.name, date: "", oldLabel: "", newLabel: `Белсенді${cardUid ? ` (карта: ${cardUid})` : ""}` }]);
    await rebuildSummary(store);
    res.status(201).json({ ...publicState(store), employeeId: employee.id, tabNumber });
  } catch (error) {
    res.status(500).json({ error: `Қызметкер сақталмады: ${error.message}` });
  }
}
