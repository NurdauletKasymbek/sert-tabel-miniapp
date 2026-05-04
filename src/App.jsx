import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Clock3,
  FileSpreadsheet,
  Layers3,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Umbrella,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const statusMeta = {
  present: {
    label: "Жұмыста",
    caption: "Толық күн",
    Icon: BriefcaseBusiness,
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    button: "from-emerald-500 to-emerald-700 shadow-emerald-900/20",
  },
  half: {
    label: "Жарты күн",
    caption: "0.5 күн",
    Icon: Clock3,
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-100",
    button: "from-amber-400 to-amber-700 shadow-amber-900/20",
  },
  absent: {
    label: "Жұмыста жоқ",
    caption: "Келмеді",
    Icon: CircleMinus,
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 ring-rose-100",
    button: "from-rose-500 to-rose-700 shadow-rose-900/20",
  },
  dayoff: {
    label: "Демалыс",
    caption: "Рұқсат/демалыс",
    Icon: Umbrella,
    dot: "bg-slate-500",
    chip: "bg-slate-100 text-slate-700 ring-slate-200",
    button: "from-slate-500 to-slate-700 shadow-slate-900/20",
  },
};

const weekDays = ["Дс", "Сс", "Ср", "Бс", "Жм", "Сб", "Жк"];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
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

