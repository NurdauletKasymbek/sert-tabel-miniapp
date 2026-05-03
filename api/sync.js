import { loadStore, publicState, rebuildSummary, saveAttendance, saveEmployees } from "./_lib/sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const store = await loadStore();
    await saveEmployees(store.employees);
    await saveAttendance(store.attendance);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Google Sheets жаңартылмады: ${error.message}` });
  }
}
