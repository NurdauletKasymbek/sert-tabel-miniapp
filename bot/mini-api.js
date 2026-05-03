import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data.json");
const PORT = Number(process.env.MINI_API_PORT || 8787);

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const GOOGLE_SERVICE_ACCOUNT = loadGoogleServiceAccount();
const GOOGLE_CLIENT_EMAIL = cleanGoogleEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || GOOGLE_SERVICE_ACCOUNT?.client_email || "";
const GOOGLE_PRIVATE_KEY = (cleanGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY) || GOOGLE_SERVICE_ACCOUNT?.private_key || "").replaceAll("\\n", "\n");
const TIME_ZONE = process.env.BOT_TIMEZONE || "Asia/Almaty";

const STATUSES = {
  present: { label: "Жұмыста" },
  half: { label: "Жарты күн" },
  absent: { label: "Жоқ" },
  dayoff: { label: "Демалыс" },
};

const defaultData = {
  nextEmployeeId: 1,
  employees: {},
  attendance: {},
  sessions: {},
  sheetSync: null,
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

async function loadData() {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    return normalizeData({ ...defaultData, ...JSON.parse(raw) });
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(defaultData);
    throw error;
  }
}

function normalizeData(data) {
  data.nextEmployeeId ||= 1;
  data.employees ||= {};
  data.attendance ||= {};
  data.sessions ||= {};
  for (const employee of Object.values(data.employees)) {
    employee.status ||= "active";
    employee.role ||= "Қызметкер";
  }
  return data;
}

async function saveData(data) {
  await mkdir(__dirname, { recursive: true });
  const tempPath = `${DATA_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, DATA_PATH);
}

function nextEmployeeId(data) {
  const id = `emp_${String(data.nextEmployeeId).padStart(4, "0")}`;
  data.nextEmployeeId += 1;
  return id;
}

function activeEmployees(data) {
  return Object.entries(data.employees)
    .filter(([, employee]) => employee.status !== "archived")
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, "kk"));
}

function allEmployees(data) {
  return Object.entries(data.employees).sort(([, a], [, b]) => a.name.localeCompare(b.name, "kk"));
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatTime() {
  return new Intl.DateTimeFormat("kk-KZ", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function monthFromToday() {
  return today().slice(0, 7);
}

function statusCounts(data, employeeId, month = monthFromToday()) {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
  for (const [date, records] of Object.entries(data.attendance)) {
    if (!date.startsWith(month)) continue;
    const status = records[employeeId]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
  }
  return counts;
}

function publicState(data) {
  return {
    today: today(),
    month: monthFromToday(),
    employees: activeEmployees(data).map(([id, employee]) => ({
      id,
      name: employee.name,
      role: employee.role || "Қызметкер",
      status: employee.status,
      counts: statusCounts(data, id),
    })),
    archivedEmployees: allEmployees(data)
      .filter(([, employee]) => employee.status === "archived")
      .map(([id, employee]) => ({ id, name: employee.name, role: employee.role || "Қызметкер", status: employee.status })),
    attendance: data.attendance,
    sheetSync: data.sheetSync,
  };
}

function setAttendance(data, date, employeeId, status) {
  data.attendance[date] ||= {};
  data.attendance[date][employeeId] = {
    status,
    updatedAt: new Date().toISOString(),
    time: formatTime(),
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const data = await loadData();

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, publicState(data));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/employees") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    if (!name) {
      sendJson(res, 400, { error: "Қызметкер аты керек" });
      return;
    }
    const id = nextEmployeeId(data);
    data.employees[id] = {
      name,
      role: String(body.role || "Қызметкер").trim() || "Қызметкер",
      status: "active",
      createdAt: new Date().toISOString(),
    };
    await saveData(data);
    await trySyncSheets(data);
    sendJson(res, 201, publicState(data));
    return;
  }

  const employeePatch = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (req.method === "PATCH" && employeePatch) {
    const id = decodeURIComponent(employeePatch[1]);
    const body = await readJson(req);
    if (!data.employees[id]) {
      sendJson(res, 404, { error: "Қызметкер табылмады" });
      return;
    }
    if (body.name !== undefined) data.employees[id].name = String(body.name).trim();
    if (body.role !== undefined) data.employees[id].role = String(body.role).trim() || "Қызметкер";
    if (body.status === "archived" || body.status === "active") {
      data.employees[id].status = body.status;
      if (body.status === "archived") data.employees[id].archivedAt = new Date().toISOString();
      if (body.status === "active") delete data.employees[id].archivedAt;
    }
    await saveData(data);
    await trySyncSheets(data);
    sendJson(res, 200, publicState(data));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/attendance") {
    const body = await readJson(req);
    const { date, employeeId, status } = body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !data.employees[employeeId] || !STATUSES[status]) {
      sendJson(res, 400, { error: "Күн, қызметкер немесе статус қате" });
      return;
    }
    setAttendance(data, date, employeeId, status);
    await saveData(data);
    await trySyncSheets(data);
    sendJson(res, 200, publicState(data));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync") {
    await syncGoogleSheets(data);
    sendJson(res, 200, publicState(data));
    return;
  }

  notFound(res);
}

function sheetsConfigured() {
  return Boolean(SHEET_ID && SHEET_ID !== "your_google_sheet_id" && GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY);
}

async function trySyncSheets(data) {
  if (!sheetsConfigured()) return;
  try {
    await syncGoogleSheets(data);
  } catch (error) {
    console.error(`Google Sheets sync failed: ${error.message}`);
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

let googleTokenCache = null;

async function getGoogleAccessToken() {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) return googleTokenCache.token;
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "Google token алынбады");
  googleTokenCache = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return googleTokenCache.token;
}

async function googleSheetsFetch(pathname, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Google Sheets API қатесі");
  return result;
}

async function ensureSheets() {
  const spreadsheet = await googleSheetsFetch("?fields=sheets.properties.title");
  const existing = new Set(spreadsheet.sheets.map((sheet) => sheet.properties.title));
  const requests = ["Employees", "Attendance", "Summary"]
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

async function syncGoogleSheets(data) {
  if (!sheetsConfigured()) throw new Error("Google Sheets config толық емес.");
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
  for (const date of Object.keys(data.attendance).sort()) {
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

  const summary = [["Ай", "Қызметкер ID", "Аты-жөні", "Рөлі", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Барлығы белгіленген"]];
  const months = new Set(Object.keys(data.attendance).map((date) => date.slice(0, 7)));
  months.add(monthFromToday());
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

  await updateSheetRange("Employees!A1:F1000", employees);
  await updateSheetRange("Attendance!A1:G5000", attendance);
  await updateSheetRange("Summary!A1:I2000", summary);
  data.sheetSync = {
    at: new Date().toISOString(),
    rows: { employees: employees.length - 1, attendance: attendance.length - 1, summary: summary.length - 1 },
  };
  await saveData(data);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: error.message });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mini App API іске қосылды: http://127.0.0.1:${PORT}`);
});
