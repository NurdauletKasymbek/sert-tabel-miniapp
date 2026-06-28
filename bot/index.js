import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data.json");

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
const TIME_ZONE = process.env.BOT_TIMEZONE || "Asia/Tashkent";
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const MINI_APP_URL = process.env.MINI_APP_URL || "";
const WORKPLACE_LAT = Number.parseFloat(process.env.WORKPLACE_LAT || "");
const WORKPLACE_LON = Number.parseFloat(process.env.WORKPLACE_LON || "");
const WORKPLACE_RADIUS_M = Number.parseInt(process.env.WORKPLACE_RADIUS_M || "200", 10);
const WORKPLACE_CONFIGURED = Number.isFinite(WORKPLACE_LAT) && Number.isFinite(WORKPLACE_LON);
const checkinSessions = new Map();
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
const PHONELESS_REMINDER_TIME = /^\d{2}:\d{2}$/.test(process.env.PHONELESS_REMINDER_TIME || "")
  ? process.env.PHONELESS_REMINDER_TIME
  : "09:30";

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
  const content = readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const lines = content.split(/\r?\n/);
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

async function saveData(data) {
  // Ескі толық Google Sheets синхрондауы алынды (ол жаңа бағандарды өшіретін).
  // Қатысу мен қызметкер деректері Mini App API арқылы Sheets-ке жазылады.
  await mkdir(__dirname, { recursive: true });
  const tempPath = `${DATA_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, DATA_PATH);
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

async function sendDocument(chatId, fileName, content, caption, contentType = "text/csv;charset=utf-8") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([content], { type: contentType }), fileName);
  const response = await fetch(`${API_URL}/sendDocument`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Файл жіберілмеді");
}

async function sendPhoto(chatId, buffer, caption, extra = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("photo", new Blob([buffer], { type: "image/png" }), "qr.png");
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(extra.reply_markup));
  const response = await fetch(`${API_URL}/sendPhoto`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Сурет жіберілмеді");
  return result.result;
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
    [{ text: "CSV алу", callback_data: `export:${month}` }],
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

  if (command === "/pdf") {
    const month = /^\d{4}-\d{2}$/.test(args) ? args : currentMonth();
    await sendMessage(chatId, `⏳ ${month} айлық жалақы PDF дайындалуда...`);
    try {
      await sendMonthlyPdf(chatId, month);
    } catch (error) {
      await sendMessage(chatId, `❌ PDF жасалмады: ${escapeHtml(error.message)}`);
    }
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

  return false;
}

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

function workerKeyboard() {
  // Reply keyboard web_app initData жібермейді — қолданушылар жоғарыдағы
  // BotFather Menu Button (📱 Табель ашу) арқылы ашуы керек.
  return { remove_keyboard: true };
}

function currentHourMinute() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { hour: h, minute: m, totalMinutes: h * 60 + m };
}

function lateMinutes() {
  const { totalMinutes } = currentHourMinute();
  const start = WORK_START_HOUR * 60;
  return totalMinutes > start ? totalMinutes - start : 0;
}

function earlyLeaveMinutes() {
  const { totalMinutes } = currentHourMinute();
  const end = WORK_END_HOUR * 60;
  return totalMinutes < end ? end - totalMinutes : 0;
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("ru-RU").replace(/,/g, " ") + " ₸";
}

let cachedBotUsername = "";
async function getBotUsernameLocal() {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await telegram("getMe", {});
    cachedBotUsername = me.username || "";
  } catch {
    cachedBotUsername = "";
  }
  return cachedBotUsername;
}

function findEmployeeByTelegramId(state, userId) {
  const id = String(userId);
  const all = [...(state.employees || []), ...(state.archivedEmployees || [])];
  return all.find((emp) => String(emp.telegramId || "") === id);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = String(message.from?.id || "");
  const text = (message.text || "").trim();

  if (isAdmin(userId)) {
    await handleAdminMessage(message, text, chatId);
    return;
  }

  if (text.startsWith("/start")) {
    await sendWorkerWelcome(chatId, message.from);
    return;
  }

  if (message.location) {
    await sendMessage(chatId, [
      "❌ <b>Мұндай жолмен кіру қабылданбайды.</b>",
      "",
      "Жұмысқа кіру/шығу тек <b>Mini App</b> арқылы:",
      "↑ Жоғарыдағы <b>📱 Табель ашу</b> батырмасын басыңыз",
    ].join("\n"), { reply_markup: workerKeyboard() });
    return;
  }

  if (
    text === "📍 Мен келдім" ||
    text === "📅 Менің табелім" ||
    text === "📊 Осы ай" ||
    text === "💰 Аванс" ||
    text === "🚪 Шығып жатырмын"
  ) {
    await sendMessage(chatId, "Енді барлық әрекеттер <b>Mini App</b>-та. ↑ Жоғарыдағы <b>📱 Табель ашу</b> батырмасын басыңыз", { reply_markup: workerKeyboard() });
    return;
  }

  await sendMessage(chatId, "Төмендегі түймелерді пайдаланыңыз.", { reply_markup: workerKeyboard() });
}

async function handleWorkerCheckout(chatId, userId) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const employee = findEmployeeByTelegramId(state, userId);
  if (!employee) {
    await sendMessage(chatId, "Сіз әлі тіркелмегенсіз.", { reply_markup: workerKeyboard() });
    return;
  }
  const today = state.today;
  const existing = state.attendance?.[today]?.[employee.id];
  if (!existing || existing.status !== "present") {
    await sendMessage(chatId, "Бүгін жұмысқа белгіленбегенсіз немесе басқа статус қойылған.", { reply_markup: workerKeyboard() });
    return;
  }
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const early = earlyLeaveMinutes();
  await sendMessage(chatId, [
    `🚪 <b>${escapeHtml(employee.name)}</b>`,
    "",
    `Шығуды растайсыз ба? Сағат: <b>${time}</b>`,
    early > 0 ? `⚠️ Ерте кету: ${early} минут бұрын (жұмыс ${WORK_END_HOUR}:00-де бітеді)` : "",
  ].filter(Boolean).join("\n"), {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Иә, шығамын", callback_data: `checkout:${employee.id}` },
        { text: "❌ Жоқ", callback_data: "checkout_cancel" },
      ]],
    },
  });
}

async function sendWorkerAdvance(chatId, userId) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const employee = findEmployeeByTelegramId(state, userId);
  if (!employee) {
    await sendMessage(chatId, "Сіз әлі тіркелмегенсіз.", { reply_markup: workerKeyboard() });
    return;
  }
  const month = state.month;
  const monthData = state.advancesByMonth?.[month]?.[employee.id];
  const items = monthData?.items || [];
  items.sort((a, b) => a.date.localeCompare(b.date));
  const total = monthData?.total || 0;
  const lines = items.map((it) => `• ${it.date}: <b>${formatMoney(it.amount)}</b>${it.note ? " — " + escapeHtml(it.note) : ""}`);
  await sendMessage(chatId, [
    `<b>💰 ${escapeHtml(employee.name)} — ${month}</b>`,
    "",
    lines.length ? lines.join("\n") : "Бұл айда аванс алынбаған.",
    "",
    `Жалпы алынды: <b>${formatMoney(total)}</b>`,
  ].join("\n"), { reply_markup: workerKeyboard() });
}

async function handleAdminMessage(message, text, chatId) {
  const lower = text.toLowerCase();

  if (lower.startsWith("/start") || lower === "/menu") {
    await sendMessage(chatId, [
      "<b>Sert табель — әкімші</b>",
      "",
      "Толық басқару Mini App-та (жоғарыдағы мәзір батырмасы).",
      "",
      "Командалар:",
      "/qr — есік алдына ілу үшін жалпы QR",
    ].join("\n"), { reply_markup: { remove_keyboard: true } });
    return;
  }

  if (lower === "/qr") {
    await sendSharedQr(chatId);
    return;
  }
}

async function sendWorkerWelcome(chatId, fromUser) {
  const greeting = fromUser?.first_name ? `Сәлем, ${escapeHtml(fromUser.first_name)}! 👋` : "Сәлем! 👋";
  await sendMessage(chatId, [
    greeting,
    "",
    "Жұмысқа кіру, шығу, табельіңді көру — бәрі <b>Mini App</b>-та.",
    "",
    "↑ Жоғарыдағы <b>📱 Табель ашу</b> батырмасын басыңыз",
    "(хабарлама жолының сол жағында)",
  ].join("\n"), { reply_markup: workerKeyboard() });
}

async function sendSharedQr(chatId) {
  const username = await getBotUsernameLocal();
  if (!username) {
    await sendMessage(chatId, "Бот username алынбады.");
    return;
  }
  const url = `https://t.me/${username}?start=checkin`;
  const png = await QRCode.toBuffer(url, { width: 600, margin: 2, errorCorrectionLevel: "M" });
  await sendPhoto(chatId, png, [
    "<b>Жалпы QR — есік алдына іліңіз</b>",
    "",
    `Сілтеме: <code>${escapeHtml(url)}</code>`,
    "",
    "Қызметкер сканерлесе, бот ашылып орналасуын сұрайды. Алғаш рет сканерлегенде сізге растау сұрауы келеді.",
  ].join("\n"));
}

