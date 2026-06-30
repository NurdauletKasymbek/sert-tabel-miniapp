import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Camera,
  QrCode,
  Copy,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Clock3,
  FileDown,
  FileSpreadsheet,
  LogOut,
  MapPin,
  Megaphone,
  Moon,
  Plane,
  Wallet,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Umbrella,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";

const statusMeta = {
  present: {
    label: "Жұмыста",
    caption: "Толық күн",
    Icon: BriefcaseBusiness,
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    chipDark: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    button: "from-emerald-500 to-emerald-700 shadow-emerald-900/20",
    cellBg: "bg-emerald-100",
    cellBgDark: "bg-emerald-500/25",
    accent: "#10b981",
  },
  half: {
    label: "Жарты күн",
    caption: "0.5 күн",
    Icon: Clock3,
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-100",
    chipDark: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
    button: "from-amber-400 to-amber-700 shadow-amber-900/20",
    cellBg: "bg-amber-100",
    cellBgDark: "bg-amber-500/25",
    accent: "#f59e0b",
  },
  business_trip: {
    label: "Командировка",
    caption: "Іссапар",
    Icon: Plane,
    dot: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    chipDark: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/30",
    button: "from-indigo-500 to-indigo-700 shadow-indigo-900/20",
    cellBg: "bg-indigo-100",
    cellBgDark: "bg-indigo-500/25",
    accent: "#6366f1",
  },
  absent: {
    label: "Жұмыста жоқ",
    caption: "Келмеді",
    Icon: CircleMinus,
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 ring-rose-100",
    chipDark: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
    button: "from-rose-500 to-rose-700 shadow-rose-900/20",
    cellBg: "bg-rose-100",
    cellBgDark: "bg-rose-500/25",
    accent: "#f43f5e",
  },
  dayoff: {
    label: "Демалыс",
    caption: "Рұқсат/демалыс",
    Icon: Umbrella,
    dot: "bg-slate-500",
    chip: "bg-slate-100 text-slate-700 ring-slate-200",
    chipDark: "bg-slate-500/20 text-slate-300 ring-slate-400/25",
    button: "from-slate-500 to-slate-700 shadow-slate-900/20",
    cellBg: "bg-slate-200",
    cellBgDark: "bg-slate-500/25",
    accent: "#64748b",
  },
};

const weekDays = ["Дс", "Сс", "Ср", "Бс", "Жм", "Сб", "Жк"];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

// Қазақстан уақыты — тұрақты UTC+5. Атаулы белдеуге (Asia/...) сүйенбейді,
// сондықтан кез келген телефонда (ескі/шектеулі құрылғыда да) дұрыс +5 көрсетеді.
function kzParts(date = new Date()) {
  const k = new Date(date.getTime() + 5 * 3600 * 1000);
  return { h: k.getUTCHours(), m: k.getUTCMinutes(), s: k.getUTCSeconds(), day: k.getUTCDate(), month: k.getUTCMonth() + 1 };
}
const kzPad = (n) => String(n).padStart(2, "0");
function kzClock(date, seconds = true) {
  const p = kzParts(date);
  return seconds ? `${kzPad(p.h)}:${kzPad(p.m)}:${kzPad(p.s)}` : `${kzPad(p.h)}:${kzPad(p.m)}`;
}
function kzDateTime(iso) {
  if (!iso) return "";
  const p = kzParts(new Date(iso));
  return `${kzPad(p.day)}.${kzPad(p.month)} ${kzPad(p.h)}:${kzPad(p.m)}`;
}

function monthLabel(month) {
  const [year, rawMonth] = month.split("-");
  const names = ["Қаңтар", "Ақпан", "Наурыз", "Сәуір", "Мамыр", "Маусым", "Шілде", "Тамыз", "Қыркүйек", "Қазан", "Қараша", "Желтоқсан"];
  return `${names[Number(rawMonth) - 1]} ${year}`;
}

function daysInMonth(month) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).getUTCDate();
}

function weekdayOffset(month) {
  const [year, rawMonth] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, rawMonth - 1, 1)).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function addMonths(month, diff) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth - 1 + diff, 1)).toISOString().slice(0, 7);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 180) || "Сервер JSON қайтармады. Vercel API баптауын тексеріңіз.");
  }
  if (!response.ok) throw new Error(result.error || "API қатесі");
  return result;
}

function emptyState() {
  return {
    employees: [],
    archivedEmployees: [],
    unmarkedEmployees: [],
    roles: [],
    attendance: {},
    todayControl: { present: 0, half: 0, absent: 0, dayoff: 0, unmarked: 0, total: 0 },
    month: "2026-05",
    today: "2026-05-03",
    sheetSync: null,
  };
}

function getTelegram() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : null;
}

function haptic(type = "light") {
  const tg = getTelegram();
  if (!tg?.HapticFeedback) return;
  try {
    if (["light", "medium", "heavy", "rigid", "soft"].includes(type)) {
      tg.HapticFeedback.impactOccurred(type);
    } else if (["success", "warning", "error"].includes(type)) {
      tg.HapticFeedback.notificationOccurred(type);
    } else if (type === "selection") {
      tg.HapticFeedback.selectionChanged();
    }
  } catch {}
}

