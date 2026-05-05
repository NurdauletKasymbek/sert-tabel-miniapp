import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data.json");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
const TIME_ZONE = process.env.BOT_TIMEZONE || "Asia/Almaty";
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const MINI_APP_URL = process.env.MINI_APP_URL || "";
const GOOGLE_SERVICE_ACCOUNT = loadGoogleServiceAccount();
const SHEETS = {
  employees: "Қызметкерлер",
  attendance: "Табель",
  reports: "Есеп",
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
const GOOGLE_CLIENT_EMAIL = cleanGoogleEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || GOOGLE_SERVICE_ACCOUNT?.client_email || "";
const GOOGLE_PRIVATE_KEY = (cleanGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY) || GOOGLE_SERVICE_ACCOUNT?.private_key || "").replaceAll("\\n", "\n");
const AUTO_SYNC_SHEETS = process.env.AUTO_SYNC_SHEETS === "true";

if (!TELEGRAM_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN көрсетілмеген. Алдымен bot/.env файлын толтырыңыз.");
  process.exit(1);
}

const API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const BOT_VERSION = "Sheets-only v2";
const STATUSES = {
  present: { label: "Жұмыста", short: "Ж", salaryFactor: 1 },
  absent: { label: "Жоқ", short: "Жоқ", salaryFactor: 0 },
  half: { label: "Жарты күн", short: "0.5", salaryFactor: 0.5 },
  sick: { label: "Ауырып қалды", short: "А", salaryFactor: 0 },
  dayoff: { label: "Демалыс", short: "Д", salaryFactor: 0 },
};

const defaultData = {
  nextEmployeeId: 1,
  employees: {},
  attendance: {},
  history: [],
  sessions: {},
  sheetSync: null,
  monthlyReportSent: "",
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
  data.history ||= [];
  data.sessions ||= {};
  for (const employee of Object.values(data.employees)) {
    employee.status ||= "active";
    employee.role ||= "Қызметкер";
    employee.dailyRate = Number(employee.dailyRate || 0);
  }
  return data;
}

