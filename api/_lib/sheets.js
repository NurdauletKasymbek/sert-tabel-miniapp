import crypto from "node:crypto";

const STATUSES = {
  present: { label: "Жұмыста" },
  half: { label: "Жарты күн" },
  absent: { label: "Жоқ" },
  dayoff: { label: "Демалыс" },
};

const EMPLOYEE_HEADERS = ["ID", "Аты-жөні", "Рөлі", "Статус", "Қосылған күні", "Архив күні", "Кесте", "Telegram ID", "Айлық жалақы"];

const MONTHLY_WORK_DAYS = Number(process.env.MONTHLY_WORK_DAYS) > 0 ? Number(process.env.MONTHLY_WORK_DAYS) : 26;
const DAILY_NORM_HOURS = 9;

const SCHEDULE_LABELS = {
  standard: "Стандарт",
  "school-half": "Жартылай (мектеп)",
};

function labelToSchedule(label) {
  const value = String(label || "").trim();
  if (!value) return "standard";
  for (const [key, name] of Object.entries(SCHEDULE_LABELS)) {
    if (name === value) return key;
  }
  return value === "school-half" ? "school-half" : "standard";
}

function scheduleToLabel(schedule) {
  return SCHEDULE_LABELS[schedule] || SCHEDULE_LABELS.standard;
}
const ATTENDANCE_HEADERS = ["Күн", "Қызметкер ID", "Аты-жөні", "Рөлі", "Белгі", "Уақыт", "Жаңартылды", "Кіру", "Шығу", "Кешіктіру(мин)", "Ерте кету(мин)"];
const SUMMARY_HEADERS = ["Ай", "Қызметкер ID", "Аты-жөні", "Рөлі", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Барлығы белгіленген", "Жалпы күн", "Жалпы сағат"];
const DAILY_HEADERS = ["Күн", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Белгі жоқ", "Барлығы"];
const HISTORY_HEADERS = ["Уақыт", "Әрекет", "Қызметкер ID", "Аты-жөні", "Күн", "Бұрынғы белгі", "Жаңа белгі"];
const ADVANCE_HEADERS = ["Күні", "Аты-жөні", "Сома", "Ескертпе"];

const SHEETS = {
  employees: "Қызметкерлер",
  attendance: "Табель",
  reports: "Есеп",
  advances: "Аванстар",
  history: "Журнал",
};

const LEGACY_SHEETS = {
  Employees: SHEETS.employees,
  Attendance: SHEETS.attendance,
  Reports: SHEETS.reports,
  Summary: SHEETS.reports,
  History: SHEETS.history,
};

const HIDDEN_SHEETS = new Set([SHEETS.history, "Daily Control", "Summary", "Reports", "Employees", "Attendance", "History"]);

function env(name) {
  return process.env[name] || "";
}

function sheetId() {
  return env("GOOGLE_SHEET_ID").trim();
}

let serviceAccountCache;

function cleanEnvValue(value, name) {
  let cleaned = String(value || "").trim();
  if (cleaned.startsWith(`${name}=`)) cleaned = cleaned.slice(name.length + 1).trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function normalizeBase64(value) {
  const normalized = value.replace(/\s/g, "").replaceAll("-", "+").replaceAll("_", "/");
  return normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
}

export function googleConfigDiagnostics() {
  const raw = env("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const value = cleanEnvValue(raw, "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const info = {
    hasSheetId: Boolean(sheetId()),
    hasServiceEmail: Boolean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL").trim()),
    hasJsonBase64: Boolean(value),
    jsonBase64Length: value.length,
    looksLikeRawJson: value.startsWith("{"),
    looksLikeBase64Json: value.startsWith("ewog") || value.startsWith("eyJ"),
    decodedLooksLikeJson: false,
    hasClientEmail: false,
    hasPrivateKey: false,
    ok: false,
  };
  if (!value) return info;
  try {
    const jsonText = value.startsWith("{")
      ? value
      : Buffer.from(normalizeBase64(value), "base64").toString("utf8").trim();
    info.decodedLooksLikeJson = jsonText.startsWith("{");
    const account = JSON.parse(cleanEnvValue(jsonText, "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"));
    info.hasClientEmail = Boolean(account?.client_email);
    info.hasPrivateKey = Boolean(account?.private_key);
    info.ok = info.hasClientEmail && info.hasPrivateKey;
    return info;
  } catch {
    return info;
  }
}

function serviceAccountFromBase64() {
  if (serviceAccountCache !== undefined) return serviceAccountCache;
  const value = cleanEnvValue(env("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"), "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  if (!value) return null;
  try {
    const jsonText = value.startsWith("{")
      ? value
      : Buffer.from(normalizeBase64(value), "base64").toString("utf8").trim();
    const account = JSON.parse(cleanEnvValue(jsonText, "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"));
    if (!account?.client_email || !account?.private_key) throw new Error("missing_fields");
    serviceAccountCache = account;
    return serviceAccountCache;
  } catch {
    const info = googleConfigDiagnostics();
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 форматы қате. Ұзындығы: ${info.jsonBase64Length}. Base64 JSON сияқты ма: ${info.looksLikeBase64Json ? "иә" : "жоқ"}. Decode JSON болды ма: ${info.decodedLooksLikeJson ? "иә" : "жоқ"}.`);
  }
}

function serviceEmail() {
  return serviceAccountFromBase64()?.client_email || env("GOOGLE_SERVICE_ACCOUNT_EMAIL").trim();
}

function privateKey() {
  const jsonKey = serviceAccountFromBase64()?.private_key;
  if (jsonKey) return jsonKey;

  const value = env("GOOGLE_PRIVATE_KEY").trim();
  const withoutPrefix = value.startsWith("GOOGLE_PRIVATE_KEY=")
    ? value.slice("GOOGLE_PRIVATE_KEY=".length).trim()
    : value;
  const unquoted = (withoutPrefix.startsWith('"') && withoutPrefix.endsWith('"')) || (withoutPrefix.startsWith("'") && withoutPrefix.endsWith("'"))
    ? withoutPrefix.slice(1, -1)
    : withoutPrefix;
  let key = unquoted
    .replaceAll("\\n", "\n")
    .replaceAll("-----BEGIN_PRIVATE_KEY-----", "-----BEGIN PRIVATE KEY-----")
    .replaceAll("-----END_PRIVATE_KEY-----", "-----END PRIVATE KEY-----")
    .replaceAll("-----BEGIN_PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----")
    .replaceAll("-----END_PRIVATE KEY-----", "-----END PRIVATE KEY-----")
    .replaceAll("-----BEGIN PRIVATE_KEY-----", "-----BEGIN PRIVATE KEY-----")
    .replaceAll("-----END PRIVATE_KEY-----", "-----END PRIVATE KEY-----")
    .replaceAll("-----BEGIN PRIVATE_KEY-----", "-----BEGIN PRIVATE KEY-----")
    .replaceAll("-----END PRIVATE_KEY-----", "-----END PRIVATE KEY-----");

  key = key.replace(/\r/g, "").trim();
  if (key.includes("-----BEGIN PRIVATE KEY-----") && !key.includes("\n")) {
    key = key
      .replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\n")
      .replace("-----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");
  }
  return key;
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

let tokenCache = null;

async function getGoogleAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const missing = [
    !sheetId() && "GOOGLE_SHEET_ID",
    !serviceEmail() && "GOOGLE_SERVICE_ACCOUNT_EMAIL немесе GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
    !privateKey() && "GOOGLE_PRIVATE_KEY немесе GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Vercel Environment Variables толық емес: ${missing.join(", ")}`);

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: serviceEmail(),
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }))}`;
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey(), "base64url");
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY форматы қате. Vercel-де толық private key қойыңыз: -----BEGIN PRIVATE KEY----- деп басталып, -----END PRIVATE KEY----- деп бітуі керек.");
  }

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
  tokenCache = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return tokenCache.token;
}

async function sheetsFetch(pathname, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${pathname}`, {
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

function a1(sheetName, cellRange) {
  return `'${sheetName.replaceAll("'", "''")}'!${cellRange}`;
}

let ensureSheetsLastRun = 0;
const ENSURE_SHEETS_TTL_MS = 60_000;
let storeCache = null;
const STORE_CACHE_TTL_MS = 10_000;

export function invalidateStoreCache() {
  storeCache = null;
}

async function ensureSheets() {
  if (Date.now() - ensureSheetsLastRun < ENSURE_SHEETS_TTL_MS) return;
  let spreadsheet = await sheetsFetch("?fields=sheets.properties(sheetId,title,hidden)");
  let sheets = spreadsheet.sheets.map((sheet) => sheet.properties);
  const titles = new Set(sheets.map((sheet) => sheet.title));
  const requests = [];
  const renamedSheetIds = new Set();

  for (const [legacyTitle, newTitle] of Object.entries(LEGACY_SHEETS)) {
    if (titles.has(legacyTitle) && !titles.has(newTitle)) {
      const legacySheet = sheets.find((sheet) => sheet.title === legacyTitle);
      requests.push({ updateSheetProperties: { properties: { sheetId: legacySheet.sheetId, title: newTitle, hidden: HIDDEN_SHEETS.has(newTitle) }, fields: "title,hidden" } });
      renamedSheetIds.add(legacySheet.sheetId);
      titles.delete(legacyTitle);
      titles.add(newTitle);
    }
  }

  for (const title of Object.values(SHEETS)) {
    if (!titles.has(title)) {
      requests.push({ addSheet: { properties: { title, hidden: HIDDEN_SHEETS.has(title) } } });
      titles.add(title);
    }
  }

  for (const sheet of sheets) {
    if (!renamedSheetIds.has(sheet.sheetId) && HIDDEN_SHEETS.has(sheet.title) && !sheet.hidden) {
      requests.push({ updateSheetProperties: { properties: { sheetId: sheet.sheetId, hidden: true }, fields: "hidden" } });
    }
  }

  if (requests.length) await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });

  await ensureHeader(a1(SHEETS.employees, "A1:I1"), EMPLOYEE_HEADERS);
  await ensureHeader(a1(SHEETS.attendance, "A1:K1"), ATTENDANCE_HEADERS);
  await ensureHeader(a1(SHEETS.reports, "A1:K1"), SUMMARY_HEADERS);
  await ensureHeader(a1(SHEETS.advances, "A1:D1"), ADVANCE_HEADERS);
  await clearRange(a1(SHEETS.advances, "E1:E5000"));
  await ensureAdvanceNameValidation();
  await ensureHeader(a1(SHEETS.history, "A1:G1"), HISTORY_HEADERS);
  ensureSheetsLastRun = Date.now();
}

async function ensureAdvanceNameValidation() {
  try {
    const spreadsheet = await sheetsFetch("?fields=sheets.properties(sheetId,title)");
    const sheetMap = Object.fromEntries(spreadsheet.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
    const advancesId = sheetMap[SHEETS.advances];
    const employeesId = sheetMap[SHEETS.employees];
    if (advancesId === undefined || employeesId === undefined) return;
    await sheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            setDataValidation: {
              range: { sheetId: advancesId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 1, endColumnIndex: 2 },
              rule: {
                condition: {
                  type: "ONE_OF_RANGE",
                  values: [{ userEnteredValue: `=${SHEETS.employees}!$B$2:$B$1000` }],
                },
                showCustomUi: true,
                strict: false,
              },
            },
          },
          {
            repeatCell: {
              range: { sheetId: advancesId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 1 },
              cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
              fields: "userEnteredFormat.numberFormat",
            },
          },
          {
            repeatCell: {
              range: { sheetId: advancesId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 2, endColumnIndex: 3 },
              cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      }),
    });
  } catch {
    // best-effort; ignore validation errors so loadStore still works
  }
}

