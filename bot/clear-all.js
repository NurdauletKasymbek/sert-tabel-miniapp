import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const serviceAccount = loadServiceAccount();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const CLIENT_EMAIL = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || serviceAccount?.client_email || "").trim();
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || serviceAccount?.private_key || "").replaceAll("\\n", "\n");

const KNOWN_SHEETS = [
  "Қызметкерлер",
  "Табель",
  "Есеп",
  "Журнал",
  "Employees",
  "Attendance",
  "Reports",
  "Summary",
  "History",
  "Daily Control",
];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ||= value;
  }
}

function loadServiceAccount() {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? path.resolve(__dirname, "..", process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : path.join(__dirname, "google-service-account.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(PRIVATE_KEY, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "Google token алынбады");
  return result.access_token;
}

async function clearRange(token, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:clear`;
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  return response.ok;
}

async function listSheets(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Парақтар тізімі алынбады");
  return result.sheets.map((sheet) => sheet.properties.title);
}

async function main() {
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) throw new Error("Google Sheets конфигурациясы толық емес.");
  const token = await getToken();
  const existing = await listSheets(token);
  console.log(`Табылған парақтар (${existing.length}):`, existing.join(", "));

  const targets = new Set([...existing, ...KNOWN_SHEETS]);
  for (const title of targets) {
    if (!existing.includes(title)) continue;
    const range = `'${title.replace(/'/g, "''")}'!A2:Z10000`;
    const ok = await clearRange(token, range);
    console.log(ok ? `Тазаланды: ${title}` : `Өткізілді: ${title}`);
  }
  console.log("\nДайын. Барлық парақтар тазартылды. Енді мини апп арқылы қызметкер қоса аласыз.");
}

main().catch((error) => {
  console.error("Қате:", error.message);
  process.exit(1);
});