function App() {
  const [state, setState] = useState(emptyState);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [month, setMonth] = useState("2026-05");
  const [query, setQuery] = useState("");
  const [syncState, setSyncState] = useState("ready");
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newSchedule, setNewSchedule] = useState("standard");
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [addError, setAddError] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const [pendingStatus, setPendingStatus] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [isMonitor, setIsMonitor] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminRoleLabel, setAdminRoleLabel] = useState("");
  const [qrEmployee, setQrEmployee] = useState(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [manualCheckoutOpen, setManualCheckoutOpen] = useState(false);
  const [setTimesOpen, setSetTimesOpen] = useState(false);
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");
  const [accessState, setAccessState] = useState("checking");
  const [workerData, setWorkerData] = useState(null);
  const [tgUserId, setTgUserId] = useState("");
  const [tgPhotoUrl, setTgPhotoUrl] = useState("");
  const [tgFirstName, setTgFirstName] = useState("");

  const employeeListRef = useRef(null);
  const swipeStartRef = useRef(null);
  const toastTimers = useRef(new Map());

  useEffect(() => {
    const tg = getTelegram();
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      setTheme(tg.colorScheme === "dark" ? "dark" : "light");
      const handleTheme = () => setTheme(tg.colorScheme === "dark" ? "dark" : "light");
      tg.onEvent("themeChanged", handleTheme);
      return () => tg.offEvent("themeChanged", handleTheme);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const tg = getTelegram();
        if (tg) {
          try { tg.ready(); } catch {}
        }
        // initData кейде бірден келмейді — 10 рет retry (~1 сек)
        // initDataUnsafe + raw initData екеуінен де табуға тырысамыз
        let userId = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          // 1) initDataUnsafe.user.id (нормальная жол)
          userId = tg?.initDataUnsafe?.user?.id ? String(tg.initDataUnsafe.user.id) : "";
          if (userId) break;
          // 2) raw initData parse (Telegram Desktop fallback)
          if (tg?.initData) {
            try {
              const params = new URLSearchParams(tg.initData);
              const userJson = params.get("user");
              if (userJson) {
                const user = JSON.parse(userJson);
                if (user?.id) {
                  userId = String(user.id);
                  break;
                }
              }
            } catch {}
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        setTgUserId(userId);
        const userInfo = tg?.initDataUnsafe?.user || (() => {
          if (!tg?.initData) return null;
          try {
            const params = new URLSearchParams(tg.initData);
            const userJson = params.get("user");
            return userJson ? JSON.parse(userJson) : null;
          } catch { return null; }
        })();
        setTgPhotoUrl(userInfo?.photo_url || "");
        setTgFirstName(userInfo?.first_name || "");
        if (!userId) {
          // initData дайын болмады — Telegram-нан тыс ашылған шығар
          setAccessState("no-telegram");
          setLoading(false);
          return;
        }
        const me = await api(`/api/me?full=1&userId=${encodeURIComponent(userId)}`);
        if (me.isAdmin) {
          setIsMonitor(me.role === "monitor");
          setAdminName(me.name || "");
          setAdminRoleLabel(me.roleLabel || "");
          setAccessState("admin");
          loadState();
        } else if (me.employee) {
          setAccessState("worker");
          setWorkerData(me);
          setLoading(false);
        } else {
          setAccessState("unregistered");
          setLoading(false);
        }
      } catch (err) {
        console.error("access check failed", err);
        setAccessState("error");
        setLoading(false);
      }
    })();
  }, []);

  async function refreshWorker() {
    try {
      const me = await api(`/api/me?full=1&userId=${encodeURIComponent(tgUserId)}`);
      if (me.employee) setWorkerData(me);
    } catch {}
  }

  useEffect(() => {
    if (!selectedId && state.employees.length) setSelectedId(state.employees[0].id);
  }, [selectedId, state.employees]);

  function showToast(type, text) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    const timer = window.setTimeout(() => dismissToast(id), 3200);
    toastTimers.current.set(id, timer);
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }

  async function loadState() {
    try {
      setLoading(true);
      const next = await api("/api/state");
      setState(next);
      setMonth(next.month || "2026-05");
      setSelectedDay(Number((next.today || "2026-05-01").slice(-2)));
      if (!selectedId && next.employees?.length) setSelectedId(next.employees[0].id);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setLoading(false);
    }
  }

  const employees = state.employees || [];
  const selected = employees.find((employee) => employee.id === selectedId) || employees[0];
  const filteredEmployees = employees.filter((employee) =>
    employee.name.toLowerCase().includes(query.toLowerCase()) && (!roleFilter || employee.role === roleFilter),
  );
  const selectedDate = `${month}-${String(selectedDay).padStart(2, "0")}`;
  const isFutureDate = selectedDate > (state.today || selectedDate);
  const selectedMarks = useMemo(() => {
    const marks = {};
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const status = state.attendance?.[date]?.[selected?.id]?.status;
      if (status) marks[day] = status;
    }
    return marks;
  }, [month, selected?.id, state.attendance]);

  useEffect(() => {
    const list = employeeListRef.current;
    if (!list || !selected?.id) return;
    const active = list.querySelector(`[data-employee-id="${CSS.escape(selected.id)}"]`);
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selected?.id, filteredEmployees.length]);

  async function addEmployee() {
    if (!newName.trim() || savingEmployee) return;
    haptic("medium");
    setAddError("");
    try {
      setSavingEmployee(true);
      const name = newName.trim();
      const next = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({ name, role: newRole.trim() || "Қызметкер", schedule: newSchedule }),
      });
      setState(next);
      const created = next.employees.find((employee) => employee.name === name);
      if (created) setSelectedId(created.id);
      setNewName("");
      setNewRole("");
      setNewSchedule("standard");
      setAddOpen(false);
      haptic("success");
      showToast("success", `${name} базаға сақталды және Google Sheets жаңарды.`);
    } catch (err) {
      const message = `Сақталмады: ${err.message}`;
      setAddError(message);
      haptic("error");
      showToast("error", message);
    } finally {
      setSavingEmployee(false);
    }
  }

  async function sendBroadcast(text, photo) {
    if (!text.trim() && !photo) return { sent: 0, failed: 0 };
    const result = await api("/api/state", {
      method: "POST",
      body: JSON.stringify({ action: "broadcast", text: text.trim(), photo: photo || "" }),
    });
    return result;
  }

  async function archiveSelected() {
    if (!selected) return;
    haptic("medium");
    try {
      const next = await api(`/api/employees/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      setState(next);
      setSelectedId(next.employees[0]?.id || null);
      haptic("success");
      showToast("success", `${selected.name} архивке жіберілді.`);
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    }
  }

  const [pdfSending, setPdfSending] = useState(false);
  async function downloadMonthlyPdf() {
    if (pdfSending) return;
    haptic("light");
    // Telegram чатқа файл ретінде жіберу — Mini App браузері файлды жүктемейді,
    // ал бот арқылы келген PDF-ті нативті түрде ашып/сақтауға болады.
    if (tgUserId) {
      setPdfSending(true);
      try {
        await api(`/api/me?report=monthly&format=pdf&send=${encodeURIComponent(tgUserId)}&month=${month}`);
        haptic("success");
        showToast("success", "📄 PDF Telegram чатыңызға жіберілді");
      } catch (err) {
        haptic("error");
        showToast("error", err.message || "PDF жіберілмеді");
      } finally {
        setPdfSending(false);
      }
      return;
    }
    const url = `${window.location.origin}/api/me?report=monthly&format=pdf&month=${month}`;
    const tg = getTelegram();
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  }

  async function markBusinessTrip() {
    if (!selected || !tripStart) return;
    const endDate = tripEnd || tripStart;
    haptic("medium");
    try {
      const next = await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "range", employeeId: selected.id, status: "business_trip", startDate: tripStart, endDate }),
      });
      setState(next);
      haptic("success");
      showToast("success", tripStart === endDate
        ? `${selected.name}: командировка белгіленді (${tripStart}).`
        : `${selected.name}: командировка белгіленді (${tripStart} … ${endDate}).`);
      setTripStart("");
      setTripEnd("");
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    }
  }

  async function saveSalary(employeeId, value) {
    haptic("medium");
    try {
      const next = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: "PATCH",
        body: JSON.stringify({ monthlySalary: value }),
      });
      setState(next);
      haptic("success");
      showToast("success", "Айлық жалақы сақталды.");
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    }
  }

  async function restoreEmployee(employeeId) {
    haptic("medium");
    try {
      const next = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
      setState(next);
      setSelectedId(employeeId);
      setArchiveOpen(false);
      haptic("success");
      showToast("success", "Қызметкер қайта қосылды.");
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    }
  }

  async function setStatus(status) {
    if (!selected || pendingStatus) return;
    if (isFutureDate) {
      haptic("error");
      showToast("error", "Алдын ала белгі қою мүмкін емес. Тек бүгінгі немесе өткен күнге белгі қойылады.");
      return;
    }
    haptic("light");
    try {
      setPendingStatus(true);
      const next = await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ date: selectedDate, employeeId: selected.id, status }),
      });
      setState(next);
      haptic("success");
      showToast("success", `${selected.name}: ${statusMeta[status].label} сақталды.`);
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    } finally {
      setPendingStatus(false);
    }
  }

  async function manualCheckout(time) {
    if (!selected || pendingStatus) return;
    haptic("medium");
    try {
      setPendingStatus(true);
      const next = await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "checkout",
          date: selectedDate,
          employeeId: selected.id,
          checkOutTime: time,
        }),
      });
      setState(next);
      haptic("success");
      showToast("success", `${selected.name}: шығу ${time} белгіленді`);
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    } finally {
      setPendingStatus(false);
    }
  }

  async function setTimes(checkInTime, checkOutTime) {
    if (!selected) return;
    const next = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        action: "set-times",
        date: selectedDate,
        employeeId: selected.id,
        checkInTime,
        checkOutTime,
      }),
    });
    setState(next);
    haptic("success");
    showToast("success", `${selected.name}: уақыт түзетілді (${checkInTime}${checkOutTime ? `–${checkOutTime}` : ""})`);
  }

  async function markAllPresent() {
    if (isFutureDate) {
      haptic("error");
      showToast("error", "Алдын ала белгі қою мүмкін емес. Тек бүгінгі немесе өткен күнге белгі қойылады.");
      return;
    }
    haptic("medium");
    try {
      const next = await api("/api/bulk-attendance", {
        method: "POST",
        body: JSON.stringify({ date: selectedDate, status: "present", role: roleFilter }),
      });
      setState(next);
      haptic("success");
      showToast("success", "Таңдалған қызметкерлердің бәрі жұмыста деп белгіленді.");
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
    }
  }

  async function syncSheets() {
    haptic("medium");
    setSyncState("syncing");
    try {
      const next = await api("/api/sync", { method: "POST", body: "{}" });
      setState(next);
      setSyncState("done");
      haptic("success");
      showToast("success", "Google Sheets толық жаңартылды.");
      setTimeout(() => setSyncState("ready"), 2400);
    } catch (err) {
      haptic("error");
      showToast("error", err.message);
      setSyncState("ready");
    }
  }

  function goNextEmployee() {
    haptic("selection");
    changeEmployee(1);
  }

  function selectTodayEmployee(employeeId) {
    haptic("selection");
    if (state.today) {
      setMonth(state.today.slice(0, 7));
      setSelectedDay(Number(state.today.slice(-2)));
    }
    setSelectedId(employeeId);
  }

  function changeEmployee(direction) {
    const list = filteredEmployees.length ? filteredEmployees : employees;
    if (!list.length) return;
    const index = Math.max(0, list.findIndex((employee) => employee.id === selected?.id));
    const nextIndex = (index + direction + list.length) % list.length;
    setSelectedId(list[nextIndex].id);
  }

  function handleSwipeStart(event) {
    swipeStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  }

  function handleSwipeEnd(event) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    haptic("selection");
    changeEmployee(dx < 0 ? 1 : -1);
  }

  const isDark = theme === "dark";
  const todayDay = state.today?.startsWith(month) ? Number(state.today.slice(-2)) : null;

  if (accessState === "checking") {
    return (
      <main className={cx("flex min-h-screen items-center justify-center", isDark ? "bg-[#04060d] text-white" : "bg-[#f5f7fb] text-[#07122b]")}>
        <Clock3 className="size-8 animate-spin opacity-50" />
      </main>
    );
  }

  if (accessState === "no-telegram") {
    const tg = getTelegram();
    const debugInfo = {
      hasTg: Boolean(tg),
      hasInitData: Boolean(tg?.initData),
      initDataLength: tg?.initData?.length || 0,
      hasUnsafeUser: Boolean(tg?.initDataUnsafe?.user),
      version: tg?.version || "?",
      platform: tg?.platform || "?",
    };
    return (
      <main className={cx("flex min-h-screen items-center justify-center px-6", isDark ? "bg-[#04060d] text-white" : "bg-[#f5f7fb] text-[#07122b]")}>
        <div className={cx("w-full max-w-sm rounded-3xl px-6 py-8 shadow-xl", isDark ? "bg-[#0a1126]" : "bg-white")}>
          <div className="mb-4 text-center text-5xl">📱</div>
          <h1 className="text-center text-xl font-black">Telegram арқылы ашыңыз</h1>
          <p className={cx("mt-3 text-center text-sm font-bold leading-relaxed", isDark ? "text-slate-300" : "text-[#5b6680]")}>
            Mini App-ты <b>Telegram мобильді қолданбасында</b> ашыңыз (Desktop кейде дұрыс жұмыс істемейді).
          </p>
          <details className={cx("mt-4 rounded-xl px-3 py-2 text-[10px] font-mono", isDark ? "bg-white/5 text-slate-400" : "bg-[#f4f7fc] text-[#7a86a0]")}>
            <summary className="cursor-pointer font-bold">Debug</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(debugInfo, null, 2)}</pre>
          </details>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => window.location.reload()}
            className="mt-4 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-3 text-sm font-black text-white"
          >
            🔄 Қайта тексеру
          </motion.button>
        </div>
      </main>
    );
  }

  if (accessState === "error") {
    return (
      <main className={cx("flex min-h-screen items-center justify-center px-6", isDark ? "bg-[#04060d] text-white" : "bg-[#f5f7fb] text-[#07122b]")}>
        <div className={cx("w-full max-w-sm rounded-3xl px-6 py-10 text-center shadow-xl", isDark ? "bg-[#0a1126]" : "bg-white")}>
          <div className="mb-4 text-5xl">⚠️</div>
          <h1 className="text-xl font-black">Уақытша қате</h1>
          <p className={cx("mt-3 text-sm font-bold leading-relaxed", isDark ? "text-slate-300" : "text-[#5b6680]")}>
            Сервер жауап бермеді. 1-2 минуттан кейін Mini App-ты қайта ашыңыз.
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-3 text-sm font-black text-white"
          >
            🔄 Қайта жүктеу
          </motion.button>
        </div>
      </main>
    );
  }

  if (accessState === "unregistered") {
    return (
      <RegistrationScreen
        isDark={isDark}
        userId={tgUserId}
        onSent={() => setAccessState("pending")}
      />
    );
  }

  if (accessState === "pending") {
    return (
      <main className={cx("flex min-h-screen items-center justify-center px-6", isDark ? "bg-[#04060d] text-white" : "bg-[#f5f7fb] text-[#07122b]")}>
        <div className={cx("w-full max-w-sm rounded-3xl px-6 py-10 text-center shadow-xl", isDark ? "bg-[#0a1126]" : "bg-white")}>
          <div className="mb-4 text-5xl">⏳</div>
          <h1 className="text-xl font-black">Сұраныс жіберілді</h1>
          <p className={cx("mt-3 text-sm font-bold leading-relaxed", isDark ? "text-slate-300" : "text-[#5b6680]")}>
            Әкімші растағаннан кейін Telegram-ға хабарлама келеді.
            <br /><br />
            Содан соң Mini App-ты <b>қайтадан ашыңыз</b>.
          </p>
        </div>
      </main>
    );
  }

  if (accessState === "worker" && workerData) {
    return (
      <WorkerApp
        isDark={isDark}
        theme={theme}
        setTheme={setTheme}
        data={workerData}
        userId={tgUserId}
        photoUrl={tgPhotoUrl}
        onRefresh={refreshWorker}
      />
    );
  }

  return (
    <main className={cx("min-h-screen", isDark ? "bg-[#04060d] text-white" : "bg-[#07101f] text-[#07122b]")}>
      <section className={cx("app-shell mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden shadow-2xl md:my-5 md:min-h-[860px] md:rounded-[34px]", isDark ? "bg-[#0a1126]" : "bg-[#f5f7fb]")}>
        <header className="relative overflow-hidden px-5 pb-5 pt-5 text-white">
          <div className={cx("absolute inset-0", isDark
            ? "bg-[linear-gradient(145deg,#020616_0%,#0a1640_48%,#020616_100%)]"
            : "bg-[linear-gradient(145deg,#07133a_0%,#102a77_48%,#07101f_100%)]")} />
          <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(135deg,rgba(255,255,255,.22)_1px,transparent_1px),linear-gradient(45deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:22px_22px]" />

          <div className="relative flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Avatar photoUrl={tgPhotoUrl} name={adminName || tgFirstName || "Әкімші"} size={42} />
              <div className="flex min-w-0 flex-col">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                  {adminRoleLabel || (isMonitor ? "Бақылаушы" : "Әкімші")}
                </span>
                <span className="line-clamp-2 break-words text-sm font-black leading-tight text-white">
                  {adminName || tgFirstName || "Әкімші"}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { haptic("light"); setNotificationsOpen(true); }}
                className="glass-icon relative text-white"
                aria-label="Хабарламалар"
              >
                <Bell className="size-5" />
                {(state.recentHistory?.length || 0) > 0 && (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white/30" />
                )}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { haptic("light"); setStatsOpen(true); }}
                className="glass-icon text-white"
                aria-label="Айлық статистика"
              >
                <BarChart3 className="size-5" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { haptic("light"); setTheme(theme === "dark" ? "light" : "dark"); }}
                className="glass-icon text-white"
                aria-label="Тема"
              >
                <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.3 }}>
                  {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </motion.span>
              </motion.button>
            </div>
          </div>

          <div className="relative mt-5 rounded-[26px] bg-white p-4 shadow-[0_22px_60px_rgba(0,0,0,0.26)]">
            <img className="mx-auto h-auto w-full max-w-[300px] object-contain" src="/brand/sert-logo.jpg" alt="Sert өндірістік компаниясы" />
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-2">
            <Metric icon={UsersRound} label="Қызметкер" value={employees.length} />
            <Metric icon={CalendarCheck2} label="Белгі қойылды" value={`${state.todayControl?.total - state.todayControl?.unmarked || 0}/${state.todayControl?.total || 0}`} />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => { haptic("light"); setBroadcastOpen(true); }}
              className="rounded-[20px] border border-white/18 bg-white/12 p-3 text-left backdrop-blur transition active:bg-white/20"
              aria-label="Хабарландыру жіберу"
            >
              <Megaphone className="size-4 text-white/76" />
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/52">Хабарлама</p>
              <p className="text-lg font-black">Жіберу</p>
            </motion.button>
          </div>

          {!isMonitor && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={downloadMonthlyPdf}
              disabled={pdfSending}
              className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-[18px] border border-white/18 bg-white/12 px-4 py-3 text-sm font-black text-white backdrop-blur transition active:bg-white/20 disabled:opacity-50"
              aria-label="Айлық жалақы PDF"
            >
              <FileDown className={cx("size-4", pdfSending && "animate-pulse")} />
              {pdfSending ? "Жіберілуде..." : "Айлық жалақы PDF"}
            </motion.button>
          )}
        </header>

        <section className="grid flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_auto_1fr_auto] gap-4 px-4 py-4">
          <div className="premium-search">
            <Search className={cx("size-4", isDark ? "text-slate-400" : "text-[#7a86a0]")} />
            <input
              className={cx("min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none", isDark ? "text-white placeholder:text-slate-500" : "placeholder:text-[#9aa6bc]")}
              placeholder="Қызметкер іздеу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <motion.button whileTap={{ scale: 0.92 }} onClick={() => { haptic("light"); setAddError(""); setAddOpen(true); }} className="primary-round" aria-label="Қызметкер қосу">
              <Plus className="size-5" />
            </motion.button>
          </div>

          <section className={cx("control-panel", isDark && "control-panel-dark")}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={cx("eyebrow", isDark && "eyebrow-dark")}>Бүгінгі бақылау</p>
                <p className={cx("text-lg font-black", isDark ? "text-white" : "text-[#07122b]")}>{state.today}</p>
              </div>
              <motion.button whileTap={{ scale: 0.96 }} onClick={markAllPresent} disabled={isFutureDate} className="control-action disabled:opacity-50">
                Барлығын жұмыста
              </motion.button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(statusMeta).filter(([key]) => key !== "business_trip").map(([key, meta]) => (
                <StatusPill key={key} isDark={isDark} meta={meta} value={state.todayControl?.[key] || 0} />
              ))}
            </div>
            <div className={cx("mt-2 rounded-2xl px-3 py-3 ring-1", isDark ? "bg-white/5 text-slate-200 ring-white/10" : "bg-[#eef3ff] text-[#0b1b5f] ring-[#dce6ff]")}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-[0.14em]">Белгі қойылмаған</span>
                <motion.span key={state.todayControl?.unmarked || 0} initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="text-lg font-black">
                  {state.todayControl?.unmarked || 0}
                </motion.span>
              </div>
              {!!state.unmarkedEmployees?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {state.unmarkedEmployees.map((employee) => (
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      key={employee.id}
                      type="button"
                      onClick={() => selectTodayEmployee(employee.id)}
                      className={cx("rounded-full px-2.5 py-1 text-left text-xs font-black shadow-sm ring-1 transition", isDark ? "bg-white/10 text-white ring-white/15" : "bg-white text-[#0b1b5f] ring-[#d5e0fb]")}
                    >
                      {employee.name}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto">
            <FilterChip isDark={isDark} active={!roleFilter} onClick={() => { haptic("selection"); setRoleFilter(""); }}>Барлығы</FilterChip>
            {(state.roles || []).map((role) => (
              <FilterChip isDark={isDark} key={role} active={roleFilter === role} onClick={() => { haptic("selection"); setRoleFilter(role); }}>
                {role}
              </FilterChip>
            ))}
            {!!state.archivedEmployees?.length && (
              <FilterChip isDark={isDark} onClick={() => { haptic("light"); setArchiveOpen(true); }}>
                Архив
              </FilterChip>
            )}
          </div>

          <LayoutGroup id="employee-tabs">
            <div ref={employeeListRef} className="no-scrollbar flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth">
              {filteredEmployees.map((employee) => {
                const active = employee.id === selected?.id;
                const markedCount = Object.values(employee.counts || {}).reduce((sum, value) => sum + value, 0);
                return (
                  <motion.button
                    key={employee.id}
                    layout
                    whileTap={{ scale: 0.95 }}
                    data-employee-id={employee.id}
                    onClick={() => { haptic("selection"); setSelectedId(employee.id); }}
                    className={cx("employee-tab snap-center", active && "employee-tab-active", isDark && "employee-tab-dark", isDark && active && "employee-tab-active-dark")}
                  >
                    {active && (
                      <motion.span
                        layoutId="employee-active-bg"
                        className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-[#102a77] to-[#07133a]"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative block text-sm font-black">{employee.name}</span>
                    <span className={cx("relative mt-1 block text-xs font-bold", active ? "text-white/65" : isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                      {employee.role || "Қызметкер"} · {markedCount} белгі
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>

          <section className={cx("main-card touch-pan-y select-none", isDark && "main-card-dark")} onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
            {loading ? (
              <SkeletonCard isDark={isDark} />
            ) : !selected ? (
              <div className="py-20 text-center">
                <div className={cx("mx-auto grid size-16 place-items-center rounded-3xl", isDark ? "bg-white/10 text-white" : "bg-[#eef3ff] text-[#0b1b5f]")}>
                  <UsersRound className="size-8" />
                </div>
                <p className={cx("mt-4 text-xl font-black", isDark ? "text-white" : "text-[#07122b]")}>Қызметкер жоқ</p>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => { haptic("light"); setAddError(""); setAddOpen(true); }} className="mt-4 rounded-2xl bg-[#0b1b5f] px-5 py-3 text-sm font-black text-white">
                  Бірінші қызметкерді қосу
                </motion.button>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={cx("eyebrow", isDark && "eyebrow-dark")}>{selected.role || "Қызметкер"}</p>
                      <h2 className={cx("mt-1 text-2xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{selected.name}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <motion.button whileTap={{ scale: 0.92 }} onClick={() => { haptic("light"); setQrEmployee(selected); }} className={cx("soft-icon", isDark && "soft-icon-dark")} aria-label="QR көрсету">
                        <QrCode className="size-5" />
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.92 }} onClick={archiveSelected} className={cx("soft-icon", isDark && "soft-icon-dark")} aria-label="Архивке жіберу">
                        <Archive className="size-5" />
                      </motion.button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-5 gap-1.5">
                    {Object.entries(statusMeta).map(([key, meta]) => (
                      <SmallStat key={key} isDark={isDark} meta={meta} value={selected.counts?.[key] || 0} />
                    ))}
                  </div>

                  {!isMonitor && (
                    <SalaryEditor
                      isDark={isDark}
                      key={`salary-${selected.id}`}
                      value={selected.monthlySalary || 0}
                      onSave={(amount) => saveSalary(selected.id, amount)}
                    />
                  )}

                  <div className={cx("mt-4 flex items-center justify-between rounded-[22px] px-3 py-2", isDark ? "bg-white/5" : "bg-[#f1f5fb]")}>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic("selection"); setMonth(addMonths(month, -1)); }} className={cx("nav-round", isDark && "nav-round-dark")} aria-label="Алдыңғы ай">
                      <ChevronLeft className="size-5" />
                    </motion.button>
                    <div className="text-center">
                      <p className={cx("text-base font-black", isDark ? "text-white" : "text-[#07122b]")}>{monthLabel(month)}</p>
                      <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7d88a0]")}>Қатысу календарі</p>
                    </div>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic("selection"); setMonth(addMonths(month, 1)); }} className={cx("nav-round", isDark && "nav-round-dark")} aria-label="Келесі ай">
                      <ChevronRight className="size-5" />
                    </motion.button>
                  </div>

                  <div className="mt-4 grid grid-cols-7 gap-1.5">
                    {weekDays.map((day) => (
                      <div key={day} className={cx("grid h-7 place-items-center text-[11px] font-black", isDark ? "text-slate-500" : "text-[#9aa6bc]")}>{day}</div>
                    ))}
                    {Array.from({ length: weekdayOffset(month) }).map((_, index) => <div key={`empty-${index}`} className="aspect-square" />)}
                    {Array.from({ length: daysInMonth(month) }).map((_, index) => {
                      const day = index + 1;
                      const status = selectedMarks[day];
                      const meta = status ? statusMeta[status] : null;
                      const active = day === selectedDay;
                      const isToday = day === todayDay;
                      return (
                        <motion.button
                          key={day}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => { haptic("selection"); setSelectedDay(day); }}
                          className={cx(
                            "calendar-day relative",
                            isDark && "calendar-day-dark",
                            meta && (isDark ? meta.cellBgDark : meta.cellBg),
                            meta && "calendar-marked",
                            active && "calendar-active",
                            isDark && active && "calendar-active-dark",
                            isToday && "calendar-today",
                          )}
                        >
                          <span className="relative z-10">{day}</span>
                          {meta && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: "spring", stiffness: 460, damping: 28 }}
                              className={cx("absolute bottom-1.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full shadow-sm", meta.dot)}
                            />
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </section>

          <section className={cx("action-dock", isDark && "action-dock-dark")}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className={cx("eyebrow", isDark && "eyebrow-dark")}>Таңдалған күн</p>
                <p className={cx("text-lg font-black", isDark ? "text-white" : "text-[#07122b]")}>{selectedDate}</p>
              </div>
              <div className={cx("grid size-11 place-items-center rounded-2xl", isDark ? "bg-white/10 text-white" : "bg-[#eef3ff] text-[#0b1b5f]")}>
                <CalendarDays className="size-5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(statusMeta).filter(([key]) => key !== "business_trip").map(([key, meta]) => (
                <StatusButton
                  key={key}
                  meta={meta}
                  isCurrent={selectedMarks[selectedDay] === key}
                  pending={pendingStatus}
                  onClick={() => setStatus(key)}
                  disabled={!selected || isFutureDate || pendingStatus}
                />
              ))}
            </div>
            <div className={cx("mt-3 rounded-[18px] p-3 ring-1", isDark ? "bg-indigo-500/10 ring-indigo-400/25" : "bg-indigo-50 ring-indigo-100")}>
              <p className={cx("flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider", isDark ? "text-indigo-300" : "text-indigo-700")}>
                <Plane className="size-3.5" /> Командировка (аралық)
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" value={tripStart} onChange={(e) => setTripStart(e.target.value)} aria-label="Бастау күні"
                  className={cx("min-w-0 rounded-[12px] px-2.5 py-2 text-sm font-bold outline-none ring-1", isDark ? "bg-[#0a1126] text-white ring-white/10" : "bg-white text-[#07122b] ring-[#e3e9f3]")} />
                <input type="date" value={tripEnd} onChange={(e) => setTripEnd(e.target.value)} aria-label="Аяқтау күні (бос болса — 1 күн)"
                  className={cx("min-w-0 rounded-[12px] px-2.5 py-2 text-sm font-bold outline-none ring-1", isDark ? "bg-[#0a1126] text-white ring-white/10" : "bg-white text-[#07122b] ring-[#e3e9f3]")} />
              </div>
              <p className={cx("mt-1.5 text-[10px] font-bold", isDark ? "text-indigo-300/70" : "text-indigo-500")}>Аяқтау күнін бос қалдырсаңыз — тек 1 күн белгіленеді.</p>
              <motion.button whileTap={{ scale: 0.97 }} onClick={markBusinessTrip} disabled={!selected || !tripStart}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-[14px] bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">
                <Plane className="size-4" /> Командировка деп белгілеу
              </motion.button>
            </div>
            {isFutureDate && (
              <div className={cx("mt-3 rounded-[18px] px-4 py-3 text-sm font-black ring-1", isDark ? "bg-amber-500/10 text-amber-300 ring-amber-400/20" : "bg-amber-50 text-amber-800 ring-amber-100")}>
                Алдын ала белгі қою мүмкін емес. Бұл күн әлі келген жоқ.
              </div>
            )}
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <motion.button whileTap={{ scale: 0.97 }} onClick={goNextEmployee} className="next-button">Келесі қызметкер</motion.button>
              <motion.button whileTap={{ scale: 0.92 }} onClick={syncSheets} className={cx("sheet-button", isDark && "sheet-button-dark")} aria-label="Google Sheets жаңарту">
                {syncState === "syncing" ? <Clock3 className="size-5 animate-spin" /> : syncState === "done" ? <Check className="size-5" /> : <FileSpreadsheet className="size-5" />}
              </motion.button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => { haptic("light"); setManualCheckoutOpen(true); }}
                disabled={pendingStatus}
                className={cx("flex items-center justify-center gap-1.5 rounded-[20px] px-3 py-3 text-sm font-black ring-1 disabled:opacity-50", isDark ? "bg-white/5 text-emerald-300 ring-emerald-400/30" : "bg-emerald-50 text-emerald-700 ring-emerald-200")}
              >
                🚪 Қолмен шығу
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => { haptic("light"); setSetTimesOpen(true); }}
                disabled={pendingStatus || isFutureDate}
                className={cx("flex items-center justify-center gap-1.5 rounded-[20px] px-3 py-3 text-sm font-black ring-1 disabled:opacity-50", isDark ? "bg-white/5 text-indigo-300 ring-indigo-400/30" : "bg-indigo-50 text-indigo-700 ring-indigo-200")}
              >
                🕐 Уақытты түзету
              </motion.button>
            </div>
          </section>
        </section>
      </section>

      <Toaster toasts={toasts} dismiss={dismissToast} />

      <AnimatePresence>
        {addOpen && (
          <Modal isDark={isDark} title="Қызметкер қосу" onClose={() => setAddOpen(false)}>
            {addError && <div className="mb-3"><InlineError text={addError} /></div>}
            <label className="mb-3 block">
              <span className={cx("form-label", isDark && "form-label-dark")}>Аты-жөні</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} className={cx("form-input", isDark && "form-input-dark")} placeholder="Мысалы: Айбек Нұрлан" />
            </label>
            <label className="mb-3 block">
              <span className={cx("form-label", isDark && "form-label-dark")}>Рөлі / бригадасы</span>
              <input value={newRole} onChange={(event) => setNewRole(event.target.value)} className={cx("form-input", isDark && "form-input-dark")} placeholder="Мысалы: Оператор, Қойма, Цех 1" />
            </label>
            <motion.button whileTap={{ scale: 0.97 }} onClick={addEmployee} disabled={!newName.trim() || savingEmployee} className="mt-4 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50">
              {savingEmployee ? "Сақталып жатыр..." : "Қосу және сақтау"}
            </motion.button>
          </Modal>
        )}

        {manualCheckoutOpen && selected && (
          <Modal isDark={isDark} title={`🚪 ${selected.name} — шығу`} onClose={() => setManualCheckoutOpen(false)}>
            <ManualCheckoutForm
              isDark={isDark}
              employeeName={selected.name}
              date={selectedDate}
              onSubmit={async (time) => {
                await manualCheckout(time);
                setManualCheckoutOpen(false);
              }}
            />
          </Modal>
        )}

        {setTimesOpen && selected && (
          <Modal isDark={isDark} title={`🕐 ${selected.name} — уақытты түзету`} onClose={() => setSetTimesOpen(false)}>
            <SetTimesForm
              isDark={isDark}
              employeeName={selected.name}
              date={selectedDate}
              onSubmit={async (checkInTime, checkOutTime) => {
                await setTimes(checkInTime, checkOutTime);
                setSetTimesOpen(false);
              }}
            />
          </Modal>
        )}

        {broadcastOpen && (
          <Modal isDark={isDark} title="📢 Жалпы хабарландыру" onClose={() => setBroadcastOpen(false)}>
            <BroadcastModal
              isDark={isDark}
              onSend={async (text, photo) => {
                const result = await sendBroadcast(text, photo);
                showToast("success", `${result.sent || 0} қызметкерге жіберілді${result.failed ? `, ${result.failed} жіберілмеді` : ""}`);
                setBroadcastOpen(false);
              }}
              onError={(message) => showToast("error", message)}
            />
          </Modal>
        )}

        {notificationsOpen && (
          <Modal isDark={isDark} title="🔔 Хабарламалар" onClose={() => setNotificationsOpen(false)}>
            <NotificationsList isDark={isDark} history={state.recentHistory || []} />
          </Modal>
        )}

        {archiveOpen && (
          <Modal isDark={isDark} title="Архив" onClose={() => setArchiveOpen(false)}>
            <div className="space-y-2">
              {state.archivedEmployees?.length ? state.archivedEmployees.map((employee) => (
                <div key={employee.id} className={cx("flex items-center justify-between rounded-[20px] px-4 py-3", isDark ? "bg-white/5" : "bg-[#f4f7fc]")}>
                  <div>
                    <p className={cx("font-black", isDark ? "text-white" : "text-[#07122b]")}>{employee.name}</p>
                    <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>{employee.role}</p>
                  </div>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => restoreEmployee(employee.id)} className={cx("grid size-10 place-items-center rounded-full text-[#0b1b5f] shadow-sm", isDark ? "bg-white/10 text-white" : "bg-white")}>
                    <RotateCcw className="size-4" />
                  </motion.button>
                </div>
              )) : <p className={cx("py-5 text-center text-sm font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Архив бос</p>}
            </div>
          </Modal>
        )}

        {statsOpen && (
          <Modal isDark={isDark} title="Айлық статистика" onClose={() => setStatsOpen(false)}>
            <StatsView isDark={isDark} state={state} month={month} onRefresh={loadState} isMonitor={isMonitor} />
          </Modal>
        )}

        {qrEmployee && (
          <Modal isDark={isDark} title="QR — белгі қою" onClose={() => setQrEmployee(null)}>
            <QrView
              isDark={isDark}
              employee={qrEmployee}
              botUsername={state.botUsername || ""}
              onCopy={(text) => {
                navigator.clipboard?.writeText(text).then(() => {
                  haptic("success");
                  showToast("success", "Сілтеме көшірілді");
                }).catch(() => showToast("error", "Көшіру мүмкін болмады"));
              }}
              onScan={async () => {
                const tg = getTelegram();
                if (!tg?.showScanQrPopup) {
                  haptic("error");
                  showToast("error", "Telegram-ның жаңа нұсқасы керек.");
                  return;
                }
                haptic("light");
                tg.showScanQrPopup({ text: "Жұмысшының QR кодын сканерлеңіз" }, (raw) => {
                  try {
                    const text = String(raw || "");
                    const match = text.match(/start=in_([^\s&]+)/i);
                    const employeeId = match ? decodeURIComponent(match[1]) : "";
                    if (!employeeId) {
                      haptic("error");
                      showToast("error", "QR танылмады");
                      return false;
                    }
                    const today = new Date().toISOString().slice(0, 10);
                    api("/api/attendance", {
                      method: "POST",
                      body: JSON.stringify({ date: today, employeeId, status: "present" }),
                    }).then((next) => {
                      setState(next);
                      haptic("success");
                      const emp = (next.employees || []).find((e) => e.id === employeeId);
                      showToast("success", `${emp?.name || "Қызметкер"}: жұмыста деп белгіленді.`);
                    }).catch((err) => {
                      haptic("error");
                      showToast("error", err.message);
                    });
                    return true;
                  } catch {
                    return true;
                  }
                });
              }}
            />
          </Modal>
        )}
      </AnimatePresence>
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[20px] border border-white/18 bg-white/12 p-3 backdrop-blur">
      <Icon className="size-4 text-white/76" />
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/52">{label}</p>
      <motion.p key={String(value)} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-lg font-black">
        {value}
      </motion.p>
    </div>
  );
}

function Toaster({ toasts, dismiss }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const success = toast.type === "success";
          return (
            <motion.div
              key={toast.id}
              initial={{ y: 60, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              onClick={() => dismiss(toast.id)}
              className={cx(
                "pointer-events-auto flex max-w-[400px] items-start gap-2 rounded-[20px] px-4 py-3 text-sm font-black shadow-2xl ring-1 backdrop-blur",
                success
                  ? "bg-emerald-50/95 text-emerald-800 ring-emerald-100"
                  : "bg-rose-50/95 text-rose-800 ring-rose-100",
              )}
            >
              {success ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <span>{toast.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function InlineError({ text }) {
  return (
    <div className="flex items-start gap-2 rounded-[20px] bg-rose-50 px-4 py-3 text-sm font-black text-rose-800 ring-1 ring-rose-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function StatusPill({ isDark, meta, value }) {
  const Icon = meta.Icon;
  return (
    <div className={cx("flex items-center gap-2 rounded-2xl px-3 py-2.5 ring-1", isDark ? meta.chipDark : meta.chip)}>
      <Icon className="size-4 shrink-0" />
      <p className="truncate text-xs font-black">{meta.label}</p>
      <motion.span key={value} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="ml-auto text-lg font-black">
        {value}
      </motion.span>
    </div>
  );
}

function SmallStat({ isDark, meta, value }) {
  const Icon = meta.Icon;
  return (
    <div className={cx("rounded-2xl p-2 text-center ring-1", isDark ? meta.chipDark : meta.chip)}>
      <Icon className="mx-auto size-4" />
      <motion.p key={value} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 text-base font-black">
        {value}
      </motion.p>
    </div>
  );
}

function SalaryEditor({ isDark, value, onSave }) {
  const [raw, setRaw] = useState(String(value || ""));
  const [saving, setSaving] = useState(false);
  const dirty = (Number(raw.replace(/\s/g, "")) || 0) !== (value || 0);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(Number(raw.replace(/\s/g, "")) || 0);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cx("mt-4 rounded-[20px] p-3", isDark ? "bg-white/5" : "bg-[#f1f5fb]")}>
      <p className={cx("mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
        <Wallet className="size-3.5" /> Бекітілген айлық жалақы
      </p>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="0"
          className={cx(
            "min-w-0 flex-1 rounded-[14px] px-3 py-2.5 text-base font-black outline-none ring-1",
            isDark ? "bg-[#0a1126] text-white ring-white/10" : "bg-white text-[#07122b] ring-[#e3e9f3]",
          )}
        />
        <span className={cx("text-sm font-black", isDark ? "text-slate-400" : "text-[#7a86a0]")}>₸</span>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-[14px] bg-[#0b1b5f] px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
        >
          {saving ? "..." : "Сақтау"}
        </motion.button>
      </div>
    </div>
  );
}

function StatusButton({ meta, onClick, disabled, isCurrent, pending }) {
  const Icon = meta.Icon;
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      animate={isCurrent ? { boxShadow: `0 0 0 3px ${meta.accent}55, 0 16px 30px rgba(0,0,0,0.18)` } : { boxShadow: "0 16px 30px rgba(0,0,0,0.10)" }}
      disabled={disabled}
      onClick={onClick}
      className={cx("relative overflow-hidden rounded-[20px] bg-gradient-to-br px-3 py-4 text-left text-white disabled:opacity-40", meta.button)}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-5" />
        <span className="text-sm font-black">{meta.label}</span>
        {isCurrent && <Check className="ml-auto size-4 opacity-90" />}
      </div>
      <p className="mt-1 text-xs font-bold text-white/70">{meta.caption}</p>
      {pending && (
        <motion.span
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
        />
      )}
    </motion.button>
  );
}

function FilterChip({ isDark, active, children, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-full px-4 py-2 text-xs font-black ring-1 transition-colors",
        active
          ? "bg-[#0b1b5f] text-white ring-[#0b1b5f]"
          : isDark
            ? "bg-white/8 text-slate-200 ring-white/10"
            : "bg-white text-[#526176] ring-[#dfe6f2]",
      )}
    >
      {children}
    </motion.button>
  );
}

function Avatar({ photoUrl, name, size = 48 }) {
  const initials = String(name || "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
  const colorIndex = Math.abs([...String(name || "")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 5;
  const gradients = [
    "from-amber-400 to-pink-500",
    "from-emerald-400 to-cyan-500",
    "from-violet-500 to-fuchsia-500",
    "from-sky-400 to-indigo-500",
    "from-rose-400 to-orange-500",
  ];
  const sizeStyle = { width: size, height: size };
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={initials}
        style={sizeStyle}
        className="shrink-0 rounded-full object-cover ring-2 ring-white/20"
      />
    );
  }
  return (
    <div
      style={sizeStyle}
      className={cx(
        "shrink-0 rounded-full bg-gradient-to-br grid place-items-center font-black text-white ring-2 ring-white/20",
        gradients[colorIndex],
      )}
    >
      <span style={{ fontSize: Math.round(size * 0.38) }}>{initials}</span>
    </div>
  );
}

function Modal({ isDark, title, children, onClose, center = false }) {
  // center=true — ортада «вспливающий» (масштабпен) шығады; әйтпесе астыңғы парақ.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cx("fixed inset-0 z-50 grid bg-[#061133]/55 p-4 backdrop-blur-sm", center ? "place-items-center" : "place-items-end")}
      onClick={onClose}
    >
      <motion.div
        initial={center ? { opacity: 0, scale: 0.9 } : { y: 60, opacity: 0, scale: 0.96 }}
        animate={center ? { opacity: 1, scale: 1 } : { y: 0, opacity: 1, scale: 1 }}
        exit={center ? { opacity: 0, scale: 0.9 } : { y: 80, opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
        className={cx("w-full max-w-[430px] rounded-[30px] p-5 shadow-2xl", isDark ? "bg-[#0e1530] text-white" : "bg-white")}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className={cx("text-xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{title}</h3>
          <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className={cx("grid size-10 place-items-center rounded-full", isDark ? "bg-white/10 text-slate-300" : "bg-[#f4f7fc] text-[#64748b]")} aria-label="Жабу">
            <X className="size-5" />
          </motion.button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function SkeletonCard({ isDark }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className={cx("h-3 w-20 rounded-full animate-pulse", isDark ? "bg-white/10" : "bg-slate-200")} />
          <div className={cx("h-5 w-40 rounded-full animate-pulse", isDark ? "bg-white/15" : "bg-slate-300")} />
        </div>
        <div className={cx("size-11 rounded-2xl animate-pulse", isDark ? "bg-white/10" : "bg-slate-200")} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cx("h-16 rounded-2xl animate-pulse", isDark ? "bg-white/10" : "bg-slate-200")} />
        ))}
      </div>
      <div className={cx("h-12 rounded-[22px] animate-pulse", isDark ? "bg-white/10" : "bg-slate-200")} />
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className={cx("aspect-square rounded-[16px] animate-pulse", isDark ? "bg-white/8" : "bg-slate-200/70")} style={{ animationDelay: `${i * 12}ms` }} />
        ))}
      </div>
    </div>
  );
}

function QrView({ isDark, employee, botUsername, onCopy, onScan }) {
  const link = botUsername
    ? `https://t.me/${botUsername}?start=in_${employee.id}`
    : "";
  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>{employee.role || "Қызметкер"}</p>
        <p className={cx("mt-1 text-xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{employee.name}</p>
      </div>
      {link ? (
        <button
          type="button"
          onClick={onScan}
          className="flex w-full justify-center"
          aria-label="Камерамен сканерлеу"
        >
          <div className="rounded-3xl bg-white p-4 shadow-[0_18px_40px_rgba(11,27,95,0.18)] transition active:scale-95">
            <QRCodeSVG value={link} size={220} bgColor="#ffffff" fgColor="#07122b" level="M" includeMargin={false} />
          </div>
        </button>
      ) : (
        <div className={cx("rounded-2xl px-4 py-6 text-center text-sm font-bold", isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-800")}>
          Бот username алынбады. TELEGRAM_BOT_TOKEN баптауын тексеріңіз.
        </div>
      )}
      {link && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onScan}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#0b1b5f] px-4 py-3 text-sm font-black text-white"
        >
          📷 Камерамен сканерлеу
        </motion.button>
      )}
      {link && (
        <div className={cx("rounded-2xl px-3 py-3", isDark ? "bg-white/5" : "bg-[#f4f7fc]")}>
          <p className={cx("mb-1 text-[10px] font-black uppercase tracking-wider", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Сілтеме</p>
          <p className={cx("break-all font-mono text-[11px] font-bold", isDark ? "text-slate-200" : "text-[#07122b]")}>{link}</p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onCopy(link)}
            className={cx("mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-3 text-sm font-black", isDark ? "bg-white/10 text-white" : "bg-[#e3eaff] text-[#0b1b5f]")}
          >
            <Copy className="size-4" />
            Сілтемені көшіру
          </motion.button>
        </div>
      )}
      <div className={cx("rounded-2xl px-4 py-3 text-xs font-bold leading-relaxed", isDark ? "bg-white/5 text-slate-300" : "bg-[#eef3ff] text-[#0b1b5f]")}>
        QR-ды басып шығарып жұмыс орнына жабыстырыңыз. Қызметкер өз телефонымен сканерлеп, ботта «Мен келдім» басады.
        <br /><br />
        Немесе QR-ды басып, осы Mini App ішінде басқа қызметкердің QR-ын камерамен сканерлей аласыз.
      </div>
    </div>
  );
}

function formatTenge(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat("ru-RU").format(n).replace(/,/g, " ") + " ₸";
}

function StatsView({ isDark, state, month, onRefresh, isMonitor = false }) {
  const employees = state.employees || [];
  const days = daysInMonth(month);
  const todayDay = state.today?.startsWith(month) ? Number(state.today.slice(-2)) : null;
  const advancesByMonth = state.advancesByMonth || {};
  const monthAdvances = advancesByMonth[month] || {};
  const [advanceFor, setAdvanceFor] = useState(null);
  const [advFormOpen, setAdvFormOpen] = useState(false);

  const { trend, totals } = useMemo(() => {
    const trendArr = [];
    for (let day = 1; day <= days; day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const records = state.attendance?.[date] || {};
      let present = 0;
      let half = 0;
      for (const emp of employees) {
        const status = records[emp.id]?.status;
        if (status === "present") present += 1;
        else if (status === "half") half += 0.5;
      }
      trendArr.push({ day, value: present + half });
    }
    const totalsArr = employees.map((emp) => {
      let present = 0;
      let half = 0;
      for (let day = 1; day <= days; day += 1) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const status = state.attendance?.[date]?.[emp.id]?.status;
        if (status === "present") present += 1;
        else if (status === "half") half += 1;
      }
      return { employee: emp, present, half, days: present + half * 0.5 };
    }).sort((a, b) => b.days - a.days || a.employee.name.localeCompare(b.employee.name));
    return { trend: trendArr, totals: totalsArr };
  }, [employees, state.attendance, month, days]);

  const max = Math.max(1, ...trend.map((p) => p.value));
  const topDays = totals[0]?.days || 0;

  function formatDays(value) {
    return value % 1 === 0 ? String(value) : value.toFixed(1);
  }

  return (
    <div className="space-y-4">
      <div className={cx("rounded-[18px] px-3 py-2.5 ring-1", isDark ? "bg-white/5 ring-white/10" : "bg-white ring-[#e3e9f3]")}>
        <div className="mb-1.5 flex items-center justify-between">
          <p className={cx("text-[10px] font-black uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
            {monthLabel(month)}
          </p>
          {todayDay && (
            <span className={cx("text-[10px] font-bold", isDark ? "text-cyan-300" : "text-[#0b1b5f]")}>
              бүгін: {todayDay}-күн
            </span>
          )}
        </div>
        <div className="flex h-14 items-end gap-[2px]">
          {trend.map((p) => {
            const isToday = p.day === todayDay;
            const ratio = p.value / max;
            return (
              <motion.div
                key={p.day}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(ratio * 100, p.value ? 8 : 3)}%` }}
                transition={{ delay: p.day * 0.008, duration: 0.4 }}
                title={`${p.day}-күн: ${p.value}`}
                className={cx(
                  "flex-1 rounded-t-[3px]",
                  isToday
                    ? "bg-gradient-to-t from-[#0b1b5f] to-[#22d3ee]"
                    : p.value
                      ? "bg-gradient-to-t from-[#1e3a8a] to-[#60a5fa]"
                      : isDark ? "bg-white/8" : "bg-[#eaeff7]",
                )}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className={cx("eyebrow", isDark && "eyebrow-dark")}>Барлық қызметкер</p>
          <div className="flex items-center gap-2">
            <span className={cx("text-[11px] font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>{totals.length} адам</span>
            {!isMonitor && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => { haptic("light"); setAdvFormOpen(true); }}
                className={cx("rounded-full px-3 py-1 text-[11px] font-black ring-1 transition", isDark ? "bg-amber-500/15 text-amber-300 ring-amber-400/30" : "bg-amber-50 text-amber-700 ring-amber-200")}
              >
                + Аванс жазу
              </motion.button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          {totals.length === 0 && (
            <p className={cx("rounded-2xl px-4 py-6 text-center text-sm font-bold", isDark ? "bg-white/5 text-slate-400" : "bg-[#f4f7fc] text-[#7a86a0]")}>
              Әзірге дерек жоқ
            </p>
          )}
          {totals.map((row, index) => {
            const ratio = topDays > 0 ? row.days / topDays : 0;
            return (
              <motion.div
                key={row.employee.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.025 }}
                className={cx(
                  "relative overflow-hidden rounded-[18px] px-3 py-2.5 ring-1",
                  isDark ? "bg-white/5 ring-white/10" : "bg-white ring-[#eaeff7]",
                )}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${ratio * 100}%` }}
                  transition={{ delay: 0.1 + index * 0.025, duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
                  className={cx(
                    "absolute inset-y-0 left-0",
                    isDark ? "bg-gradient-to-r from-[#1e3a8a]/40 to-transparent" : "bg-gradient-to-r from-[#dbe5ff] to-transparent",
                  )}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={cx(
                      "grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-black",
                      index === 0
                        ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-[0_4px_12px_rgba(245,158,11,0.35)]"
                        : index === 1
                          ? "bg-gradient-to-br from-slate-300 to-slate-500 text-white"
                          : index === 2
                            ? "bg-gradient-to-br from-orange-300 to-orange-600 text-white"
                            : isDark
                              ? "bg-white/10 text-slate-300"
                              : "bg-[#eef3ff] text-[#0b1b5f]",
                    )}>
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={cx("truncate text-sm font-black", isDark ? "text-white" : "text-[#07122b]")}>{row.employee.name}</p>
                      </div>
                      <p className={cx("truncate text-[11px] font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                        {row.employee.role || "Қызметкер"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isMonitor && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAdvanceFor(row.employee); }}
                        className={cx(
                          "grid size-8 place-items-center rounded-full text-base transition active:scale-90",
                          monthAdvances[row.employee.id]?.total
                            ? (isDark ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200")
                            : (isDark ? "bg-white/5 text-slate-500" : "bg-[#f4f7fc] text-[#94a3b8]"),
                        )}
                        aria-label="Аванс"
                      >
                        💰
                      </button>
                    )}
                    <div className="flex flex-col items-end leading-none">
                      <span className={cx("text-xl font-black", isDark ? "text-white" : "text-[#07122b]")}>
                        {formatDays(row.days)}
                      </span>
                      <span className={cx("mt-0.5 text-[10px] font-bold uppercase tracking-wider", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                        күн
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
      <AnimatePresence>
        {advanceFor && (
          <Modal isDark={isDark} title={`💰 ${advanceFor.name} — аванс`} onClose={() => setAdvanceFor(null)}>
            <AdvanceDetail isDark={isDark} employee={advanceFor} month={month} data={monthAdvances[advanceFor.id]} />
          </Modal>
        )}
        {advFormOpen && (
          <Modal isDark={isDark} title="💰 Аванс жазу" onClose={() => setAdvFormOpen(false)}>
            <AdvanceFormModal
              isDark={isDark}
              employees={employees}
              today={state.today || new Date().toISOString().slice(0, 10)}
              onClose={() => setAdvFormOpen(false)}
              onSuccess={() => { setAdvFormOpen(false); onRefresh?.(); }}
            />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function RegistrationScreen({ isDark, userId, onSent }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || sending) return;
    if (!userId) {
      setError("Telegram аутентификациясы жоқ. Mini App-ты қайта ашыңыз.");
      return;
    }
    haptic("medium");
    setSending(true);
    setError("");
    try {
      const tg = getTelegram();
      const username = tg?.initDataUnsafe?.user?.username || "";
      const firstName = tg?.initDataUnsafe?.user?.first_name || "";
      await api("/api/state", {
        method: "POST",
        body: JSON.stringify({
          action: "register-request",
          telegramId: userId,
          name: name.trim(),
          role: role.trim() || "Қызметкер",
          username,
          firstName,
        }),
      });
      haptic("success");
      onSent();
    } catch (err) {
      haptic("error");
      setError(err.message || "Жіберілмеді");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={cx("flex min-h-screen items-center justify-center px-6 py-10", isDark ? "bg-[#04060d] text-white" : "bg-[#f5f7fb] text-[#07122b]")}>
      <div className={cx("w-full max-w-sm rounded-3xl px-6 py-8 shadow-xl", isDark ? "bg-[#0a1126]" : "bg-white")}>
        <div className="mb-4 text-center text-5xl">📝</div>
        <h1 className="text-center text-xl font-black">Тіркеуге сұраныс</h1>
        <p className={cx("mt-2 text-center text-xs font-bold leading-relaxed", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
          Деректеріңізді енгізіп, әкімшіге сұраныс жіберіңіз
        </p>

        {error && <div className="mt-4"><InlineError text={error} /></div>}

        <label className="mt-5 block">
          <span className={cx("form-label", isDark && "form-label-dark")}>Аты-жөні</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Мысалы: Айбек Нұрлан"
            className={cx("form-input", isDark && "form-input-dark")}
          />
        </label>

        <label className="mt-3 block">
          <span className={cx("form-label", isDark && "form-label-dark")}>Рөлі / бригадасы</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Мысалы: Оператор"
            className={cx("form-input", isDark && "form-input-dark")}
          />
        </label>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={submit}
          disabled={sending || !name.trim()}
          className="mt-5 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50"
        >
          {sending ? "Жіберілуде..." : "📤 Сұраныс жіберу"}
        </motion.button>
      </div>
    </main>
  );
}

function WorkerApp({ isDark, theme, setTheme, data, userId, photoUrl, onRefresh }) {
  const employee = data.employee;
  const todayRow = data.todayRow;
  const counts = data.counts || { present: 0, half: 0, absent: 0, dayoff: 0 };
  const hours = data.hours || { totalDays: 0, totalHours: 0 };
  const salary = data.salary || { monthlySalary: 0, workedEquivalentDays: 0, totalHours: 0, advanceTotal: 0, earned: 0, net: 0 };
  const advanceTotal = data.advanceTotal || 0;
  const broadcasts = data.broadcasts || [];
  const month = data.month || "";

  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function downloadMyPdf() {
    if (pdfBusy) return;
    haptic("light");
    setPdfBusy(true);
    // Серверден келген нақты ID-ді қолданамыз (қызметкер танылған дәл сол ID).
    const myId = data.userId || data.employee?.telegramId || userId;
    try {
      await api(`/api/me?report=my&format=pdf&userId=${encodeURIComponent(myId)}&send=${encodeURIComponent(myId)}&month=${month}`);
      haptic("success");
      setMessage({ type: "success", text: "📄 Жалақы PDF Telegram чатыңызға жіберілді" });
      setMessageOpen(true);
    } catch (err) {
      haptic("error");
      setMessage({ type: "error", text: err.message || "PDF жіберілмеді" });
      setMessageOpen(true);
    } finally {
      setPdfBusy(false);
    }
  }

  const minutesUntilEnd = useMemo(() => {
    const { h, m } = kzParts(now);
    const total = (h || 0) * 60 + (m || 0);
    return Math.max(0, 18 * 60 - total);
  }, [now]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const checkInTime = todayRow?.checkInTime || "";
  const checkOutTime = todayRow?.checkOutTime || "";
  const stage = checkOutTime ? "done" : checkInTime ? "checked-in" : "idle";
  // Әкімші белгілеген статус (КІРУ-сіз) — жұмысшыға баннер ретінде көрсетіледі.
  const adminStatusLabel = (!checkInTime && !checkOutTime && ["Командировка", "Демалыс", "Жоқ", "Ауырып қалды"].includes(todayRow?.label || "")) ? todayRow.label : "";
  const adminStatusInfo = {
    "Командировка": { Icon: Plane, cls: isDark ? "bg-indigo-500/15 text-indigo-300" : "bg-indigo-100 text-indigo-600", note: "Сіз командировкадасыз. КІРУ қажет емес — бұл күн толық есептеледі." },
    "Демалыс": { Icon: Umbrella, cls: isDark ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-600", note: "Бүгін демалыс. КІРУ қажет емес." },
    "Жоқ": { Icon: CircleMinus, cls: isDark ? "bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-600", note: "Бүгін «жұмыста жоқ» деп белгіленген." },
    "Ауырып қалды": { Icon: AlertTriangle, cls: isDark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-600", note: "«Ауырып қалды» деп белгіленген." },
  }[adminStatusLabel];

  async function performAction(action) {
    if (busy) return;
    haptic("medium");
    setBusy(true);
    setMessage(null);
    setActionError(null);

    try {
      const coords = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          const e = new Error("Браузер геолокацияны қолдамайды");
          e.geoCode = -1;
          reject(e);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          (err) => {
            const e = new Error(err.message || "Геолокация алынбады");
            e.geoCode = err.code;
            reject(e);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
      });

      const result = await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action,
          telegramId: userId,
          lat: coords.lat,
          lon: coords.lon,
        }),
      });

      haptic("success");
      setMessage({ type: "success", text: result.message || "Сәтті" });
      setMessageOpen(true);
      await onRefresh();
    } catch (err) {
      haptic("error");
      let title = "❌ Қате";
      let body = err.message || "Қате болды";
      let hint = "";

      if (err.geoCode === 1) {
        title = "🔒 Геолокация рұқсаты жабық";
        body = "Mini App-қа орналасуыңызды қолдану үшін рұқсат беріңіз.";
        hint = "Telegram → Settings → Privacy → Location";
      } else if (err.geoCode === 2) {
        title = "📡 GPS табылмады";
        body = "GPS қосулы екенін тексеріңіз. Ашық жерге шығып қайталаңыз.";
      } else if (err.geoCode === 3) {
        title = "⏱️ Уақыт бітті";
        body = "GPS жүктелмеді. Қайталап басыңыз.";
      } else if (err.geoCode === -1) {
        title = "🚫 Геолокация қолжетімсіз";
        body = err.message;
        hint = "Қондырғы параметрлерінде Telegram-ға орналасу рұқсатын беріңіз.";
      } else if (body.includes("Жұмыс орнында емессіз")) {
        title = "📍 Жұмыс орнында емессіз";
        body = err.message;
        hint = "Жұмыс орнына жақын барып қайтадан басыңыз.";
      } else if (body.includes("тіркелмеген")) {
        title = "🔒 Тіркелмегенсіз";
      } else if (body.includes("Бүгін кіру")) {
        title = "ℹ️ Хабарлама";
      }

      setActionError({ title, body, hint });
    } finally {
      setBusy(false);
    }
  }

  const monthDays = useMemo(() => {
    const map = {};
    const labelToStatus = { "Жұмыста": "present", "Жарты күн": "half", "Командировка": "business_trip", "Жоқ": "absent", "Демалыс": "dayoff" };
    for (const row of data.ownAttendance || []) {
      map[row.date.slice(-2)] = labelToStatus[row.label] || "";
    }
    return map;
  }, [data.ownAttendance]);

  const daysInMonth = useMemo(() => {
    if (!month) return 31;
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }, [month]);

  return (
    <main className={cx("min-h-screen", isDark ? "bg-[#04060d]" : "bg-[#07101f]")}>
      <section className={cx("app-shell mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden shadow-2xl md:my-5 md:min-h-[860px] md:rounded-[34px]", isDark ? "bg-[#0a1126]" : "bg-[#f5f7fb]")}>
        <header
          className="relative overflow-hidden px-5 pb-4 pt-4 text-white"
          style={{
            background: "linear-gradient(135deg, #0b1b5f 0%, #0d2070 50%, #06104a 100%)",
          }}
        >
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar photoUrl={photoUrl} name={employee.name} size={48} />
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Жұмысшы кабинеті</span>
                <span className="text-lg font-black text-white">{employee.name}</span>
                <span className="text-xs font-bold text-white/70">{employee.role || "Қызметкер"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { haptic("light"); setNotifOpen(true); }}
                className="glass-icon relative text-white"
                aria-label="Хабарламалар"
              >
                <Bell className="size-5" />
                {broadcasts.length > 0 && (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white/30" />
                )}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { haptic("light"); setTheme(theme === "dark" ? "light" : "dark"); }}
                className="glass-icon text-white"
                aria-label="Тема"
              >
                {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </motion.button>
            </div>
          </div>

          <div className="relative mt-3 flex items-center justify-between rounded-[18px] bg-white/12 px-4 py-2 backdrop-blur">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Уақыт</p>
              <p className="text-lg font-black tabular-nums text-white">
                {kzClock(now)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Күні</p>
              <p className="text-sm font-black text-white">{data.today}</p>
            </div>
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          <div className={cx("rounded-[26px] p-5 text-center shadow-xl", isDark ? "bg-white/5" : "bg-white")}>
            {adminStatusLabel && adminStatusInfo && (
              <>
                <div className={cx("mx-auto grid size-16 place-items-center rounded-full", adminStatusInfo.cls)}>
                  <adminStatusInfo.Icon className="size-8" />
                </div>
                <p className={cx("mt-3 text-lg font-black", isDark ? "text-white" : "text-[#07122b]")}>Бүгін: {adminStatusLabel}</p>
                <p className={cx("mt-1.5 text-xs font-bold leading-relaxed", isDark ? "text-slate-400" : "text-[#7a86a0]")}>{adminStatusInfo.note}</p>
              </>
            )}
            {!adminStatusLabel && stage === "idle" && actionError && (
              <ActionErrorPanel isDark={isDark} error={actionError} onRetry={() => setActionError(null)} />
            )}
            {!adminStatusLabel && stage === "idle" && !actionError && (
              <>
                <p className={cx("text-xs font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                  Бүгін кіру белгісі әлі жоқ
                </p>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => performAction("worker-checkin")}
                  disabled={busy}
                  className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-[24px] bg-gradient-to-br from-[#0b1b5f] to-[#1d3bbe] px-6 py-7 text-xl font-black text-white shadow-[0_22px_60px_rgba(11,27,95,0.45)] disabled:opacity-50"
                >
                  {busy ? <Clock3 className="size-6 animate-spin" /> : <MapPin className="size-6" />}
                  {busy ? "Тексерілуде..." : "КІРУ"}
                </motion.button>
                <p className={cx("mt-3 text-[11px] font-bold", isDark ? "text-slate-500" : "text-[#94a3b8]")}>
                  Батырманы жұмыс орнында ғана басыңыз
                </p>
              </>
            )}
            {stage === "checked-in" && (
              <>
                <p className={cx("text-xs font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                  Кіру белгіленді: <b>{checkInTime}</b>
                </p>
                {todayRow?.lateMinutes > 0 && (
                  <p className="mt-1 text-xs font-bold text-amber-500">⚠️ {todayRow.lateMinutes} минут кешіктіру</p>
                )}
                {actionError ? (
                  <ActionErrorPanel isDark={isDark} error={actionError} onRetry={() => setActionError(null)} />
                ) : !confirmCheckoutOpen ? (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => { haptic("light"); setConfirmCheckoutOpen(true); }}
                    disabled={busy}
                    className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-[24px] bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 py-7 text-xl font-black text-white shadow-[0_22px_60px_rgba(5,150,105,0.45)] disabled:opacity-50"
                  >
                    {busy ? <Clock3 className="size-6 animate-spin" /> : <LogOut className="size-6" />}
                    {busy ? "Сақталуда..." : "ШЫҒУ"}
                  </motion.button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 space-y-3"
                  >
                    {minutesUntilEnd > 0 ? (
                      <div className={cx("rounded-[16px] border-2 px-3 py-3 text-left", isDark ? "border-amber-500/30 bg-amber-500/10" : "border-amber-300 bg-amber-50")}>
                        <p className={cx("text-sm font-black", isDark ? "text-amber-300" : "text-amber-900")}>
                          ⚠️ Жұмыс уақыты әлі бітпеді
                        </p>
                        <p className={cx("mt-1 text-xs font-bold", isDark ? "text-amber-200/80" : "text-amber-800")}>
                          18:00-ге дейін <b>{minutesUntilEnd} минут</b> қалды.
                        </p>
                      </div>
                    ) : (
                      <p className={cx("text-sm font-bold", isDark ? "text-slate-300" : "text-[#5b6680]")}>
                        Жұмыс уақыты аяқталды.
                      </p>
                    )}
                    <p className={cx("text-sm font-bold", isDark ? "text-slate-300" : "text-[#5b6680]")}>
                      Шынымен шығасыз ба?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { haptic("light"); setConfirmCheckoutOpen(false); }}
                        disabled={busy}
                        className={cx("rounded-[18px] px-4 py-4 text-sm font-black", isDark ? "bg-white/10 text-white" : "bg-[#f4f7fc] text-[#07122b]")}
                      >
                        ❌ Болдырмау
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={async () => {
                          setConfirmCheckoutOpen(false);
                          await performAction("worker-checkout");
                        }}
                        disabled={busy}
                        className="rounded-[18px] bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-4 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busy ? "⏳..." : "✅ Иә, шығу"}
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </>
            )}
            {stage === "done" && (
              <>
                <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                  <Check className="size-9" strokeWidth={2.6} />
                </div>
                <p className={cx("mt-3 text-base font-black", isDark ? "text-white" : "text-[#07122b]")}>Бүгінгі жұмыс аяқталды</p>
                <p className={cx("mt-2 text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                  Кіру: <b>{checkInTime}</b>  •  Шығу: <b>{checkOutTime}</b>
                </p>
                {todayRow?.earlyMinutes > 0 && (
                  <p className="mt-1 text-xs font-bold text-amber-500">⚠️ {todayRow.earlyMinutes} минут ерте кету</p>
                )}
              </>
            )}
          </div>

          <div className="mt-5">
            <p className={cx("mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
              <BarChart3 className="size-3.5" /> Осы ай ({month})
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className={cx("rounded-[18px] p-3 text-center", isDark ? "bg-white/5" : "bg-white shadow")}>
                <p className={cx("text-2xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{counts.present}</p>
                <p className={cx("text-[10px] font-bold uppercase", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Толық</p>
              </div>
              <div className={cx("rounded-[18px] p-3 text-center", isDark ? "bg-white/5" : "bg-white shadow")}>
                <p className={cx("text-2xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{counts.half}</p>
                <p className={cx("text-[10px] font-bold uppercase", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Жарты</p>
              </div>
              <div className={cx("rounded-[18px] p-3 text-center", isDark ? "bg-white/5" : "bg-white shadow")}>
                <p className={cx("text-2xl font-black", isDark ? "text-white" : "text-[#07122b]")}>{hours.totalHours}</p>
                <p className={cx("text-[10px] font-bold uppercase", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Сағат</p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <p className={cx("mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
              <span className="grid size-4 place-items-center rounded-full bg-amber-500/20 text-[10px] font-black leading-none text-amber-500">₸</span> Менің авансым
            </p>
            <div className={cx("rounded-[18px] p-4", isDark ? "bg-white/5" : "bg-white shadow")}>
              <p className={cx("text-2xl font-black", isDark ? "text-white" : "text-[#07122b]")}>
                {advanceTotal.toLocaleString("kk-KZ")} ₸
              </p>
              <p className={cx("text-[11px] font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                {(data.ownAdvances || []).length} жазба
              </p>
            </div>
          </div>

          {salary.monthlySalary > 0 && (
            <div className="mt-5">
              <p className={cx("mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                <Wallet className="size-3.5" /> Менің жалақым ({month})
              </p>
              <div className={cx("rounded-[22px] p-4", isDark ? "bg-white/5" : "bg-white shadow")}>
                <div className="flex items-baseline justify-between">
                  <span className={cx("text-xs font-bold uppercase tracking-wider", isDark ? "text-slate-400" : "text-[#7a86a0]")}>Таза қолға</span>
                  <span className={cx("text-3xl font-black", salary.net < 0 ? "text-red-500" : isDark ? "text-emerald-300" : "text-emerald-600")}>
                    {salary.net.toLocaleString("kk-KZ")} ₸
                  </span>
                </div>
                <div className={cx("mt-3 space-y-1.5 border-t pt-3 text-[13px] font-bold", isDark ? "border-white/10" : "border-[#eef2f8]")}>
                  <div className="flex items-center justify-between">
                    <span className={cx(isDark ? "text-slate-400" : "text-[#7a86a0]")}>Бекітілген айлық</span>
                    <span className={cx(isDark ? "text-white" : "text-[#07122b]")}>{salary.monthlySalary.toLocaleString("kk-KZ")} ₸</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cx(isDark ? "text-slate-400" : "text-[#7a86a0]")}>
                      Істелгені ({salary.workedEquivalentDays} күн · {salary.totalHours} сағ)
                    </span>
                    <span className={cx(isDark ? "text-white" : "text-[#07122b]")}>{(salary.earned || 0).toLocaleString("kk-KZ")} ₸</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cx(isDark ? "text-slate-400" : "text-[#7a86a0]")}>Аванс</span>
                    <span className="text-amber-500">− {(salary.advanceTotal || 0).toLocaleString("kk-KZ")} ₸</span>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={downloadMyPdf}
                  disabled={pdfBusy}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#0b1b5f] px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  <FileDown className={cx("size-4", pdfBusy && "animate-pulse")} />
                  {pdfBusy ? "Жіберілуде..." : "Жалақы PDF алу"}
                </motion.button>
              </div>
            </div>
          )}

          <div className="mt-5">
            <p className={cx("mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
              <CalendarDays className="size-3.5" /> Менің табелім ({month})
            </p>
            <div className={cx("rounded-[18px] p-3", isDark ? "bg-white/5" : "bg-white shadow")}>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const dayStr = String(day).padStart(2, "0");
                  const status = monthDays[dayStr];
                  const colors = {
                    present: isDark ? "bg-emerald-500/30 text-emerald-300" : "bg-emerald-100 text-emerald-700",
                    half: isDark ? "bg-amber-500/30 text-amber-300" : "bg-amber-100 text-amber-700",
                    business_trip: isDark ? "bg-indigo-500/30 text-indigo-300" : "bg-indigo-100 text-indigo-700",
                    absent: isDark ? "bg-red-500/30 text-red-300" : "bg-red-100 text-red-700",
                    dayoff: isDark ? "bg-blue-500/30 text-blue-300" : "bg-blue-100 text-blue-700",
                  };
                  return (
                    <div
                      key={day}
                      className={cx(
                        "aspect-square rounded-md text-center text-[10px] font-black grid place-items-center",
                        status ? colors[status] : isDark ? "bg-white/5 text-slate-500" : "bg-[#f4f7fc] text-[#94a3b8]",
                      )}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <AnimatePresence>
          {messageOpen && message && (
            <Modal isDark={isDark} title={message.type === "success" ? "✅ Сәтті" : "❌ Қате"} onClose={() => setMessageOpen(false)}>
              <p className={cx("text-base font-bold", isDark ? "text-white" : "text-[#07122b]")}>{message.text}</p>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setMessageOpen(false)}
                className="mt-4 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-3 text-sm font-black text-white"
              >
                Жабу
              </motion.button>
            </Modal>
          )}
          {notifOpen && (
            <Modal isDark={isDark} center title="🔔 Хабарландырулар" onClose={() => setNotifOpen(false)}>
              {broadcasts.length === 0 ? (
                <p className={cx("rounded-[16px] p-4 text-center text-sm font-bold", isDark ? "bg-white/5 text-slate-400" : "bg-[#f4f7fc] text-[#7a86a0]")}>
                  Әлі хабарландыру жоқ.
                </p>
              ) : (
                <div className="space-y-2">
                  {broadcasts.map((b, i) => (
                    <div key={i} className={cx("rounded-[16px] px-3 py-2.5", isDark ? "bg-white/5" : "bg-[#f4f7fc]")}>
                      <p className={cx("text-[10px] font-bold uppercase", isDark ? "text-slate-500" : "text-[#94a3b8]")}>
                        {kzDateTime(b.at)}
                      </p>
                      <p className={cx("mt-1 text-sm font-bold", isDark ? "text-white" : "text-[#07122b]")}>{b.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}

function ActionErrorPanel({ isDark, error, onRetry }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mt-4 space-y-3"
    >
      <div className={cx("rounded-[16px] border-2 px-3 py-3 text-left", isDark ? "border-red-500/40 bg-red-500/10" : "border-red-300 bg-red-50")}>
        <p className={cx("text-sm font-black", isDark ? "text-red-300" : "text-red-900")}>
          {error.title}
        </p>
        <p className={cx("mt-1 text-xs font-bold leading-relaxed", isDark ? "text-red-200/80" : "text-red-800")}>
          {error.body}
        </p>
        {error.hint && (
          <p className={cx("mt-2 text-xs font-bold leading-relaxed", isDark ? "text-amber-300" : "text-amber-800")}>
            💡 {error.hint}
          </p>
        )}
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => { haptic("light"); onRetry(); }}
        className="w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)]"
      >
        🔄 Қайталау
      </motion.button>
    </motion.div>
  );
}

function ManualCheckoutForm({ isDark, employeeName, date, onSubmit }) {
  const defaultTime = useMemo(() => kzClock(new Date(), false), []);
  const [time, setTime] = useState(defaultTime);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!time || saving) return;
    haptic("medium");
    setSaving(true);
    try {
      await onSubmit(time);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
        Қызметкер QR баспай кетіп қалса, шығу уақытын қолмен қойыңыз. Кіру белгісі болуы шарт.
      </p>
      <div className={cx("rounded-[16px] px-3 py-2.5 text-xs font-bold", isDark ? "bg-white/5 text-slate-300" : "bg-[#f4f7fc] text-[#5b6680]")}>
        <p>Қызметкер: <b>{employeeName}</b></p>
        <p>Күні: <b>{date}</b></p>
      </div>
      <label className="block">
        <span className={cx("form-label", isDark && "form-label-dark")}>Шығу уақыты</span>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={cx("form-input", isDark && "form-input-dark")}
        />
      </label>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        disabled={saving || !time}
        className="w-full rounded-[20px] bg-emerald-600 px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(5,150,105,0.24)] disabled:opacity-50"
      >
        {saving ? "Сақталуда..." : "🚪 Шығу қою"}
      </motion.button>
    </div>
  );
}

function SetTimesForm({ isDark, employeeName, date, onSubmit }) {
  const [checkIn, setCheckIn] = useState("09:00");
  const [checkOut, setCheckOut] = useState("18:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (saving) return;
    if (!checkIn) { setError("Кіру уақытын қойыңыз"); return; }
    if (checkOut && checkOut <= checkIn) { setError("Шығу уақыты Кіруден кейін болуы керек"); return; }
    setError("");
    haptic("medium");
    setSaving(true);
    try {
      await onSubmit(checkIn, checkOut);
    } catch (err) {
      setError(err.message || "Сақталмады");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
        Жазба қате болса (мыс. кешіктіру дұрыс емес), нақты Кіру және Шығу уақытын қойыңыз. Кешіктіру/ерте кету автоматты қайта есептеледі.
      </p>
      <div className={cx("rounded-[16px] px-3 py-2.5 text-xs font-bold", isDark ? "bg-white/5 text-slate-300" : "bg-[#f4f7fc] text-[#5b6680]")}>
        <p>Қызметкер: <b>{employeeName}</b></p>
        <p>Күні: <b>{date}</b></p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={cx("form-label", isDark && "form-label-dark")}>Кіру уақыты</span>
          <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={cx("form-input", isDark && "form-input-dark")} />
        </label>
        <label className="block">
          <span className={cx("form-label", isDark && "form-label-dark")}>Шығу уақыты</span>
          <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={cx("form-input", isDark && "form-input-dark")} />
        </label>
      </div>
      <p className={cx("text-[10px] font-bold", isDark ? "text-slate-500" : "text-[#94a3b8]")}>Шығуды бос қалдыруға болады — тек Кіру қойылады.</p>
      {error && <InlineError text={error} />}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        disabled={saving || !checkIn}
        className="w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50"
      >
        {saving ? "Сақталуда..." : "🕐 Уақытты сақтау"}
      </motion.button>
    </div>
  );
}

function compressImage(file, maxSize = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width >= height && width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      else if (height > width && height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Сурет оқылмады")); };
    img.src = url;
  });
}

function BroadcastModal({ isDark, onSend, onError }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  async function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      haptic("light");
      setPhoto(await compressImage(file));
    } catch (err) {
      onError?.(err.message || "Сурет оқылмады");
    }
  }

  async function submit() {
    if ((!text.trim() && !photo) || sending) return;
    haptic("medium");
    setSending(true);
    try {
      await onSend(text, photo);
    } catch (err) {
      haptic("error");
      onError?.(err.message || "Жіберілмеді");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className={cx("text-xs font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>
        Хабарлама (және сурет) барлық тіркелген қызметкерлерге Telegram арқылы жіберіледі.
      </p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="hidden" />
      {photo ? (
        <div className="relative overflow-hidden rounded-[18px]">
          <img src={photo} alt="Тіркелген сурет" className="max-h-56 w-full object-cover" />
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => { haptic("light"); setPhoto(""); }}
            className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/55 text-white"
            aria-label="Суретті алып тастау"
          >
            <X className="size-4" />
          </motion.button>
        </div>
      ) : (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { haptic("light"); fileRef.current?.click(); }}
          className={cx("flex w-full items-center justify-center gap-2 rounded-[18px] border-2 border-dashed px-4 py-4 text-sm font-black", isDark ? "border-white/15 text-slate-300" : "border-[#dbe2ee] text-[#5b6680]")}
        >
          <Camera className="size-5" /> Сурет/камера қосу
        </motion.button>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={photo ? "Сурет астына жазу (міндетті емес)..." : "Хабарлама мәтіні..."}
        rows={photo ? 3 : 5}
        className={cx("form-input resize-none", isDark && "form-input-dark")}
      />
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        disabled={sending || (!text.trim() && !photo)}
        className="w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50"
      >
        {sending ? "Жіберілуде..." : "📤 Жіберу"}
      </motion.button>
    </div>
  );
}

function NotificationsList({ isDark, history }) {
  if (!history.length) {
    return (
      <div className={cx("rounded-[18px] p-4 text-center text-sm font-bold", isDark ? "bg-white/5 text-slate-400" : "bg-[#f4f7fc] text-[#7a86a0]")}>
        Әзірге хабарламалар жоқ.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {history.map((item, idx) => {
        const time = kzDateTime(item.at);
        return (
          <div key={idx} className={cx("rounded-[16px] px-3 py-2.5", isDark ? "bg-white/5" : "bg-[#f4f7fc]")}>
            <div className="flex items-center justify-between gap-2">
              <p className={cx("truncate text-sm font-black", isDark ? "text-white" : "text-[#07122b]")}>
                {item.action || "Оқиға"}
              </p>
              <span className={cx("shrink-0 text-[10px] font-bold", isDark ? "text-slate-500" : "text-[#94a3b8]")}>{time}</span>
            </div>
            <p className={cx("mt-1 text-xs font-bold", isDark ? "text-slate-300" : "text-[#526176]")}>
              {item.name}{item.newLabel ? ` — ${item.newLabel}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function AdvanceFormModal({ isDark, employees, today, onClose, onSuccess }) {
  const [empName, setEmpName] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleEmpChange(e) {
    setEmpName(e.target.value);
    if (!date) setDate(today);
  }

  async function submit() {
    if (!empName || !date || !amount) {
      setError("Аты-жөні, күн және сома міндетті өрістер");
      return;
    }
    haptic("medium");
    setSaving(true);
    setError("");
    try {
      await api("/api/state", {
        method: "POST",
        body: JSON.stringify({ action: "advance", date, employeeName: empName, amount: Number(amount), note }),
      });
      haptic("success");
      onSuccess();
    } catch (err) {
      setError(err.message);
      haptic("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <InlineError text={error} />}
      <label className="block">
        <span className={cx("form-label", isDark && "form-label-dark")}>Аты-жөні</span>
        <select
          value={empName}
          onChange={handleEmpChange}
          className={cx("form-input", isDark && "form-input-dark")}
        >
          <option value="">Қызметкерді таңдаңыз</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.name}>{emp.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={cx("form-label", isDark && "form-label-dark")}>Күні</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className={cx("form-input", isDark && "form-input-dark")}
        />
      </label>
      <label className="block">
        <span className={cx("form-label", isDark && "form-label-dark")}>Сома (₸)</span>
        <input
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Мысалы: 50000"
          min="1"
          className={cx("form-input", isDark && "form-input-dark")}
        />
      </label>
      <label className="block">
        <span className={cx("form-label", isDark && "form-label-dark")}>Ескертпе</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Міндетті емес"
          className={cx("form-input", isDark && "form-input-dark")}
        />
      </label>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        disabled={saving || !empName || !date || !amount}
        className="w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50"
      >
        {saving ? "Жазылып жатыр..." : "Аванс жазу"}
      </motion.button>
    </div>
  );
}

function AdvanceDetail({ isDark, employee, month, data }) {
  const items = (data?.items || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = data?.total || 0;
  return (
    <div className="space-y-3">
      <div className={cx("rounded-2xl px-4 py-3 text-center", isDark ? "bg-amber-500/10" : "bg-amber-50")}>
        <p className={cx("text-[10px] font-black uppercase tracking-wider", isDark ? "text-amber-300/80" : "text-amber-700/80")}>{month} жалпы алынды</p>
        <p className={cx("mt-1 text-2xl font-black", isDark ? "text-amber-300" : "text-amber-700")}>{formatTenge(total)}</p>
      </div>
      {items.length === 0 ? (
        <p className={cx("rounded-2xl px-4 py-6 text-center text-sm font-bold", isDark ? "bg-white/5 text-slate-400" : "bg-[#f4f7fc] text-[#7a86a0]")}>
          Бұл айда аванс берілмеген.
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className={cx("flex items-center justify-between rounded-2xl px-3 py-2.5", isDark ? "bg-white/5" : "bg-[#f4f7fc]")}>
              <div className="min-w-0">
                <p className={cx("text-xs font-black", isDark ? "text-white" : "text-[#07122b]")}>{it.date}</p>
                {it.note && <p className={cx("mt-0.5 truncate text-[11px] font-bold", isDark ? "text-slate-400" : "text-[#7a86a0]")}>{it.note}</p>}
              </div>
              <p className={cx("shrink-0 text-sm font-black", isDark ? "text-amber-300" : "text-amber-700")}>{formatTenge(it.amount)}</p>
            </div>
          ))}
        </div>
      )}
      <p className={cx("rounded-xl px-3 py-2.5 text-[11px] font-bold leading-relaxed", isDark ? "bg-white/5 text-slate-400" : "bg-[#eef3ff] text-[#0b1b5f]/70")}>
        Жаңа аванс жазу үшін статистика бетіндегі «+ Аванс жазу» батырмасын басыңыз.
      </p>
    </div>
  );
}

export default App;
