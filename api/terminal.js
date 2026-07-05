import { loadStore } from "./_lib/sheets.js";

// Терминалға (Android) қызметкерлер тізімін береді — бет тану (1:N) және карта үшін.
// GET /api/terminal → { employees: [{id, name, role, cardUid, tabNumber, faceVector}] }
export default async function handler(req, res) {
  try {
    const store = await loadStore();
    const employees = (store.employees || [])
      .filter((e) => e.status !== "archived")
      .map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role || "",
        cardUid: e.cardUid || "",
        tabNumber: e.tabNumber || "",
        faceVector: e.faceVector || "",
      }));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ employees });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