async function handleWorkerLocation(message, chatId, userId) {
  if (!WORKPLACE_CONFIGURED) {
    await sendMessage(chatId, "Жұмыс орны әлі баптауланбаған. Әкімшіге хабарлас.", { reply_markup: workerKeyboard() });
    return;
  }
  const dist = distanceMeters(WORKPLACE_LAT, WORKPLACE_LON, message.location.latitude, message.location.longitude);
  if (dist > WORKPLACE_RADIUS_M) {
    await sendMessage(chatId, [
      "❌ <b>Сіз жұмыс орнында емессіз.</b>",
      "",
      `Қашықтық: ~<b>${Math.round(dist)} м</b>`,
      `Рұқсат: <b>${WORKPLACE_RADIUS_M} м</b>`,
    ].join("\n"), { reply_markup: workerKeyboard() });
    return;
  }
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const employee = findEmployeeByTelegramId(state, userId);
  if (!employee) {
    await notifyAdminsToBind(message.from, state);
    await sendMessage(chatId, [
      "🔒 Сіздің Telegram-ыңыз әлі тіркелмеген.",
      "",
      "Әкімшіге сұрау жіберілді. Растағаннан кейін қайта <b>📍 Мен келдім</b> басыңыз.",
    ].join("\n"), { reply_markup: workerKeyboard() });
    return;
  }
  const today = state.today;
  const existing = state.attendance?.[today]?.[employee.id];
  if (existing?.status === "present") {
    await sendMessage(chatId, `✅ Сіз бүгін <b>${existing.time || ""}</b> кезінде белгіленгенсіз.`, { reply_markup: workerKeyboard() });
    return;
  }
  try {
    await postApiAttendance({ date: today, employeeId: employee.id, status: "present" });
  } catch (error) {
    await sendMessage(chatId, `Сақталмады: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const late = lateMinutes();
  const lateText = late > 0 ? `\n⚠️ <b>Кешіктіңіз: ${late} минут</b> (жұмыс 0${WORK_START_HOUR}:00-де басталады)` : "";
  await sendMessage(chatId, [
    `✅ <b>${escapeHtml(employee.name)}</b>`,
    "",
    `Бүгін <b>${time}</b> кезінде жұмысқа келді деп белгіленді.`,
    `Қашықтық: ~${Math.round(dist)} м`,
    lateText,
  ].filter(Boolean).join("\n"), { reply_markup: workerKeyboard() });
  const adminMsg = late > 0
    ? `⚠️ <b>${escapeHtml(employee.name)}</b> ${late} минутқа кешікті (${time})`
    : `📍 <b>${escapeHtml(employee.name)}</b> жұмысқа келді (${time})`;
  for (const adminId of ADMIN_IDS) {
    try {
      await sendMessage(adminId, adminMsg);
    } catch {}
  }
}

async function notifyAdminsToBind(fromUser, state) {
  const unbound = (state.employees || []).filter((e) => !e.telegramId);
  const buttons = unbound.slice(0, 30).map((e) => ([{ text: e.name, callback_data: `bind:${e.id}:${fromUser.id}` }]));
  const header = [
    "<b>🔔 Жаңа тіркеу сұранысы</b>",
    "",
    `Аты: ${escapeHtml(fromUser.first_name || "")} ${escapeHtml(fromUser.last_name || "")}`.trim(),
    fromUser.username ? `Username: @${escapeHtml(fromUser.username)}` : "",
    `Telegram ID: <code>${fromUser.id}</code>`,
    "",
    unbound.length ? "Қай қызметкерге бекітеміз?" : "⚠️ Тіркеуге бос қызметкер жоқ. Mini App-та жаңа қызметкер қосыңыз.",
  ].filter(Boolean).join("\n");
  for (const adminId of ADMIN_IDS) {
    try {
      await sendMessage(adminId, header, unbound.length ? { reply_markup: { inline_keyboard: buttons } } : {});
    } catch {}
  }
}

async function handleRegistrationCallback(callback, targetTgId, approve) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;

  if (!approve) {
    await answerCallback(callback.id, "Бас тартылды ❌");
    try {
      await editMessage(chatId, messageId, "❌ Тіркеу сұранысы бас тартылды.", { reply_markup: { inline_keyboard: [] } });
    } catch {}
    try {
      await sendMessage(targetTgId, "❌ Тіркеу сұранысыңыз қабылданбады. Әкімшіге хабарласыңыз.");
    } catch {}
    return;
  }

  if (!MINI_APP_URL) {
    await answerCallback(callback.id, "MINI_APP_URL орнатылмаған");
    return;
  }

  // Pending name + role-ды Telegram message text-тен parse жасау
  const text = callback.message.text || callback.message.caption || "";
  const nameMatch = text.match(/Аты-жөні:\s*([^\n]+)/);
  const roleMatch = text.match(/Рөлі:\s*([^\n]+)/);
  const name = nameMatch?.[1]?.trim() || "";
  const role = roleMatch?.[1]?.trim() || "Қызметкер";

  if (!name) {
    await answerCallback(callback.id, "Аты-жөні табылмады");
    return;
  }

  try {
    const empResp = await fetch(`${MINI_APP_URL}/api/employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, telegramId: targetTgId }),
    });
    const empData = await empResp.json().catch(() => ({}));
    if (!empResp.ok) throw new Error(empData.error || `API қатесі: ${empResp.status}`);

    await answerCallback(callback.id, "Растадыңыз ✅");
    try {
      await editMessage(chatId, messageId, `✅ <b>${escapeHtml(name)}</b> тіркелді (Telegram ID: <code>${escapeHtml(targetTgId)}</code>)`, { reply_markup: { inline_keyboard: [] } });
    } catch {}

    try {
      await sendMessage(targetTgId, [
        "✅ <b>Сіз тіркелдіңіз!</b>",
        "",
        `Аты-жөні: <b>${escapeHtml(name)}</b>`,
        `Рөлі: <b>${escapeHtml(role)}</b>`,
        "",
        "Енді Mini App-ты <b>қайта ашып</b>, жұмысқа кіре аласыз.",
      ].join("\n"), { reply_markup: workerKeyboard() });
    } catch {}
  } catch (error) {
    await answerCallback(callback.id, "Қате");
    await sendMessage(chatId, `Қате: ${error.message}`);
  }
}

