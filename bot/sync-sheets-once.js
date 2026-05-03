import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data.json");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const serviceAccount = loadGoogleServiceAccount();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const GOOGLE_CLIENT_EMAIL = cleanGoogleEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || serviceAccount?.client_email || "";
const GOOGLE_PRIVATE_KEY = (cleanGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY) || serviceAccount?.private_key || "").replaceAll("\\n", "\n");

const STATUSES = {
  present: { label: "Жұмыста" },
  absent: { label: "Жоқ" },
  half: { label: "Жарты күн" },
  sick: { label: "Ауырып қалды" },
  dayoff: { label: "Демалыс" },
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ||= value;
  }
}

function loadGoogleServiceAccount() {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? path.resolve(__dirname, "..", process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : path.join(__dirname, "google-service-account.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function cleanGoogleEmail(value = "") {
  if (!value || value.includes("service-account-name@project-id")) return "";
  return value;
}

function cleanGooglePrivateKey(value = "") {
  if (!value || value.includes("...")) return "";
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(GOOGLE_PRIVATE_KEY, "base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "Google token алынбады");
  return result.access_token;
}

async function googleSheetsFetch(pathname, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Google Sheets API қатесі");
  return result;
}

async function ensureSheets() {
  const spreadsheet = await googleSheetsFetch("?fields=sheets.properties.title");
  const existing = new Set(spreadsheet.sheets.map((sheet) => sheet.properties.title));
  const requests = ["Employees", "Attendance", "Daily Control", "Summary", "History"]
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));
  if (requests.length) await googleSheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
}

async function updateSheetRange(range, values) {
  await googleSheetsFetch(`/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: "{}" });
  await googleSheetsFetch(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

function allEmployees(data) {
  return Object.entries(data.employees || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name, "kk"));
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function getAttendance(data, date, employeeId) {
  return data.attendance?.[date]?.[employeeId];
}

function statusCounts(data, employeeId, month) {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const record = getAttendance(data, date, employeeId);
    if (counts[record?.status] !== undefined) counts[record.status] += 1;
  }
  return counts;
}

function activeEmployees(data) {
  return allEmployees(data).filter(([, employee]) => employee.status !== "archived");
}

function dayControl(data, date) {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0, unmarked: 0 };
  const records = data.attendance?.[date] || {};
  for (const [id] of activeEmployees(data)) {
    const status = records[id]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
    else counts.unmarked += 1;
  }
  return { ...counts, total: activeEmployees(data).length };
}

async function main() {
  if (!SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) throw new Error("Google Sheets config толық емес.");
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  await ensureSheets();

  const employees = [
    ["ID", "Аты-жөні", "Рөлі", "Статус", "Қосылған күні", "Архив күні"],
    ...allEmployees(data).map(([id, employee]) => [
      id,
      employee.name,
      employee.role || "Қызметкер",
      employee.status === "archived" ? "Архив" : "Белсенді",
      employee.createdAt || "",
      employee.archivedAt || "",
    ]),
  ];

  const attendance = [["Күн", "Қызметкер ID", "Аты-жөні", "Рөлі", "Белгі", "Уақыт", "Жаңартылды"]];
  for (const date of Object.keys(data.attendance || {}).sort()) {
    for (const [employeeId, record] of Object.entries(data.attendance[date])) {
      const employee = data.employees[employeeId];
      attendance.push([
        date,
        employeeId,
        employee?.name || "",
        employee?.role || "",
        STATUSES[record.status]?.label || record.status,
        record.time || "",
        record.updatedAt || "",
      ]);
    }
  }

  const daily = [["Күн", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Белгі жоқ", "Барлығы"]];
  for (const date of Object.keys(data.attendance || {}).sort()) {
    const counts = dayControl(data, date);
    daily.push([date, counts.present, counts.half, counts.absent, counts.dayoff, counts.unmarked, counts.total]);
  }

  const summary = [["Ай", "Қызметкер ID", "Аты-жөні", "Рөлі", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Барлығы белгіленген"]];
  const months = new Set(Object.keys(data.attendance || {}).map((date) => date.slice(0, 7)));
  for (const month of [...months].sort()) {
    for (const [id, employee] of allEmployees(data)) {
      const counts = statusCounts(data, id, month);
      summary.push([
        month,
        id,
        employee.name,
        employee.role || "Қызметкер",
        counts.present,
        counts.half,
        counts.absent,
        counts.dayoff,
        counts.present + counts.half + counts.absent + counts.dayoff,
      ]);
    }
  }

  const history = [
    ["Уақыт", "Әрекет", "Қызметкер ID", "Аты-жөні", "Күн", "Бұрынғы белгі", "Жаңа белгі"],
    ...(data.history || []).map((row) => [
      row.at,
      row.action,
      row.employeeId,
      row.name,
      row.date,
      row.oldLabel || "",
      row.newLabel || "",
    ]),
  ];

  await updateSheetRange("Employees!A1:F1000", employees);
  await updateSheetRange("Attendance!A1:G5000", attendance);
  await updateSheetRange("Daily Control!A1:G2000", daily);
  await updateSheetRange("Summary!A1:I2000", summary);
  await updateSheetRange("History!A1:G5000", history);
  console.log(`Synced: employees=${employees.length - 1}, attendance=${attendance.length - 1}, daily=${daily.length - 1}, summary=${summary.length - 1}, history=${history.length - 1}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