async function ensureHeader(range, headers) {
  const values = await getValues(range);
  if (!values.length || values[0].join("|") !== headers.join("|")) {
    await updateRange(range, [headers]);
  }
}

async function getValues(range) {
  const result = await sheetsFetch(`/values/${encodeURIComponent(range)}`);
  return result.values || [];
}

async function updateRange(range, values) {
  await sheetsFetch(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

async function clearRange(range) {
  await sheetsFetch(`/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: "{}" });
}

function rowToEmployee(row) {
  return {
    id: row[0],
    name: row[1] || "",
    role: row[2] || "Қызметкер",
    status: row[3] === "Архив" ? "archived" : "active",
    createdAt: row[4] || "",
    archivedAt: row[5] || "",
    schedule: labelToSchedule(row[6]),
    telegramId: row[7] ? String(row[7]).trim() : "",
    monthlySalary: Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0,
  };
}

function employeeToRow(employee) {
  return [
    employee.id,
    employee.name,
    employee.role || "Қызметкер",
    employee.status === "archived" ? "Архив" : "Белсенді",
    employee.createdAt || "",
    employee.archivedAt || "",
    scheduleToLabel(employee.schedule || "standard"),
    employee.telegramId ? String(employee.telegramId) : "",
    employee.monthlySalary || 0,
  ];
}

function rowToAttendance(row) {
  return {
    date: row[0],
    employeeId: row[1],
    name: row[2] || "",
    role: row[3] || "",
    label: row[4] || "",
    time: row[5] || "",
    updatedAt: row[6] || "",
    checkInTime: row[7] || "",
    checkOutTime: row[8] || "",
    lateMinutes: row[9] ? Number(row[9]) : 0,
    earlyMinutes: row[10] ? Number(row[10]) : 0,
  };
}

function labelToStatus(label) {
  return Object.entries(STATUSES).find(([, meta]) => meta.label === label)?.[0] || "";
}

function statusToLabel(status) {
  return STATUSES[status]?.label || status;
}

export async function loadStore() {
  if (storeCache && Date.now() - storeCache.at < STORE_CACHE_TTL_MS) {
    return storeCache.data;
  }
  await ensureSheets();
  const [employeeRows, attendanceRows, advanceRows, historyRows] = await Promise.all([
    getValues(a1(SHEETS.employees, "A2:I1000")),
    getValues(a1(SHEETS.attendance, "A2:K5000")),
    getValues(a1(SHEETS.advances, "A2:D5000")),
    getValues(a1(SHEETS.history, "A2:G5000")),
  ]);
  const employees = employeeRows
    .filter((row) => row[0] || row[1])
    .map((row) => {
      if (!row[0] && row[1]) {
        const nameKey = String(row[1]).trim().toLowerCase().replace(/[^a-zA-Zа-яА-ЯёЁіІңҢүҮұҰәӘөӨ0-9]/g, "_");
        row = [`name_${nameKey}`, ...row.slice(1)];
      }
      return rowToEmployee(row);
    });
  const attendance = attendanceRows.filter((row) => row[0] && row[1]).map(rowToAttendance);
  const employeeByName = new Map(employees.map((employee) => [employee.name.trim().toLowerCase(), employee.id]));
  const advances = advanceRows.filter((row) => row[0] && row[1]).map((row) => {
    const name = String(row[1] || "").trim();
    return {
      date: String(row[0] || "").trim(),
      employeeId: employeeByName.get(name.toLowerCase()) || "",
      name,
      amount: Number(String(row[2] || "0").replace(/[^\d.-]/g, "")) || 0,
      note: row[3] || "",
    };
  });
  const history = historyRows.filter((row) => row[0]).map((row) => ({
    at: row[0],
    action: row[1],
    employeeId: row[2],
    name: row[3],
    date: row[4],
    oldLabel: row[5],
    newLabel: row[6],
  }));
  const data = { employees, attendance, advances, history };
  storeCache = { at: Date.now(), data };
  return data;
}

export function publicState(store) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const month = today.slice(0, 7);
  const attendanceMap = {};
  for (const row of store.attendance) {
    const status = labelToStatus(row.label);
    if (!status) continue;
    attendanceMap[row.date] ||= {};
    attendanceMap[row.date][row.employeeId] = { status, time: row.time, updatedAt: row.updatedAt };
  }
  const activeEmployees = store.employees
    .filter((employee) => employee.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name, "kk"))
    .map((employee) => ({
      ...employee,
      counts: statusCounts(attendanceMap, employee.id, month),
      hoursMonth: monthlyHours(store.attendance, employee.id, month),
    }));
  const todayRecords = attendanceMap[today] || {};
  const unmarkedEmployees = activeEmployees.filter((employee) => !todayRecords[employee.id]);
  const todayControl = dayControl(attendanceMap, activeEmployees, today);
  const roles = [...new Set(activeEmployees.map((employee) => employee.role || "Қызметкер"))].sort((a, b) => a.localeCompare(b, "kk"));
  const advances = store.advances || [];
  const advancesByMonth = {};
  for (const adv of advances) {
    const m = (adv.date || "").slice(0, 7);
    if (!m) continue;
    advancesByMonth[m] ||= {};
    advancesByMonth[m][adv.employeeId] ||= { total: 0, items: [] };
    advancesByMonth[m][adv.employeeId].total += adv.amount || 0;
    advancesByMonth[m][adv.employeeId].items.push({ date: adv.date, amount: adv.amount, note: adv.note });
  }
  return {
    today,
    month,
    employees: activeEmployees,
    archivedEmployees: store.employees.filter((employee) => employee.status === "archived"),
    unmarkedEmployees,
    todayControl,
    roles,
    recentHistory: (store.history || []).slice(-12).reverse(),
    attendance: attendanceMap,
    advances,
    advancesByMonth,
    sheetSync: null,
  };
}

export function dayControl(attendanceMap, employees, date) {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0, unmarked: 0 };
  const records = attendanceMap[date] || {};
  for (const employee of employees) {
    const status = records[employee.id]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
    else counts.unmarked += 1;
  }
  return { date, ...counts, total: employees.length };
}

export function statusCounts(attendanceMap, employeeId, month) {
  return statusCountsUntil(attendanceMap, employeeId, month);
}

export function statusCountsUntil(attendanceMap, employeeId, month, untilDate = "") {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
  for (const [date, records] of Object.entries(attendanceMap)) {
    if (!date.startsWith(month)) continue;
    if (untilDate && date > untilDate) continue;
    const status = records[employeeId]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
  }
  return counts;
}

function timeStringToMinutes(time) {
  if (!time) return 0;
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function monthlyHours(attendance, employeeId, month) {
  let totalMinutes = 0;
  let totalDays = 0;
  for (const row of attendance) {
    if (!row.date.startsWith(month)) continue;
    if (row.employeeId !== employeeId) continue;
    if (row.label === "Жұмыста") totalDays += 1;
    else if (row.label === "Жарты күн") totalDays += 0.5;
    if (row.checkInTime && row.checkOutTime) {
      const minutes = timeStringToMinutes(row.checkOutTime) - timeStringToMinutes(row.checkInTime);
      if (minutes > 0) totalMinutes += minutes;
    }
  }
  return { totalDays, totalHours: Math.round((totalMinutes / 60) * 10) / 10 };
}

// Әр жұмыс күнінің эквивалент үлесі (сағатқа пропорционал).
// Кіру+Шығу болса: істелген минут / (9 сағат). Толық күн = 1.
// Уақыт жоқ "Жұмыста" (қолмен/телефонсыз) = 1, "Жарты күн" = 0.5, қалғаны = 0.
function dayFraction(row) {
  if (row.checkInTime && row.checkOutTime) {
    const minutes = timeStringToMinutes(row.checkOutTime) - timeStringToMinutes(row.checkInTime);
    if (minutes <= 0) return row.label === "Жұмыста" ? 1 : 0;
    return Math.min(minutes / (DAILY_NORM_HOURS * 60), 1);
  }
  if (row.label === "Жұмыста") return 1;
  if (row.label === "Жарты күн") return 0.5;
  return 0;
}

// Сағатқа пропорционал жалақы:
//   dailyRate = monthlySalary / MONTHLY_WORK_DAYS
//   earned    = dailyRate × Σ(күн үлесі)
//   net       = earned − аванс
export function salaryReport(store, employeeId, month) {
  const employee = store.employees.find((item) => item.id === employeeId);
  const monthlySalary = employee?.monthlySalary || 0;
  let workedEquivalentDays = 0;
  for (const row of store.attendance) {
    if (!row.date.startsWith(month) || row.employeeId !== employeeId) continue;
    workedEquivalentDays += dayFraction(row);
  }
  workedEquivalentDays = Math.round(workedEquivalentDays * 100) / 100;
  const { totalHours } = monthlyHours(store.attendance, employeeId, month);
  const advanceTotal = (store.advances || [])
    .filter((adv) => adv.employeeId === employeeId && (adv.date || "").startsWith(month))
    .reduce((sum, adv) => sum + (adv.amount || 0), 0);
  const dailyRate = MONTHLY_WORK_DAYS > 0 ? monthlySalary / MONTHLY_WORK_DAYS : 0;
  const earned = Math.round(dailyRate * workedEquivalentDays);
  const net = earned - advanceTotal;
  return { monthlySalary, workedEquivalentDays, totalHours, advanceTotal, earned, net, monthlyWorkDays: MONTHLY_WORK_DAYS };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildManagerReport(store, date) {
  const state = publicState(store);
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : state.today;
  const attendanceMap = state.attendance || {};
  const records = attendanceMap[reportDate] || {};
  const employees = state.employees || [];
  const grouped = { present: [], half: [], absent: [], dayoff: [], unmarked: [] };

  for (const employee of employees) {
    const status = records[employee.id]?.status;
    if (grouped[status]) grouped[status].push(employee.name);
    else grouped.unmarked.push(employee.name);
  }

  const counts = dayControl(attendanceMap, employees, reportDate);
  const month = reportDate.slice(0, 7);
  const monthlyRows = employees.map((employee) => {
    const employeeCounts = statusCountsUntil(attendanceMap, employee.id, month, reportDate);
    return {
      employee,
      counts: employeeCounts,
      marked: employeeCounts.present + employeeCounts.half + employeeCounts.absent + employeeCounts.dayoff,
    };
  });
  const monthTotals = monthlyRows.reduce((totals, row) => {
    const employeeCounts = row.counts;
    for (const key of Object.keys(totals)) totals[key] += employeeCounts[key] || 0;
    return totals;
  }, { present: 0, half: 0, absent: 0, dayoff: 0 });

  const lines = [
    "<b>Sert табель есебі</b>",
    `Күн: <b>${reportDate}</b>`,
    "",
    `Барлығы: <b>${counts.total}</b>`,
    `Белгіленді: <b>${counts.total - counts.unmarked}/${counts.total}</b>`,
    `Жұмыста: <b>${counts.present}</b>`,
    `Жарты күн: <b>${counts.half}</b>`,
    `Жоқ: <b>${counts.absent}</b>`,
    `Демалыс: <b>${counts.dayoff}</b>`,
    `Белгі жоқ: <b>${counts.unmarked}</b>`,
    "",
    `<b>${month} айлық қысқа есеп</b>`,
    `Жұмыста: <b>${monthTotals.present}</b>`,
    `Жарты күн: <b>${monthTotals.half}</b>`,
    `Жоқ: <b>${monthTotals.absent}</b>`,
    `Демалыс: <b>${monthTotals.dayoff}</b>`,
  ];

  lines.push("", `<b>${month} айлық есеп - адам бойынша</b>`);
  for (const row of monthlyRows) {
    const employeeCounts = row.counts;
    lines.push(
      `- ${escapeHtml(row.employee.name)}: Жұмыста <b>${employeeCounts.present}</b>, жарты күн <b>${employeeCounts.half}</b>, жоқ <b>${employeeCounts.absent}</b>, демалыс <b>${employeeCounts.dayoff}</b>`,
    );
  }

  const sections = [
    ["Жұмыста", grouped.present],
    ["Жарты күн", grouped.half],
    ["Жоқ", grouped.absent],
    ["Демалыс", grouped.dayoff],
    ["Белгі қойылмаған", grouped.unmarked],
  ];
  for (const [title, names] of sections) {
    if (!names.length) continue;
    lines.push("", `<b>${title}</b>`);
    lines.push(...names.map((name) => `- ${escapeHtml(name)}`));
  }

  return { text: lines.join("\n"), counts, grouped, date: reportDate };
}

export function nextEmployeeId(employees) {
  const max = employees.reduce((highest, employee) => {
    const number = Number(String(employee.id || "").replace("emp_", ""));
    return Number.isFinite(number) ? Math.max(highest, number) : highest;
  }, 0);
  return `emp_${String(max + 1).padStart(4, "0")}`;
}

export async function saveEmployees(employees) {
  storeCache = null;
  await ensureSheets();
  await clearRange(a1(SHEETS.employees, "A2:I1000"));
  if (employees.length) await updateRange(a1(SHEETS.employees, "A2:I1000"), employees.map(employeeToRow));
}

export async function saveAttendance(attendance) {
  storeCache = null;
  await ensureSheets();
  await clearRange(a1(SHEETS.attendance, "A2:K5000"));
  if (attendance.length) {
    await updateRange(a1(SHEETS.attendance, "A2:K5000"), attendance.map((row) => [
      row.date,
      row.employeeId,
      row.name,
      row.role,
      row.label,
      row.time,
      row.updatedAt,
      row.checkInTime || "",
      row.checkOutTime || "",
      row.lateMinutes || "",
      row.earlyMinutes || "",
    ]));
  }
}

export async function appendHistory(rows) {
  if (!rows.length) return;
  storeCache = null;
  await ensureSheets();
  const existing = await getValues(a1(SHEETS.history, "A2:G5000"));
  await updateRange(a1(SHEETS.history, `A${existing.length + 2}:G5000`), rows.map((row) => [
    row.at,
    row.action,
    row.employeeId,
    row.name,
    row.date,
    row.oldLabel || "",
    row.newLabel || "",
  ]));
}

export async function rebuildSummary(store) {
  const attendanceMap = publicState(store).attendance;
  const months = new Set(store.attendance.map((row) => row.date.slice(0, 7)));
  months.add(publicState(store).month);
  const employees = store.employees.sort((a, b) => a.name.localeCompare(b.name, "kk"));

  const rows = [SUMMARY_HEADERS];
  for (const month of [...months].sort()) {
    for (const employee of employees) {
      const counts = statusCounts(attendanceMap, employee.id, month);
      const hours = monthlyHours(store.attendance, employee.id, month);
      rows.push([
        month,
        employee.id,
        employee.name,
        employee.role || "Қызметкер",
        counts.present,
        counts.half,
        counts.absent,
        counts.dayoff,
        counts.present + counts.half + counts.absent + counts.dayoff,
        hours.totalDays,
        hours.totalHours,
      ]);
    }
  }
  await clearRange(a1(SHEETS.reports, "A1:K2000"));
  await updateRange(a1(SHEETS.reports, "A1:K2000"), rows);
  await applyBasicFormatting();
}

export function currentTime() {
  return new Intl.DateTimeFormat("kk-KZ", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function todayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function assertNotFutureDate(date) {
  if (date > todayDate()) {
    throw new Error("Алдын ала белгі қою мүмкін емес. Тек бүгінгі немесе өткен күнге белгі қойылады.");
  }
}

export { STATUSES, statusToLabel };

export async function appendAdvance(date, employeeName, amount, note) {
  storeCache = null;
  await ensureSheets();
  const existing = await getValues(a1(SHEETS.advances, "A2:D5000"));
  const nextRow = existing.length + 2;
  await updateRange(a1(SHEETS.advances, `A${nextRow}:D${nextRow}`), [[date, employeeName, amount, note || ""]]);
}

async function applyBasicFormatting() {
  const spreadsheet = await sheetsFetch("?fields=sheets.properties(sheetId,title,hidden)");
  const ids = Object.fromEntries(spreadsheet.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const visibleSheets = new Set([SHEETS.employees, SHEETS.attendance, SHEETS.reports]);
  const requests = Object.entries(ids)
    .filter(([title]) => visibleSheets.has(title))
    .flatMap(([, sheetId]) => [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.04, green: 0.11, blue: 0.37 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    ]);
  for (const [title, sheetId] of Object.entries(ids)) {
    if (HIDDEN_SHEETS.has(title)) {
      requests.push({ updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } });
    }
  }
  if (requests.length) await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
}