async function handleBindCallback(callback, employeeId, telegramId) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  if (!MINI_APP_URL) {
    await answerCallback(callback.id, "MINI_APP_URL орнатылмаған");
    return;
  }
  try {
    const response = await fetch(`${MINI_APP_URL}/api/employees/${encodeURIComponent(employeeId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ telegramId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `API қатесі: ${response.status}`);
    const employee = (result.employees || []).find((e) => e.id === employeeId);
    await answerCallback(callback.id, "Бекітілді ✅");
    await editMessage(chatId, messageId, `✅ <b>${escapeHtml(employee?.name || employeeId)}</b> бекітілді (Telegram ID: <code>${telegramId}</code>)`, { reply_markup: { inline_keyboard: [] } });
    try {
      await sendMessage(telegramId, `✅ Сіз тіркелдіңіз${employee ? `: <b>${escapeHtml(employee.name)}</b>` : ""}!\n\nЕнді <b>📍 Мен келдім</b> түймесін басыңыз.`, { reply_markup: workerKeyboard() });
    } catch {}
  } catch (error) {
    await answerCallback(callback.id, "Қате");
    await sendMessage(chatId, `Қате: ${error.message}`);
  }
}

async function sendWorkerMonth(chatId, userId) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const employee = findEmployeeByTelegramId(state, userId);
  if (!employee) {
    await sendMessage(chatId, "Сіз әлі тіркелмегенсіз. Алдымен есік алдындағы QR-ды сканерлеп, әкімшінің растауын күтіңіз.", { reply_markup: workerKeyboard() });
    return;
  }
  const month = state.today.slice(0, 7);
  const records = [];
  for (const [date, dayMap] of Object.entries(state.attendance || {})) {
    if (!date.startsWith(month)) continue;
    const r = dayMap[employee.id];
    if (r) records.push({ date, status: r.status, time: r.time || "" });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  const emoji = { present: "✅", half: "🟡", absent: "❌", sick: "🤒", dayoff: "🌴" };
  const lines = records.length
    ? records.map((r) => `${emoji[r.status] || "•"} ${r.date}${r.time ? " — " + r.time : ""}`)
    : ["Жазба әлі жоқ."];
  await sendMessage(chatId, [
    `<b>${escapeHtml(employee.name)} — ${month}</b>`,
    "",
    ...lines,
  ].join("\n"), { reply_markup: workerKeyboard() });
}

async function sendWorkerStats(chatId, userId) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  const employee = findEmployeeByTelegramId(state, userId);
  if (!employee) {
    await sendMessage(chatId, "Сіз әлі тіркелмегенсіз.", { reply_markup: workerKeyboard() });
    return;
  }
  const month = state.today.slice(0, 7);
  let present = 0, half = 0, absent = 0, dayoff = 0, sick = 0;
  for (const [date, dayMap] of Object.entries(state.attendance || {})) {
    if (!date.startsWith(month)) continue;
    const r = dayMap[employee.id];
    if (!r) continue;
    if (r.status === "present") present++;
    else if (r.status === "half") half++;
    else if (r.status === "absent") absent++;
    else if (r.status === "dayoff") dayoff++;
    else if (r.status === "sick") sick++;
  }
  await sendMessage(chatId, [
    `<b>${escapeHtml(employee.name)} — ${month}</b>`,
    "",
    `✅ Жұмыста: <b>${present}</b>`,
    `🟡 Жарты күн: <b>${half}</b>`,
    `❌ Жоқ: <b>${absent}</b>`,
    `🤒 Ауырып: <b>${sick}</b>`,
    `🌴 Демалыс: <b>${dayoff}</b>`,
  ].join("\n"), { reply_markup: workerKeyboard() });
}

async function fetchApiState() {
  if (!MINI_APP_URL) throw new Error("MINI_APP_URL орнатылмаған");
  const response = await fetch(`${MINI_APP_URL}/api/state`);
  if (!response.ok) throw new Error(`API қатесі: ${response.status}`);
  return response.json();
}

async function postApiAttendance(payload) {
  if (!MINI_APP_URL) throw new Error("MINI_APP_URL орнатылмаған");
  const response = await fetch(`${MINI_APP_URL}/api/attendance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `API қатесі: ${response.status}`);
  return result;
}