async function saveData(data, { syncSheets = AUTO_SYNC_SHEETS } = {}) {
  await mkdir(__dirname, { recursive: true });
  const tempPath = `${DATA_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, DATA_PATH);
  if (syncSheets && sheetsConfigured()) {
    await syncGoogleSheets(data);
  }
}

function isAdmin(userId) {
  return ADMIN_IDS.has(String(userId));
}

function today() {
  return formatDate(new Date());
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("kk-KZ", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function currentMonth() {
  return today().slice(0, 7);
}

function addMonths(month, diff) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + diff, 1));
  return date.toISOString().slice(0, 7);
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function weekdayOffset(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function money(value) {
  return `${Number(value || 0).toLocaleString("kk-KZ")} тг`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseCommand(text = "") {
  const [command = "", ...rest] = text.trim().split(/\s+/);
  return { command: command.split("@")[0].toLowerCase(), args: rest.join(" ").trim() };
}

function mainKeyboard() {
  return { remove_keyboard: true };
}

function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

async function telegram(method, payload) {
  const response = await fetch(`${API_URL}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description || "Telegram қатесі"}`);
  return result.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function editMessage(chatId, messageId, text, extra = {}) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function answerCallback(callbackId, text = "") {
  return telegram("answerCallbackQuery", { callback_query_id: callbackId, text });
}

async function sendDocument(chatId, fileName, content, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/csv;charset=utf-8" }), fileName);
  const response = await fetch(`${API_URL}/sendDocument`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "CSV жіберілмеді");
}

function activeEmployees(data) {
  return Object.entries(data.employees)
    .filter(([, employee]) => employee.status !== "archived")
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, "kk"));
}

function allEmployees(data) {
  return Object.entries(data.employees).sort(([, a], [, b]) => a.name.localeCompare(b.name, "kk"));
}

function nextEmployeeId(data) {
  const id = `emp_${String(data.nextEmployeeId).padStart(4, "0")}`;
  data.nextEmployeeId += 1;
  return id;
}

function setAttendance(data, date, employeeId, status) {
  const oldStatus = data.attendance[date]?.[employeeId]?.status || "";
  data.attendance[date] ||= {};
  data.attendance[date][employeeId] = {
    status,
    updatedAt: new Date().toISOString(),
    time: formatTime(),
  };
  const employee = data.employees[employeeId];
  data.history.push({
    at: new Date().toISOString(),
    action: oldStatus ? "Белгі өзгерді" : "Белгі қойылды",
    employeeId,
    name: employee?.name || "",
    date,
    oldLabel: oldStatus ? STATUSES[oldStatus]?.label || oldStatus : "",
    newLabel: STATUSES[status]?.label || status,
  });
}

function getAttendance(data, date, employeeId) {
  return data.attendance[date]?.[employeeId];
}

function daySummary(data, date) {
  const rows = activeEmployees(data);
  const counts = Object.fromEntries(Object.keys(STATUSES).map((status) => [status, 0]));
  for (const [id] of rows) {
    const status = getAttendance(data, date, id)?.status;
    if (status) counts[status] += 1;
  }
  const marked = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { total: rows.length, marked, counts };
}

function makeReport(data, month = currentMonth()) {
  const rows = allEmployees(data).map(([id, employee]) => {
    const statuses = Object.fromEntries(Object.keys(STATUSES).map((status) => [status, 0]));
    const dates = [];
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const record = getAttendance(data, date, id);
      if (!record) continue;
      statuses[record.status] += 1;
      dates.push(`${date}:${STATUSES[record.status]?.short || record.status}`);
    }
    const marked = Object.values(statuses).reduce((sum, count) => sum + count, 0);
    return { id, employee, statuses, marked, dates };
  });
  return { month, rows };
}

function reportText(data, month = currentMonth()) {
  const report = makeReport(data, month);
  if (report.rows.length === 0) return `${month} айына қызметкерлер жоқ.`;
  const lines = [`<b>${month} табель есебі</b>`];
  for (const row of report.rows) {
    const archived = row.employee.status === "archived" ? " (архив)" : "";
    lines.push(
      `${escapeHtml(row.employee.name)}${archived}: Жұмыста ${row.statuses.present}, Жарты күн ${row.statuses.half}, Жоқ ${row.statuses.absent}, Демалыс ${row.statuses.dayoff}, Барлығы <b>${row.marked}</b>`,
    );
  }
  return lines.join("\n");
}

function csvReport(data, month = currentMonth()) {
  const report = makeReport(data, month);
  const lines = ["ID,Аты-жөні,Статус,Рөлі,Жұмыста,Жарты күн,Жоқ,Демалыс,Барлығы белгіленген,Белгілер"];
  for (const row of report.rows) {
    lines.push(
      [
        row.id,
        row.employee.name,
        row.employee.status,
        row.employee.role || "",
        row.statuses.present,
        row.statuses.half,
        row.statuses.absent,
        row.statuses.dayoff,
        row.marked,
        row.dates.join(" "),
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    );
  }
  return lines.join("\n");
}

function helpText() {
  return [
    "<b>Sert табель боты</b>",
    "",
    "Барлық жұмыс Mini App ішінде жасалады.",
    "Бұл чатқа тек маңызды хабарламалар мен басшылыққа жіберілген есеп көшірмесі келеді.",
  ].join("\n");
}

function menuText(data) {
  const summary = daySummary(data, today());
  return [
    "<b>Компания табелі</b>",
    `<i>${BOT_VERSION}</i>`,
    `Бүгін: <b>${today()}</b>`,
    `Қызметкерлер: <b>${activeEmployees(data).length}</b> белсенді`,
    `Белгіленді: <b>${summary.marked}/${summary.total}</b>`,
    "",
    "Төмендегі кнопкадан бөлім таңдаңыз.",
  ].join("\n");
}

function menuButtons() {
  const rows = [];
  if (MINI_APP_URL) {
    rows.push([{ text: "Mini App ашу", web_app: { url: MINI_APP_URL } }]);
  }
  rows.push(
    [{ text: "Қызметкерлер", callback_data: "employees" }, { text: "Табель", callback_data: `day:${today()}` }],
    [{ text: "Календарь", callback_data: `cal:${currentMonth()}` }, { text: "Есеп", callback_data: `report:${currentMonth()}` }],
    [{ text: "Google Sheets", callback_data: "sheets" }],
  );
  return inlineKeyboard(rows);
}

function employeesView(data, showArchived = false) {
  const employees = showArchived ? allEmployees(data) : activeEmployees(data);
  const lines = [`<b>Қызметкерлер</b>`, showArchived ? "Барлық қызметкер:" : "Белсенді қызметкерлер:"];
  if (employees.length === 0) lines.push("Әзірге қызметкер жоқ.");
  for (const [id, employee] of employees) {
    const badge = employee.status === "archived" ? "архив" : "белсенді";
    lines.push(`• ${escapeHtml(employee.name)} — ${money(employee.dailyRate)} (${badge})`);
  }
  return lines.join("\n");
}

function employeesButtons(data, showArchived = false) {
  const employees = showArchived ? allEmployees(data) : activeEmployees(data);
  const rows = employees.map(([id, employee]) => [{ text: employee.name.slice(0, 40), callback_data: `emp:${id}` }]);
  rows.push([{ text: "Қосу", callback_data: "employee:add" }, { text: showArchived ? "Белсенділер" : "Архивпен", callback_data: showArchived ? "employees" : "employees:all" }]);
  rows.push([{ text: "Артқа", callback_data: "menu" }]);
  return inlineKeyboard(rows);
}

function employeeView(data, id) {
  const employee = data.employees[id];
  if (!employee) return "Қызметкер табылмады.";
  const month = currentMonth();
  const report = makeReport(data, month).rows.find((row) => row.id === id);
  return [
    `<b>${escapeHtml(employee.name)}</b>`,
    `ID: <code>${id}</code>`,
    `Статус: ${employee.status === "archived" ? "архив" : "белсенді"}`,
    `Рөлі: <b>${escapeHtml(employee.role || "Қызметкер")}</b>`,
    `Осы ай: <b>${report?.marked || 0}</b> белгі`,
  ].join("\n");
}

function employeeButtons(employeeId, employee) {
  const archiveButton = employee.status === "archived"
    ? { text: "Қайтару", callback_data: `employee:restore:${employeeId}` }
    : { text: "Архив", callback_data: `employee:archive:${employeeId}` };
  return inlineKeyboard([
    [{ text: "Ставка өзгерту", callback_data: `employee:rate:${employeeId}` }, archiveButton],
    [{ text: "Жеке календарь", callback_data: `pcal:${employeeId}:${currentMonth()}` }],
    [{ text: "Бүгін белгілеу", callback_data: `markview:${today()}:${employeeId}:pcal:${currentMonth()}` }],
    [{ text: "Қызметкерлерге қайту", callback_data: "employees" }],
  ]);
}

function personCalendarText(data, employeeId, month) {
  const employee = data.employees[employeeId];
  if (!employee) return "Қызметкер табылмады.";
  const report = makeReport(data, month).rows.find((row) => row.id === employeeId);
  const marked = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const record = getAttendance(data, date, employeeId);
    if (record) marked.push(`${day}:${STATUSES[record.status]?.short || record.status}`);
  }
  return [
    `<b>${escapeHtml(employee.name)}</b>`,
    `<b>${month} жеке календарь</b>`,
    `Рөлі: <b>${escapeHtml(employee.role || "Қызметкер")}</b>`,
    `Белгіленген: <b>${report?.marked || 0}</b> күн`,
    marked.length ? `Белгілер: ${marked.join(", ")}` : "Бұл айда белгі жоқ.",
  ].join("\n");
}

function personCalendarButtons(data, employeeId, month) {
  const rows = [[
    { text: "<", callback_data: `pcal:${employeeId}:${addMonths(month, -1)}` },
    { text: month, callback_data: "noop" },
    { text: ">", callback_data: `pcal:${employeeId}:${addMonths(month, 1)}` },
  ]];
  rows.push(["Дс", "Сс", "Ср", "Бс", "Жм", "Сб", "Жк"].map((day) => ({ text: day, callback_data: "noop" })));
  let row = Array.from({ length: weekdayOffset(month) }, () => ({ text: " ", callback_data: "noop" }));
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const record = getAttendance(data, date, employeeId);
    const label = `${record ? STATUSES[record.status]?.short || "*" : "·"}${day}`;
    row.push({ text: label, callback_data: `markview:${date}:${employeeId}:pcal:${month}` });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push([...row, ...Array.from({ length: 7 - row.length }, () => ({ text: " ", callback_data: "noop" }))]);
  rows.push([{ text: "Карточка", callback_data: `emp:${employeeId}` }]);
  rows.push([{ text: "Қызметкерлер", callback_data: "employees" }]);
  return inlineKeyboard(rows);
}

function calendarText(data, month) {
  const report = makeReport(data, month);
  const active = activeEmployees(data).length;
  const markedDays = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const summary = daySummary(data, date);
    if (summary.marked > 0) markedDays.push(`${day}: ${summary.marked}/${active}`);
  }
  return [
    `<b>${month} календарь</b>`,
    `Айлық жалпы: <b>${money(report.grandTotal)}</b>`,
    markedDays.length ? `Белгі бар күндер: ${markedDays.join(", ")}` : "Бұл айда әлі белгі жоқ.",
  ].join("\n");
}

function calendarButtons(month) {
  const rows = [[
    { text: "<", callback_data: `cal:${addMonths(month, -1)}` },
    { text: month, callback_data: "noop" },
    { text: ">", callback_data: `cal:${addMonths(month, 1)}` },
  ]];
  rows.push(["Дс", "Сс", "Ср", "Бс", "Жм", "Сб", "Жк"].map((day) => ({ text: day, callback_data: "noop" })));
  let row = Array.from({ length: weekdayOffset(month) }, () => ({ text: " ", callback_data: "noop" }));
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    row.push({ text: String(day), callback_data: `day:${date}` });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push([...row, ...Array.from({ length: 7 - row.length }, () => ({ text: " ", callback_data: "noop" }))]);
  rows.push([{ text: "Есеп", callback_data: `report:${month}` }, { text: "Артқа", callback_data: "menu" }]);
  return inlineKeyboard(rows);
}

function dayText(data, date) {
  const summary = daySummary(data, date);
  const lines = [`<b>${date} табелі</b>`, `Белгіленді: <b>${summary.marked}/${summary.total}</b>`];
  for (const [id, employee] of activeEmployees(data)) {
    const status = getAttendance(data, date, id)?.status;
    lines.push(`${status ? STATUSES[status].short : "·"} ${escapeHtml(employee.name)}`);
  }
  return lines.join("\n");
}

function dayButtons(data, date) {
  const rows = activeEmployees(data).map(([id, employee]) => {
    const status = getAttendance(data, date, id)?.status;
    const prefix = status ? STATUSES[status].short : "·";
    return [{ text: `${prefix} ${employee.name}`.slice(0, 55), callback_data: `markview:${date}:${id}` }];
  });
  rows.push([{ text: "Барлығын жұмыста деп белгілеу", callback_data: `allpresent:${date}` }]);
  rows.push([{ text: "Календарь", callback_data: `cal:${date.slice(0, 7)}` }, { text: "Артқа", callback_data: "menu" }]);
  return inlineKeyboard(rows);
}

function markText(data, date, employeeId) {
  const employee = data.employees[employeeId];
  const record = getAttendance(data, date, employeeId);
  return [
    `<b>${escapeHtml(employee?.name || "Қызметкер")}</b>`,
    `Күн: <b>${date}</b>`,
    `Белгі: <b>${record ? STATUSES[record.status].label : "қойылмаған"}</b>`,
  ].join("\n");
}

function markButtons(date, employeeId, back = `day:${date}`) {
  const backParts = back.split(":");
  const suffix = backParts[0] === "pcal" ? `:pcal:${backParts[2]}` : "";
  return inlineKeyboard([
    [{ text: "Жұмыста", callback_data: `mark:${date}:${employeeId}:present${suffix}` }, { text: "Жарты күн", callback_data: `mark:${date}:${employeeId}:half${suffix}` }],
    [{ text: "Жоқ", callback_data: `mark:${date}:${employeeId}:absent${suffix}` }, { text: "Ауырып қалды", callback_data: `mark:${date}:${employeeId}:sick${suffix}` }],
    [{ text: "Демалыс", callback_data: `mark:${date}:${employeeId}:dayoff${suffix}` }],
    [{ text: "Артқа", callback_data: back }],
  ]);
}

function reportButtons(month) {
  return inlineKeyboard([
    [
      { text: "<", callback_data: `report:${addMonths(month, -1)}` },
      { text: month, callback_data: "noop" },
      { text: ">", callback_data: `report:${addMonths(month, 1)}` },
    ],
    [{ text: "CSV алу", callback_data: `export:${month}` }, { text: "Google Sheets", callback_data: "sheets" }],
    [{ text: "Календарь", callback_data: `cal:${month}` }, { text: "Артқа", callback_data: "menu" }],
  ]);
}

function setSession(data, userId, session) {
  data.sessions[String(userId)] = { ...session, createdAt: new Date().toISOString() };
}

function clearSession(data, userId) {
  delete data.sessions[String(userId)];
}

async function handlePendingText(message, data, session, text) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);

  if (session.action === "addEmployee") {
    const match = text.match(/^(.+?)(?:\s*\|\s*(.+))?$/);
    if (!match) {
      await sendMessage(chatId, "Формат: Аты-жөні | рөлі");
      return true;
    }
    const id = nextEmployeeId(data);
    const role = String(match[2] || "Қызметкер").trim() || "Қызметкер";
    data.employees[id] = {
      name: match[1].trim(),
      role,
      dailyRate: 0,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    data.history.push({
      at: new Date().toISOString(),
      action: "Қызметкер қосылды",
      employeeId: id,
      name: data.employees[id].name,
      date: "",
      oldLabel: "",
      newLabel: "Белсенді",
    });
    clearSession(data, userId);
    await saveData(data, { syncSheets: false });
    let syncText = "\nGoogle Sheets қосылмаған: .env ішіндегі GOOGLE_* мәндерін тексеріңіз.";
    if (sheetsConfigured()) {
      try {
        await appendEmployeeToGoogleSheets(id, data.employees[id]);
        syncText = "\nGoogle Sheets жазылды: Қызметкерлер парағына қосылды.";
      } catch (error) {
        syncText = `\nGoogle Sheets жазылмады: ${escapeHtml(error.message)}`;
      }
    }
    await sendMessage(
      chatId,
      `Қосылды: <b>${escapeHtml(data.employees[id].name)}</b>\nРөлі: <b>${escapeHtml(role)}</b>${syncText}`,
      {
        reply_markup: inlineKeyboard([
          [{ text: "Келесі қызметкер қосу", callback_data: "employee:add" }],
          [{ text: "Қызметкерлер тізімі", callback_data: "employees" }],
          [{ text: "Google Sheets-ке жазу", callback_data: "sheets" }],
        ]),
      },
    );
    return true;
  }

  if (session.action === "changeRate") {
    const rate = Number(text.replace(/\s/g, ""));
    const employee = data.employees[session.employeeId];
    if (!employee || Number.isNaN(rate)) {
      await sendMessage(chatId, "Тек сан жазыңыз. Мысалы: 15000");
      return true;
    }
    employee.dailyRate = rate;
    clearSession(data, userId);
    await saveData(data);
    await sendMessage(chatId, `${escapeHtml(employee.name)} жаңа ставкасы: <b>${money(rate)}</b>`, {
      reply_markup: employeeButtons(session.employeeId, employee),
    });
    return true;
  }

  return false;
}

async function handleAdminCommand(message, data, command, args) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);

  if (command === "/start" || command === "мәзір") {
    clearSession(data, userId);
    await saveData(data, { syncSheets: false });
    await sendMessage(chatId, helpText(), { reply_markup: mainKeyboard() });
    return true;
  }

  if (command === "/help" || command === "көмек") {
    await sendMessage(chatId, helpText(), { reply_markup: mainKeyboard() });
    return true;
  }

  if (command === "/add") {
    const fakeMessage = { ...message, text: args };
    setSession(data, userId, { action: "addEmployee" });
    return handlePendingText(fakeMessage, data, data.sessions[userId], args);
  }

  if (command === "/report" || command === "есеп") {
    const month = /^\d{4}-\d{2}$/.test(args) ? args : currentMonth();
    await sendMessage(chatId, reportText(data, month), { reply_markup: reportButtons(month) });
    return true;
  }

  if (command === "/monthly") {
    const month = /^\d{4}-\d{2}$/.test(args) ? args : currentMonth();
    await sendMessage(chatId, [
      `<b>${month} автомат есеп тесті</b>`,
      "",
      reportText(data, month),
    ].join("\n"));
    return true;
  }

  if (command === "/export") {
    const month = /^\d{4}-\d{2}$/.test(args) ? args : currentMonth();
    await sendDocument(chatId, `salary-${month}.csv`, csvReport(data, month), `${month} айлық есеп`);
    return true;
  }

  if (command === "қызметкерлер") {
    await sendMessage(chatId, employeesView(data), { reply_markup: employeesButtons(data) });
    return true;
  }

  if (command === "табель") {
    await sendMessage(chatId, dayText(data, today()), { reply_markup: dayButtons(data, today()) });
    return true;
  }

  if (command === "календарь") {
    await sendMessage(chatId, calendarText(data, currentMonth()), { reply_markup: calendarButtons(currentMonth()) });
    return true;
  }

  if (command === "google sheets") {
    await handleSheets(chatId, data);
    return true;
  }

  if (command === "/sync" || command === "синхрондау") {
    await handleSheets(chatId, data);
    return true;
  }

  return false;
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from?.id || "");
  const text = message.text?.trim();
  if (!text) return;

  if (!isAdmin(userId)) {
    await sendMessage(chatId, "Бұл бот тек жауапты адамға арналған. Админге өз Telegram ID-ыңызды жіберіңіз: " + userId);
    return;
  }

  const data = await loadData();
  const session = data.sessions[userId];
  if (session && await handlePendingText(message, data, session, text)) return;

  const { command, args } = parseCommand(text);
  if (await handleAdminCommand(message, data, command, args)) return;

  await sendMessage(chatId, "Барлық басқару Mini App ішінде. Бұл бот тек хабарлама алу үшін қалдырылды.", { reply_markup: mainKeyboard() });
}

async function handleCallback(callback) {
  const userId = String(callback.from.id);
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const dataValue = callback.data || "";

  if (!isAdmin(userId)) {
    await answerCallback(callback.id, "Рұқсат жоқ");
    return;
  }

  const data = await loadData();
  await answerCallback(callback.id);

  if (dataValue === "noop") return;

  if (dataValue === "menu") {
    clearSession(data, userId);
    await saveData(data, { syncSheets: false });
    await editMessage(chatId, messageId, menuText(data), { reply_markup: menuButtons() });
    return;
  }

  if (dataValue === "employees" || dataValue === "employees:all") {
    const showArchived = dataValue === "employees:all";
    await editMessage(chatId, messageId, employeesView(data, showArchived), { reply_markup: employeesButtons(data, showArchived) });
    return;
  }

  if (dataValue === "employee:add") {
    setSession(data, userId, { action: "addEmployee" });
    await saveData(data, { syncSheets: false });
    await editMessage(chatId, messageId, "Қызметкерді мына форматта жазыңыз:\n\n<b>Аты-жөні | рөлі</b>\n\nМысалы: <code>Айбек Нұрлан | Оператор</code>\n\nОсылай қосқанда адам бірден Google Sheets ішіндегі Қызметкерлер парағына жазылады.");
    return;
  }

  if (dataValue.startsWith("emp:")) {
    const id = dataValue.split(":")[1];
    const employee = data.employees[id];
    await editMessage(chatId, messageId, employeeView(data, id), { reply_markup: employeeButtons(id, employee) });
    return;
  }

  if (dataValue.startsWith("employee:rate:")) {
    const id = dataValue.split(":")[2];
    setSession(data, userId, { action: "changeRate", employeeId: id });
    await saveData(data, { syncSheets: false });
    await editMessage(chatId, messageId, `${escapeHtml(data.employees[id]?.name || "")} үшін жаңа күндік ставканы жазыңыз.\n\nМысалы: <code>15000</code>`);
    return;
  }

  if (dataValue.startsWith("employee:archive:") || dataValue.startsWith("employee:restore:")) {
    const [, action, id] = dataValue.split(":");
    if (data.employees[id]) data.employees[id].status = action === "archive" ? "archived" : "active";
    if (data.employees[id]) {
      data.history.push({
        at: new Date().toISOString(),
        action: action === "archive" ? "Архивке жіберілді" : "Архивтен қайтарылды",
        employeeId: id,
        name: data.employees[id].name,
        date: "",
        oldLabel: action === "archive" ? "Белсенді" : "Архив",
        newLabel: action === "archive" ? "Архив" : "Белсенді",
      });
    }
    await saveData(data);
    await editMessage(chatId, messageId, employeeView(data, id), { reply_markup: employeeButtons(id, data.employees[id]) });
    return;
  }

  if (dataValue.startsWith("cal:")) {
    const month = dataValue.split(":")[1];
    await editMessage(chatId, messageId, calendarText(data, month), { reply_markup: calendarButtons(month) });
    return;
  }

  if (dataValue.startsWith("pcal:")) {
    const [, employeeId, month] = dataValue.split(":");
    await editMessage(chatId, messageId, personCalendarText(data, employeeId, month), {
      reply_markup: personCalendarButtons(data, employeeId, month),
    });
    return;
  }

  if (dataValue.startsWith("day:")) {
    const date = dataValue.split(":")[1];
    await editMessage(chatId, messageId, dayText(data, date), { reply_markup: dayButtons(data, date) });
    return;
  }

  if (dataValue.startsWith("markview:")) {
    const [, date, employeeId, backType, backMonth] = dataValue.split(":");
    const back = backType === "pcal" ? `pcal:${employeeId}:${backMonth || date.slice(0, 7)}` : `day:${date}`;
    await editMessage(chatId, messageId, markText(data, date, employeeId), { reply_markup: markButtons(date, employeeId, back) });
    return;
  }

  if (dataValue.startsWith("mark:")) {
    const [, date, employeeId, status, backType, backMonth] = dataValue.split(":");
    if (data.employees[employeeId] && STATUSES[status]) {
      setAttendance(data, date, employeeId, status);
      await saveData(data);
      await answerCallback(callback.id, `${data.employees[employeeId].name}: ${date} - ${STATUSES[status].label}`);
      if (sheetsConfigured()) {
        try {
          await syncGoogleSheets(data);
        } catch (error) {
          console.error(`Google Sheets auto sync failed: ${error.message}`);
        }
      }
      await sendMessage(
        chatId,
        `Белгі қойылды: <b>${escapeHtml(data.employees[employeeId].name)}</b>\nКүн: <b>${date}</b>\nСтатус: <b>${STATUSES[status].label}</b>`,
        {
          reply_markup: inlineKeyboard([
            [{ text: "Келесі қызметкер", callback_data: "employees" }],
            [{ text: "Google Sheets-ке жазу", callback_data: "sheets" }],
          ]),
        },
      );
    }
    if (backType === "pcal") {
      const month = backMonth || date.slice(0, 7);
      await editMessage(chatId, messageId, personCalendarText(data, employeeId, month), {
        reply_markup: personCalendarButtons(data, employeeId, month),
      });
      return;
    }
    await editMessage(chatId, messageId, dayText(data, date), { reply_markup: dayButtons(data, date) });
    return;
  }

  if (dataValue.startsWith("allpresent:")) {
    const date = dataValue.split(":")[1];
    for (const [id] of activeEmployees(data)) setAttendance(data, date, id, "present");
    await saveData(data);
    await editMessage(chatId, messageId, dayText(data, date), { reply_markup: dayButtons(data, date) });
    return;
  }

  if (dataValue.startsWith("report:")) {
    const month = dataValue.split(":")[1];
    await editMessage(chatId, messageId, reportText(data, month), { reply_markup: reportButtons(month) });
    return;
  }

  if (dataValue.startsWith("export:")) {
    const month = dataValue.split(":")[1];
    await sendDocument(chatId, `salary-${month}.csv`, csvReport(data, month), `${month} айлық есеп`);
    return;
  }

  if (dataValue === "sheets") {
    await handleSheets(chatId, data);
  }

}

async function handleSheets(chatId, data) {
  if (!sheetsConfigured()) {
    await sendMessage(chatId, [
      "<b>Google Sheets әлі қосылмаған.</b>",
      "",
      "bot/.env ішіне мыналарды толтырыңыз:",
      "GOOGLE_SHEET_ID",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "",
      "Сосын Google Sheet файлын service account email-іне Editor ретінде share етіңіз.",
    ].join("\n"));
    return;
  }

  try {
    await syncGoogleSheets(data);
    await sendMessage(chatId, "Google Sheets синхрондалды.");
  } catch (error) {
    await sendMessage(chatId, `Google Sheets қатесі: ${escapeHtml(error.message)}`);
  }
}

function sheetsConfigured() {
  return Boolean(
    SHEET_ID &&
    SHEET_ID !== "your_google_sheet_id" &&
    GOOGLE_CLIENT_EMAIL &&
    !GOOGLE_CLIENT_EMAIL.includes("service-account-name@project-id") &&
    GOOGLE_PRIVATE_KEY &&
    !GOOGLE_PRIVATE_KEY.includes("...")
  );
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
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
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
  const spreadsheet = await googleSheetsFetch("?fields=sheets.properties(sheetId,title,hidden)");
  const sheets = spreadsheet.sheets.map((sheet) => sheet.properties);
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
  if (requests.length) {
    await googleSheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}

function sheetRange(sheetName, cellRange) {
  return `'${sheetName.replaceAll("'", "''")}'!${cellRange}`;
}

