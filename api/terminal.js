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
    // Әкімші карталары (Әкімшілер парағының "Карта UID" бағаны + толық admin рөлі) —
    // терминал осы карталар басылғанда әкімші мәзірін ашады
    const adminCardUids = (store.admins || [])
      .filter((a) => a.role === "admin" && a.cardUid)
      .map((a) => a.cardUid);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ employees, adminCardUids });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