async function postApiCheckout(payload) {
  if (!MINI_APP_URL) throw new Error("MINI_APP_URL орнатылмаған");
  const response = await fetch(`${MINI_APP_URL}/api/attendance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, action: "checkout" }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `API қатесі: ${response.status}`);
  return result;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function handleCheckinStart(chatId, fromUser, arg) {
  const employeeId = arg.replace(/^(in_|checkin_)/, "").trim();
  if (!employeeId) {
    await sendMessage(chatId, "QR код қате. Жауаптыға хабарласыңыз.");
    return;
  }
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Жүйеге қосылу мүмкін болмады: ${error.message}`);
    return;
  }
  const employee = [...(state.employees || []), ...(state.archivedEmployees || [])].find((emp) => emp.id === employeeId);
  if (!employee) {
    await sendMessage(chatId, "Қызметкер табылмады. Жауаптыға хабарласыңыз.");
    return;
  }
  const today = state.today;
  const existing = state.attendance?.[today]?.[employeeId];
  if (existing?.status === "present") {
    await sendMessage(chatId, `<b>${escapeHtml(employee.name)}</b>\n\n✅ Сіз бүгін <b>${existing.time || ""}</b> кезінде белгіленгенсіз.`, { reply_markup: { remove_keyboard: true } });
    return;
  }

  if (!WORKPLACE_CONFIGURED) {
    const greeting = fromUser?.first_name ? `Сәлем, ${escapeHtml(fromUser.first_name)}!` : "Сәлем!";
    await sendMessage(chatId, [
      greeting, "",
      `<b>${escapeHtml(employee.name)}</b> (${escapeHtml(employee.role || "Қызметкер")})`,
      `Бүгін: <b>${today}</b>`, "",
      "Жұмысқа келдіңіз бе? Растаңыз:",
    ].join("\n"), {
      reply_markup: { inline_keyboard: [[{ text: "✅ Иә, келдім", callback_data: `checkin:${employeeId}` }]] },
    });
    return;
  }

  const userId = String(fromUser?.id || "");
  checkinSessions.set(userId, { employeeId, expiresAt: Date.now() + 10 * 60 * 1000 });
  await sendMessage(chatId, [
    `<b>${escapeHtml(employee.name)}</b>`, "",
    "📍 Жұмысқа келгеніңізді растау үшін орналасуыңды жіберіңіз:",
    "",
    "<i>Төмендегі көк батырманы басыңыз.</i>",
  ].join("\n"), {
    reply_markup: {
      keyboard: [
        [{ text: "📍 Орналасуымды жіберу", request_location: true }],
        [{ text: "❌ Бас тарту" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function handleLocationMessage(chatId, fromUser, location) {
  const userId = String(fromUser?.id || "");
  const session = checkinSessions.get(userId);
  if (!session || session.expiresAt < Date.now()) {
    checkinSessions.delete(userId);
    await sendMessage(chatId, "Тіркеу мерзімі бітті. QR-ды қайтадан сканерлеңіз.", { reply_markup: { remove_keyboard: true } });
    return;
  }
  if (!WORKPLACE_CONFIGURED) {
    checkinSessions.delete(userId);
    return;
  }
  const dist = distanceMeters(WORKPLACE_LAT, WORKPLACE_LON, location.latitude, location.longitude);
  if (dist > WORKPLACE_RADIUS_M) {
    await sendMessage(
      chatId,
      `❌ <b>Сіз жұмыс орнында емессіз.</b>\n\nҚашықтық: ~<b>${Math.round(dist)} м</b>\nРұқсат етілген: <b>${WORKPLACE_RADIUS_M} м</b>\n\nЖұмыс орнына барып қайта сканерлеңіз.`,
      { reply_markup: { remove_keyboard: true } },
    );
    return;
  }
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: { remove_keyboard: true } });
    return;
  }
  const employee = [...(state.employees || []), ...(state.archivedEmployees || [])].find((emp) => emp.id === session.employeeId);
  if (!employee) {
    checkinSessions.delete(userId);
    await sendMessage(chatId, "Қызметкер табылмады.", { reply_markup: { remove_keyboard: true } });
    return;
  }
  try {
    await postApiAttendance({ date: state.today, employeeId: session.employeeId, status: "present" });
  } catch (error) {
    await sendMessage(chatId, `Сақталмады: ${error.message}`, { reply_markup: { remove_keyboard: true } });
    return;
  }
  checkinSessions.delete(userId);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const late = lateMinutes();
  await sendMessage(
    chatId,
    [
      `✅ <b>${escapeHtml(employee.name)}</b>`,
      "",
      `Бүгін <b>${time}</b> кезінде жұмысқа келді деп белгіленді.`,
      `Қашықтық: ~${Math.round(dist)} м`,
      late > 0 ? `⚠️ <b>Кешіктіңіз: ${late} минут</b> (жұмыс 0${WORK_START_HOUR}:00-де басталады)` : "",
    ].filter(Boolean).join("\n"),
    { reply_markup: { remove_keyboard: true } },
  );
  if (late > 0) {
    for (const adminId of ADMIN_IDS) {
      try { await sendMessage(adminId, `⚠️ <b>${escapeHtml(employee.name)}</b> ${late} минутқа кешікті (${time})`); } catch {}
    }
  }
}

async function handleCheckinCallback(callback, employeeId) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await answerCallback(callback.id, "Қате");
    await sendMessage(chatId, `Жүйеге қосылу мүмкін болмады: ${error.message}`);
    return;
  }
  const employee = [...(state.employees || []), ...(state.archivedEmployees || [])].find((emp) => emp.id === employeeId);
  if (!employee) {
    await answerCallback(callback.id, "Қызметкер табылмады");
    return;
  }
  const today = state.today;
  try {
    await postApiAttendance({ date: today, employeeId, status: "present" });
  } catch (error) {
    await answerCallback(callback.id, "Сақталмады");
    await sendMessage(chatId, `Қате: ${error.message}`);
    return;
  }
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const late = lateMinutes();
  await answerCallback(callback.id, "Белгіленді ✅");
  await editMessage(chatId, messageId, [
    `✅ <b>${escapeHtml(employee.name)}</b>`,
    `Бүгін <b>${time}</b> кезінде жұмысқа келді деп белгіленді.`,
    late > 0 ? `⚠️ Кешіктіңіз: ${late} минут (жұмыс 0${WORK_START_HOUR}:00-де басталады)` : "",
  ].filter(Boolean).join("\n"), { reply_markup: { inline_keyboard: [] } });
  if (late > 0) {
    for (const adminId of ADMIN_IDS) {
      try { await sendMessage(adminId, `⚠️ <b>${escapeHtml(employee.name)}</b> ${late} минутқа кешікті (${time})`); } catch {}
    }
  }
}

async function handleCheckoutCallback(callback, employeeId) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await answerCallback(callback.id, "Қате");
    return;
  }
  const employee = [...(state.employees || []), ...(state.archivedEmployees || [])].find((emp) => emp.id === employeeId);
  if (!employee) {
    await answerCallback(callback.id, "Қызметкер табылмады");
    return;
  }
  const today = state.today;
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const early = earlyLeaveMinutes();
  try {
    await postApiCheckout({ date: today, employeeId, checkOutTime: time, earlyMinutes: early });
  } catch (error) {
    await answerCallback(callback.id, "Сақталмады");
    await sendMessage(chatId, `Қате: ${error.message}`, { reply_markup: workerKeyboard() });
    return;
  }
  await answerCallback(callback.id, "Шығу белгіленді ✅");
  await editMessage(chatId, messageId, [
    `🚪 <b>${escapeHtml(employee.name)}</b>`,
    "",
    `Шығу уақыты: <b>${time}</b>`,
    early > 0 ? `⚠️ Жұмыстан ${early} минут ерте кетті (${WORK_END_HOUR}:00-де бітеді)` : "✅ Жұмыс уақыты толық аяқталды",
  ].filter(Boolean).join("\n"), { reply_markup: { inline_keyboard: [] } });
  const adminMsg = early > 0
    ? `⚠️ <b>${escapeHtml(employee.name)}</b> жұмыстан ${early} минут ерте кетті (${time})`
    : `🚪 <b>${escapeHtml(employee.name)}</b> жұмыстан шықты (${time})`;
  for (const adminId of ADMIN_IDS) {
    try { await sendMessage(adminId, adminMsg); } catch {}
  }
}