async function updateSheetRange(range, values) {
  const encodedRange = encodeURIComponent(range);
  await googleSheetsFetch(`/values/${encodedRange}:clear`, {
    method: "POST",
    body: "{}",
  });
  await googleSheetsFetch(`/values/${encodedRange}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

async function getSheetValues(range) {
  const result = await googleSheetsFetch(`/values/${encodeURIComponent(range)}`);
  return result.values || [];
}

async function appendSheetRows(range, values) {
  await googleSheetsFetch(`/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

async function ensureEmployeeSheetHeader() {
  await ensureSheets();
  const values = await getSheetValues(sheetRange(SHEETS.employees, "A1:F1"));
  if (!values.length || values[0]?.[0] !== "ID") {
    await updateSheetRange(sheetRange(SHEETS.employees, "A1:F1"), [["ID", "Аты-жөні", "Рөлі", "Статус", "Қосылған күні", "Архив күні"]]);
  }
  const historyValues = await getSheetValues(sheetRange(SHEETS.history, "A1:G1"));
  if (!historyValues.length || historyValues[0]?.[0] !== "Уақыт") {
    await updateSheetRange(sheetRange(SHEETS.history, "A1:G1"), [["Уақыт", "Әрекет", "Қызметкер ID", "Аты-жөні", "Күн", "Бұрынғы белгі", "Жаңа белгі"]]);
  }
}

async function appendEmployeeToGoogleSheets(employeeId, employee) {
  if (!sheetsConfigured()) throw new Error("Google Sheets қосылмаған. .env ішіндегі GOOGLE_* мәндерін тексеріңіз.");
  await ensureEmployeeSheetHeader();
  const employeeRows = await getSheetValues(sheetRange(SHEETS.employees, "A2:F5000"));
  const existingIndex = employeeRows.findIndex((row) => row[0] === employeeId);
  const row = [
    employeeId,
    employee.name,
    employee.role || "Қызметкер",
    employee.status === "archived" ? "Архив" : "Белсенді",
    employee.createdAt || "",
    employee.archivedAt || "",
  ];
  if (existingIndex >= 0) {
    const line = existingIndex + 2;
    await updateSheetRange(sheetRange(SHEETS.employees, `A${line}:F${line}`), [row]);
  } else {
    await appendSheetRows(sheetRange(SHEETS.employees, "A:F"), [row]);
  }
  await appendSheetRows(sheetRange(SHEETS.history, "A:G"), [[new Date().toISOString(), "Қызметкер қосылды", employeeId, employee.name, "", "", "Белсенді"]]);
}

async function syncGoogleSheets(data) {
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
  months.add(currentMonth());
  for (const month of [...months].sort()) {
    for (const [id, employee] of allEmployees(data)) {
      const counts = { present: 0, half: 0, absent: 0, dayoff: 0 };
      for (let day = 1; day <= daysInMonth(month); day += 1) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const status = getAttendance(data, date, id)?.status;
        if (counts[status] !== undefined) counts[status] += 1;
      }
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

  await updateSheetRange(sheetRange(SHEETS.employees, "A1:F1000"), employees);
  await updateSheetRange(sheetRange(SHEETS.attendance, "A1:G5000"), attendance);
  await updateSheetRange(sheetRange(SHEETS.reports, "A1:I2000"), summary);
  await updateSheetRange(sheetRange(SHEETS.history, "A1:G5000"), history);
  data.sheetSync = {
    at: new Date().toISOString(),
    rows: {
      employees: employees.length - 1,
      attendance: attendance.length - 1,
      summary: summary.length - 1,
      history: history.length - 1,
    },
  };
  await saveData(data, { syncSheets: false });
}

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

async function sendMonthlyReportsIfDue() {
  const parts = localDateParts();
  if (parts.day !== "30" || parts.hour !== "09" || parts.minute !== "00") return;
  const month = `${parts.year}-${parts.month}`;
  const data = await loadData();
  if (data.monthlyReportSent === month) return;
  const text = [
    `<b>${month} автомат табель есебі</b>`,
    "Айдың 30-күні 09:00 есебі:",
    "",
    reportText(data, month),
  ].join("\n");
  for (const adminId of ADMIN_IDS) {
    await sendMessage(adminId, text);
  }
  data.monthlyReportSent = month;
  await saveData(data, { syncSheets: false });
}

async function poll() {
  let offset = 0;
  console.log(`Бот іске қосылды: ${BOT_VERSION}. Уақыт белдеуі: ${TIME_ZONE}`);
  setInterval(() => {
    sendMonthlyReportsIfDue().catch((error) => console.error(`Monthly report failed: ${error.message}`));
  }, 60_000);
  sendMonthlyReportsIfDue().catch((error) => console.error(`Monthly report failed: ${error.message}`));

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (error) {
      console.error(error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

poll();