function App() {
  const [state, setState] = useState(emptyState);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [month, setMonth] = useState("2026-05");
  const [query, setQuery] = useState("");
  const [syncState, setSyncState] = useState("ready");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [addError, setAddError] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!selectedId && state.employees.length) setSelectedId(state.employees[0].id);
  }, [selectedId, state.employees]);

  function showNotice(type, text) {
    setNotice({ type, text });
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => setNotice(null), 3600);
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
      showNotice("error", err.message);
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
  const selectedMarks = useMemo(() => {
    const marks = {};
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const status = state.attendance?.[date]?.[selected?.id]?.status;
      if (status) marks[day] = status;
    }
    return marks;
  }, [month, selected?.id, state.attendance]);

  async function addEmployee() {
    if (!newName.trim() || savingEmployee) return;
    setAddError("");
    try {
      setSavingEmployee(true);
      const name = newName.trim();
      const next = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({ name, role: newRole.trim() || "Қызметкер" }),
      });
      setState(next);
      const created = next.employees.find((employee) => employee.name === name);
      if (created) setSelectedId(created.id);
      setNewName("");
      setNewRole("");
      setAddOpen(false);
      showNotice("success", `${name} базаға сақталды және Google Sheets жаңарды.`);
    } catch (err) {
      const message = `Сақталмады: ${err.message}`;
      setAddError(message);
      showNotice("error", message);
    } finally {
      setSavingEmployee(false);
    }
  }

  async function archiveSelected() {
    if (!selected) return;
    try {
      const next = await api(`/api/employees/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      setState(next);
      setSelectedId(next.employees[0]?.id || null);
      showNotice("success", `${selected.name} архивке жіберілді.`);
    } catch (err) {
      showNotice("error", err.message);
    }
  }

  async function restoreEmployee(employeeId) {
    try {
      const next = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
      setState(next);
      setSelectedId(employeeId);
      setArchiveOpen(false);
      showNotice("success", "Қызметкер қайта қосылды.");
    } catch (err) {
      showNotice("error", err.message);
    }
  }

  async function setStatus(status) {
    if (!selected) return;
    try {
      const next = await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ date: selectedDate, employeeId: selected.id, status }),
      });
      setState(next);
      showNotice("success", `${selected.name}: ${statusMeta[status].label} сақталды.`);
    } catch (err) {
      showNotice("error", err.message);
    }
  }

  async function markAllPresent() {
    try {
      const next = await api("/api/bulk-attendance", {
        method: "POST",
        body: JSON.stringify({ date: selectedDate, status: "present", role: roleFilter }),
      });
      setState(next);
      showNotice("success", "Таңдалған қызметкерлердің бәрі жұмыста деп белгіленді.");
    } catch (err) {
      showNotice("error", err.message);
    }
  }

  async function syncSheets() {
    setSyncState("syncing");
    try {
      const next = await api("/api/sync", { method: "POST", body: "{}" });
      setState(next);
      setSyncState("done");
      showNotice("success", "Google Sheets толық жаңартылды.");
      setTimeout(() => setSyncState("ready"), 2400);
    } catch (err) {
      showNotice("error", err.message);
      setSyncState("ready");
    }
  }

  function goNextEmployee() {
    if (!employees.length) return;
    const index = employees.findIndex((employee) => employee.id === selected?.id);
    setSelectedId(employees[(index + 1) % employees.length].id);
  }

  return (
    <main className="min-h-screen bg-[#07101f] text-[#07122b]">
      <section className="app-shell mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden bg-[#f5f7fb] shadow-2xl md:my-5 md:min-h-[860px] md:rounded-[34px]">
        <header className="relative overflow-hidden px-5 pb-5 pt-5 text-white">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,#07133a_0%,#102a77_48%,#07101f_100%)]" />
          <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(135deg,rgba(255,255,255,.22)_1px,transparent_1px),linear-gradient(45deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:22px_22px]" />

          <div className="relative flex items-center justify-between">
            <button className="glass-icon text-white" aria-label="Артқа">
              <ArrowLeft className="size-5" />
            </button>
            <div className="rounded-full border border-white/25 bg-white/12 px-3 py-1 text-xs font-bold text-white/90 backdrop-blur">
              Sert Mini App
            </div>
          </div>

          <div className="relative mt-5 rounded-[26px] bg-white p-4 shadow-[0_22px_60px_rgba(0,0,0,0.26)]">
            <img className="mx-auto h-auto w-full max-w-[300px] object-contain" src="/brand/sert-logo.jpg" alt="Sert өндірістік компаниясы" />
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-2">
            <Metric icon={UsersRound} label="Қызметкер" value={employees.length} />
            <Metric icon={CalendarCheck2} label="Бүгін" value={`${state.todayControl?.total - state.todayControl?.unmarked || 0}/${state.todayControl?.total || 0}`} />
            <Metric icon={ShieldCheck} label="Бақылау" value={state.todayControl?.unmarked ? "Ашық" : "Дайын"} />
          </div>
        </header>

        <section className="grid flex-1 grid-rows-[auto_auto_auto_auto_1fr_auto] gap-4 px-4 py-4">
          {notice && <Notice type={notice.type} text={notice.text} />}

          <div className="premium-search">
            <Search className="size-4 text-[#7a86a0]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-[#9aa6bc]"
              placeholder="Қызметкер іздеу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button onClick={() => { setAddError(""); setAddOpen(true); }} className="primary-round" aria-label="Қызметкер қосу">
              <Plus className="size-5" />
            </button>
          </div>

          <section className="control-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Бүгінгі бақылау</p>
                <p className="text-lg font-black">{state.today}</p>
              </div>
              <button onClick={markAllPresent} className="control-action">
                Барлығын жұмыста
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(statusMeta).map(([key, meta]) => (
                <StatusPill key={key} meta={meta} value={state.todayControl?.[key] || 0} />
              ))}
            </div>
            <div className="mt-2 rounded-2xl bg-[#eef3ff] px-3 py-3 text-[#0b1b5f] ring-1 ring-[#dce6ff]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-[0.14em]">Белгі қойылмаған</span>
                <span className="text-lg font-black">{state.todayControl?.unmarked || 0}</span>
              </div>
              {!!state.unmarkedEmployees?.length && (
                <p className="mt-1 line-clamp-2 text-sm font-bold text-[#415071]">
                  {state.unmarkedEmployees.map((employee) => employee.name).join(", ")}
                </p>
              )}
            </div>
          </section>

          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            <FilterChip active={!roleFilter} onClick={() => setRoleFilter("")}>Барлығы</FilterChip>
            {(state.roles || []).map((role) => (
              <FilterChip key={role} active={roleFilter === role} onClick={() => setRoleFilter(role)}>
                {role}
              </FilterChip>
            ))}
            {!!state.archivedEmployees?.length && (
              <FilterChip onClick={() => setArchiveOpen(true)}>
                Архив
              </FilterChip>
            )}
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {filteredEmployees.map((employee) => {
              const active = employee.id === selected?.id;
              const markedCount = Object.values(employee.counts || {}).reduce((sum, value) => sum + value, 0);
              return (
                <button key={employee.id} onClick={() => setSelectedId(employee.id)} className={cx("employee-tab", active && "employee-tab-active")}>
                  <span className="block text-sm font-black">{employee.name}</span>
                  <span className={cx("mt-1 block text-xs font-bold", active ? "text-white/65" : "text-[#7a86a0]")}>
                    {employee.role || "Қызметкер"} · {markedCount} белгі
                  </span>
                </button>
              );
            })}
          </div>

          <section className="main-card">
            {loading ? (
              <div className="py-24 text-center text-sm font-bold text-[#7a86a0]">Жүктеліп жатыр...</div>
            ) : !selected ? (
              <div className="py-20 text-center">
                <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-[#eef3ff] text-[#0b1b5f]">
                  <UsersRound className="size-8" />
                </div>
                <p className="mt-4 text-xl font-black">Қызметкер жоқ</p>
                <button onClick={() => { setAddError(""); setAddOpen(true); }} className="mt-4 rounded-2xl bg-[#0b1b5f] px-5 py-3 text-sm font-black text-white">
                  Бірінші қызметкерді қосу
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{selected.role || "Қызметкер"}</p>
                    <h2 className="mt-1 text-2xl font-black text-[#07122b]">{selected.name}</h2>
                  </div>
                  <button onClick={archiveSelected} className="soft-icon" aria-label="Архивке жіберу">
                    <Archive className="size-5" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {Object.entries(statusMeta).map(([key, meta]) => (
                    <SmallStat key={key} meta={meta} value={selected.counts?.[key] || 0} />
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-[22px] bg-[#f1f5fb] px-3 py-2">
                  <button onClick={() => setMonth(addMonths(month, -1))} className="nav-round" aria-label="Алдыңғы ай">
                    <ChevronLeft className="size-5" />
                  </button>
                  <div className="text-center">
                    <p className="text-base font-black">{monthLabel(month)}</p>
                    <p className="text-xs font-bold text-[#7d88a0]">Қатысу календарі</p>
                  </div>
                  <button onClick={() => setMonth(addMonths(month, 1))} className="nav-round" aria-label="Келесі ай">
                    <ChevronRight className="size-5" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-1.5">
                  {weekDays.map((day) => (
                    <div key={day} className="grid h-7 place-items-center text-[11px] font-black text-[#9aa6bc]">{day}</div>
                  ))}
                  {Array.from({ length: weekdayOffset(month) }).map((_, index) => <div key={`empty-${index}`} className="aspect-square" />)}
                  {Array.from({ length: daysInMonth(month) }).map((_, index) => {
                    const day = index + 1;
                    const status = selectedMarks[day];
                    const active = day === selectedDay;
                    return (
                      <button key={day} onClick={() => setSelectedDay(day)} className={cx("calendar-day", active && "calendar-active", status && "calendar-marked")}>
                        <span>{day}</span>
                        {status && <span className={cx("absolute bottom-1.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full shadow-sm", statusMeta[status].dot)} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className="action-dock">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow">Таңдалған күн</p>
                <p className="text-lg font-black">{selectedDate}</p>
              </div>
              <div className="grid size-11 place-items-center rounded-2xl bg-[#eef3ff] text-[#0b1b5f]">
                <CalendarDays className="size-5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(statusMeta).map(([key, meta]) => (
                <StatusButton key={key} meta={meta} onClick={() => setStatus(key)} disabled={!selected} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <button onClick={goNextEmployee} className="next-button">Келесі қызметкер</button>
              <button onClick={syncSheets} className="sheet-button" aria-label="Google Sheets жаңарту">
                {syncState === "syncing" ? <Clock3 className="size-5 animate-spin" /> : syncState === "done" ? <Check className="size-5" /> : <FileSpreadsheet className="size-5" />}
              </button>
            </div>
          </section>
        </section>
      </section>

      {addOpen && (
        <Modal title="Қызметкер қосу" onClose={() => setAddOpen(false)}>
          {addError && <div className="mb-3"><Notice type="error" text={addError} /></div>}
          <label className="mb-3 block">
            <span className="form-label">Аты-жөні</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} className="form-input" placeholder="Мысалы: Айбек Нұрлан" />
          </label>
          <label className="block">
            <span className="form-label">Рөлі / бригадасы</span>
            <input value={newRole} onChange={(event) => setNewRole(event.target.value)} className="form-input" placeholder="Мысалы: Оператор, Қойма, Цех 1" />
          </label>
          <button onClick={addEmployee} disabled={!newName.trim() || savingEmployee} className="mt-4 w-full rounded-[20px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)] disabled:opacity-50">
            {savingEmployee ? "Сақталып жатыр..." : "Қосу және сақтау"}
          </button>
        </Modal>
      )}

      {archiveOpen && (
        <Modal title="Архив" onClose={() => setArchiveOpen(false)}>
          <div className="space-y-2">
            {state.archivedEmployees?.length ? state.archivedEmployees.map((employee) => (
              <div key={employee.id} className="flex items-center justify-between rounded-[20px] bg-[#f4f7fc] px-4 py-3">
                <div>
                  <p className="font-black">{employee.name}</p>
                  <p className="text-xs font-bold text-[#7a86a0]">{employee.role}</p>
                </div>
                <button onClick={() => restoreEmployee(employee.id)} className="grid size-10 place-items-center rounded-full bg-white text-[#0b1b5f] shadow-sm">
                  <RotateCcw className="size-4" />
                </button>
              </div>
            )) : <p className="py-5 text-center text-sm font-bold text-[#7a86a0]">Архив бос</p>}
          </div>
        </Modal>
      )}
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[20px] border border-white/18 bg-white/12 p-3 backdrop-blur">
      <Icon className="size-4 text-white/76" />
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/52">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function Notice({ type, text }) {
  const success = type === "success";
  return (
    <div className={cx("flex items-start gap-2 rounded-[20px] px-4 py-3 text-sm font-black ring-1", success ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-rose-50 text-rose-800 ring-rose-100")}>
      {success ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

function StatusPill({ meta, value }) {
  const Icon = meta.Icon;
  return (
    <div className={cx("rounded-2xl px-3 py-3 ring-1", meta.chip)}>
      <div className="flex items-center justify-between gap-2">
        <Icon className="size-4 shrink-0" />
        <span className="text-xl font-black">{value}</span>
      </div>
      <p className="mt-1 text-xs font-black">{meta.label}</p>
    </div>
  );
}

function SmallStat({ meta, value }) {
  const Icon = meta.Icon;
  return (
    <div className={cx("rounded-2xl p-2 text-center ring-1", meta.chip)}>
      <Icon className="mx-auto size-4" />
      <p className="mt-1 text-base font-black">{value}</p>
    </div>
  );
}

function StatusButton({ meta, onClick, disabled }) {
  const Icon = meta.Icon;
  return (
    <button disabled={disabled} onClick={onClick} className={cx("rounded-[20px] bg-gradient-to-br px-3 py-4 text-left text-white shadow-xl disabled:opacity-40", meta.button)}>
      <div className="flex items-center gap-2">
        <Icon className="size-5" />
        <span className="text-sm font-black">{meta.label}</span>
      </div>
      <p className="mt-1 text-xs font-bold text-white/70">{meta.caption}</p>
    </button>
  );
}

function FilterChip({ active, children, onClick }) {
  return (
    <button onClick={onClick} className={cx("shrink-0 rounded-full px-4 py-2 text-xs font-black ring-1", active ? "bg-[#0b1b5f] text-white ring-[#0b1b5f]" : "bg-white text-[#526176] ring-[#dfe6f2]")}>
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-[#061133]/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[430px] rounded-[30px] bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-black">{title}</h3>
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full bg-[#f4f7fc] text-[#64748b]" aria-label="Жабу">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default App;
