import crypto from "node:crypto";

const STATUSES = {
  present: { label: "Жұмыста" },
  half: { label: "Жарты күн" },
  absent: { label: "Жоқ" },
  dayoff: { label: "Демалыс" },
};

const EMPLOYEE_HEADERS = ["ID", "Аты-жөні", "Рөлі", "Статус", "Қосылған күні", "Архив күні"];
const ATTENDANCE_HEADERS = ["Күн", "Қызметкер ID", "Аты-жөні", "Рөлі", "Белгі", "Уақыт", "Жаңартылды"];
const SUMMARY_HEADERS = ["Ай", "Қызметкер ID", "Аты-жөні", "Рөлі", "Жұмыста", "Жарты күн", "Жоқ", "Демалыс", "Барлығы белгіленген"];

function env(name) {
  return process.env[name] || "";
}

function sheetId() {
  return env("GOOGLE_SHEET_ID");
}

function serviceEmail() {
  return env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
}

function privateKey() {
  return env("GOOGLE_PRIVATE_KEY").replaceAll("\\n", "\n");
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

let tokenCache = null;

async function getGoogleAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (!sheetId() || !serviceEmail() || !privateKey()) throw new Error("Google Sheets env толық емес.");

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: serviceEmail(),
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey(), "base64url");

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

async function ensureSheets() {
  const spreadsheet = await sheetsFetch("?fields=sheets.properties.title");
  const existing = new Set(spreadsheet.sheets.map((sheet) => sheet.properties.title));
  const requests = ["Employees", "Attendance", "Summary"]
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));
  if (requests.length) await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });

  await ensureHeader("Employees!A1:F1", EMPLOYEE_HEADERS);
  await ensureHeader("Attendance!A1:G1", ATTENDANCE_HEADERS);
  await ensureHeader("Summary!A1:I1", SUMMARY_HEADERS);
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
  };
}

function labelToStatus(label) {
  return Object.entries(STATUSES).find(([, meta]) => meta.label === label)?.[0] || "";
}

function statusToLabel(status) {
  return STATUSES[status]?.label || status;
}

export async function loadStore() {
  await ensureSheets();
  const [employeeRows, attendanceRows] = await Promise.all([
    getValues("Employees!A2:F1000"),
    getValues("Attendance!A2:G5000"),
  ]);
  const employees = employeeRows.filter((row) => row[0]).map(rowToEmployee);
  const attendance = attendanceRows.filter((row) => row[0] && row[1]).map(rowToAttendance);
  return { employees, attendance };
}

export function publicState(store) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Almaty",
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
    .map((employee) => ({ ...employee, counts: statusCounts(attendanceMap, employee.id, month) }));
  return {
    today,
    month,
    employees: activeEmployees,
    archivedEmployees: store.employees.filter((employee) => employee.status === "archived"),
    attendance: attendanceMap,
    sheetSync: null,
  };
}

export function statusCounts(attendanceMap, employeeId, month) {
  const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
  for (const [date, records] of Object.entries(attendanceMap)) {
    if (!date.startsWith(month)) continue;
    const status = records[employeeId]?.status;
    if (counts[status] !== undefined) counts[status] += 1;
  }
  return counts;
}

export function nextEmployeeId(employees) {
  const max = employees.reduce((highest, employee) => {
    const number = Number(String(employee.id || "").replace("emp_", ""));
    return Number.isFinite(number) ? Math.max(highest, number) : highest;
  }, 0);
  return `emp_${String(max + 1).padStart(4, "0")}`;
}

export async function saveEmployees(employees) {
  await ensureSheets();
  await clearRange("Employees!A2:F1000");
  if (employees.length) await updateRange("Employees!A2:F1000", employees.map(employeeToRow));
}

export async function saveAttendance(attendance) {
  await ensureSheets();
  await clearRange("Attendance!A2:G5000");
  if (attendance.length) {
    await updateRange("Attendance!A2:G5000", attendance.map((row) => [
      row.date,
      row.employeeId,
      row.name,
      row.role,
      row.label,
      row.time,
      row.updatedAt,
    ]));
  }
}

export async function rebuildSummary(store) {
  const attendanceMap = publicState(store).attendance;
  const months = new Set(store.attendance.map((row) => row.date.slice(0, 7)));
  months.add(publicState(store).month);
  const rows = [SUMMARY_HEADERS];
  for (const month of [...months].sort()) {
    for (const employee of store.employees.sort((a, b) => a.name.localeCompare(b.name, "kk"))) {
      const counts = statusCounts(attendanceMap, employee.id, month);
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
      ]);
    }
  }
  await clearRange("Summary!A1:I2000");
  await updateRange("Summary!A1:I2000", rows);
}

export function currentTime() {
  return new Intl.DateTimeFormat("kk-KZ", {
    timeZone: process.env.BOT_TIMEZONE || "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export { STATUSES, statusToLabel };