// Таңғы еске салудан телефонсыз қызметкерді бір батырмамен белгілеу.
async function handleQuickMarkCallback(callback, status, employeeId) {
  if (status !== "present" && status !== "absent") {
    await answerCallback(callback.id, "Қате");
    return;
  }
  const date = today();
  try {
    await postApiAttendance({ date, employeeId, status });
  } catch (error) {
    await answerCallback(callback.id, "Сақталмады");
    await sendMessage(callback.message.chat.id, `❌ ${escapeHtml(error.message)}`);
    return;
  }
  await answerCallback(callback.id, status === "present" ? "✅ Жұмыста" : "❌ Жоқ деп белгіленді");
  // Белгіленген қызметкердің батырма қатарын тізімнен алып тастаймыз.
  const oldRows = callback.message.reply_markup?.inline_keyboard || [];
  const rows = oldRows.filter((row) => !row.some((btn) => String(btn.callback_data || "").endsWith(`:${employeeId}`)));
  const onlyAllLeft = rows.every((row) => row.every((btn) => String(btn.callback_data || "").startsWith("qallpresent:")));
  try {
    if (onlyAllLeft) {
      await editMessage(callback.message.chat.id, callback.message.message_id, "✅ <b>Барлық телефонсыз қызметкер белгіленді.</b>", { reply_markup: { inline_keyboard: [] } });
    } else {
      await telegram("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: rows } });
    }
  } catch {}
}

async function handleQuickAllPresentCallback(callback, date) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    await answerCallback(callback.id, "Қате");
    return;
  }
  const todayRecords = state.attendance?.[date] || {};
  const pending = (state.employees || []).filter(
    (emp) => !String(emp.telegramId || "").trim() && !todayRecords[emp.id],
  );
  let ok = 0;
  for (const emp of pending) {
    try {
      await postApiAttendance({ date, employeeId: emp.id, status: "present" });
      ok += 1;
    } catch {}
  }
  await answerCallback(callback.id, `✅ ${ok} қызметкер белгіленді`);
  try {
    await editMessage(callback.message.chat.id, callback.message.message_id, `✅ <b>${ok} телефонсыз қызметкер «Жұмыста» деп белгіленді.</b>`, { reply_markup: { inline_keyboard: [] } });
  } catch {}
}

