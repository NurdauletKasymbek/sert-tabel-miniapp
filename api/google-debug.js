import { googleConfigDiagnostics } from "./_lib/sheets.js";

export default function handler(req, res) {
  res.status(200).json(googleConfigDiagnostics());
}
