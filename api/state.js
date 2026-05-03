import { loadStore, publicState } from "./_lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const store = await loadStore();
  res.status(200).json(publicState(store));
}