async function handleCallback(callback) {
  const userId = String(callback.from.id);
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const dataValue = callback.data || "";

  if (dataValue.startsWith("checkin:")) {
    await handleCheckinCallback(callback, dataValue.slice("checkin:".length));
    return;
  }

  if (dataValue === "checkout_cancel") {
    await answerCallback(callback.id, "Болдырмадыңыз");
    try {
      await telegram("deleteMessage", { chat_id: callback.message.chat.id, message_id: callback.message.message_id });
    } catch {}
    return;
  }

  if (dataValue.startsWith("checkout:")) {
    await handleCheckoutCallback(callback, dataValue.slice("checkout:".length));
    return;
  }

  if (dataValue.startsWith("qmark:")) {
    if (!isAdmin(userId)) {
      await answerCallback(callback.id, "Рұқсат жоқ");
      return;
    }
    const [, status, empId] = dataValue.split(":");
    await handleQuickMarkCallback(callback, status, empId);
    return;
  }

  if (dataValue.startsWith("qallpresent:")) {
    if (!isAdmin(userId)) {
      await answerCallback(callback.id, "Рұқсат жоқ");
      return;
    }
    await handleQuickAllPresentCallback(callback, dataValue.slice("qallpresent:".length));
    return;
  }

  if (dataValue.startsWith("bind:")) {
    if (!isAdmin(userId)) {
      await answerCallback(callback.id, "Рұқсат жоқ");
      return;
    }
    const [, empId, tgId] = dataValue.split(":");
    await handleBindCallback(callback, empId, tgId);
    return;
  }

  if (dataValue.startsWith("reg_approve:") || dataValue.startsWith("reg_reject:")) {
    if (!isAdmin(userId)) {
      await answerCallback(callback.id, "Рұқсат жоқ");
      return;
    }
    const approve = dataValue.startsWith("reg_approve:");
    const targetTgId = dataValue.split(":")[1];
    await handleRegistrationCallback(callback, targetTgId, approve);
    return;
  }

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
      await sendMessage(
        chatId,
        `Белгі қойылды: <b>${escapeHtml(data.employees[employeeId].name)}</b>\nКүн: <b>${date}</b>\nСтатус: <b>${STATUSES[status].label}</b>`,
        {
          reply_markup: inlineKeyboard([
            [{ text: "Келесі қызметкер", callback_data: "employees" }],
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

// PDF Vercel жағында жасалады (бір ғана көз — api/me.js). Бот тек байттарды
// алып, Telegram-ға жібереді. Сол URL-ді Mini App батырмасы да қолданады.
async function fetchMonthlyPdf(month) {
  if (!MINI_APP_URL) throw new Error("MINI_APP_URL орнатылмаған");
  const response = await fetch(`${MINI_APP_URL}/api/me?report=monthly&format=pdf&month=${encodeURIComponent(month)}`);
  if (!response.ok) {
    let msg = `API қатесі: ${response.status}`;
    try { const j = await response.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function sendMonthlyPdf(chatId, month) {
  const pdf = await fetchMonthlyPdf(month);
  await sendDocument(
    chatId,
    `jalaqy-esep-${month}.pdf`,
    pdf,
    `<b>${month}</b> айлық жалақы есебі`,
    "application/pdf",
  );
}

// Автоматты жіберу күні: айдың соңғы күні. Бірақ ол жексенбіге келсе —
// алдыңғы күн (сенбі). Жұмыс дүйсенбі–сенбі, жексенбіде жұмыс жоқ, әрі
// есеп толық айды қамтиды (жексенбіде қатысу болмайды).
function monthlyReportDay(year, monthNum, lastDay) {
  const weekday = new Date(Date.UTC(year, monthNum - 1, lastDay)).getUTCDay(); // 0=жексенбі
  return weekday === 0 ? lastDay - 1 : lastDay;
}

async function sendMonthlyReportsIfDue() {
  const parts = localDateParts();
  const month = `${parts.year}-${parts.month}`;
  const dim = daysInMonth(month);
  const reportDay = monthlyReportDay(Number(parts.year), Number(parts.month), dim);
  const reportDayStr = String(reportDay).padStart(2, "0");
  if (parts.day !== reportDayStr || parts.hour !== "16" || parts.minute !== "30") return;
  const data = await loadData();
  if (data.monthlyReportSent === month) return;
  for (const adminId of ADMIN_IDS) {
    try {
      await sendMonthlyPdf(adminId, month);
    } catch (error) {
      await sendMessage(adminId, `❌ Айлық PDF жіберілмеді: ${escapeHtml(error.message)}`).catch(() => {});
    }
  }
  data.monthlyReportSent = month;
  await saveData(data, { syncSheets: false });
}

async function sendPhonelessReminderIfDue() {
  const parts = localDateParts();
  const time = `${parts.hour}:${parts.minute}`;
  if (time !== PHONELESS_REMINDER_TIME) return;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const data = await loadData();
  if (data.phonelessReminderSent === date) return;
  data.phonelessReminderSent = date;
  await saveData(data, { syncSheets: false });
  await sendPhonelessReminder(date);
}

// Телефоны жоқ (telegramId жоқ) әрі бүгін белгіленбеген қызметкерлерді
// админге тізіммен + жылдам белгілеу батырмаларымен еске салу.
async function sendPhonelessReminder(date) {
  let state;
  try {
    state = await fetchApiState();
  } catch (error) {
    for (const adminId of ADMIN_IDS) {
      await sendMessage(adminId, `❌ Еске салу дайындалмады: ${escapeHtml(error.message)}`).catch(() => {});
    }
    return;
  }
  const todayRecords = state.attendance?.[date] || {};
  const pending = (state.employees || []).filter(
    (emp) => !String(emp.telegramId || "").trim() && !todayRecords[emp.id],
  );
  if (!pending.length) return;

  const rows = pending.map((emp) => [
    { text: `✅ ${emp.name}`.slice(0, 30), callback_data: `qmark:present:${emp.id}` },
    { text: "❌ Жоқ", callback_data: `qmark:absent:${emp.id}` },
  ]);
  rows.push([{ text: "✅ Барлығын Жұмыста", callback_data: `qallpresent:${date}` }]);

  const text = [
    "🔔 <b>Телефонсыз қызметкерлерді белгілеу</b>",
    `Күн: <b>${date}</b>`,
    "",
    "Бүгін әлі белгіленбегендер:",
    ...pending.map((emp) => `• ${escapeHtml(emp.name)}`),
    "",
    "Төмендегі батырмамен бірден белгілеңіз 👇",
  ].join("\n");

  for (const adminId of ADMIN_IDS) {
    await sendMessage(adminId, text, { reply_markup: { inline_keyboard: rows } }).catch(() => {});
  }
}

async function configureBotMenu() {
  try {
    await telegram("setMyCommands", { commands: [] });
  } catch (error) {
    console.error(`setMyCommands failed: ${error.message}`);
  }
  if (!MINI_APP_URL) return;
  for (const adminId of ADMIN_IDS) {
    try {
      await telegram("setChatMenuButton", {
        chat_id: Number(adminId),
        menu_button: { type: "web_app", text: "Mini App", web_app: { url: MINI_APP_URL } },
      });
    } catch (error) {
      console.error(`setChatMenuButton(${adminId}) failed: ${error.message}`);
    }
  }
}

async function poll() {
  let offset = 0;
  console.log(`Бот іске қосылды: ${BOT_VERSION}. Уақыт белдеуі: ${TIME_ZONE}`);
  await configureBotMenu();
  setInterval(() => {
    sendMonthlyReportsIfDue().catch((error) => console.error(`Monthly report failed: ${error.message}`));
    sendPhonelessReminderIfDue().catch((error) => console.error(`Phoneless reminder failed: ${error.message}`));
  }, 60_000);
  sendMonthlyReportsIfDue().catch((error) => console.error(`Monthly report failed: ${error.message}`));
  sendPhonelessReminderIfDue().catch((error) => console.error(`Phoneless reminder failed: ${error.message}`));

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
