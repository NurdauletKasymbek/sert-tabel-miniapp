import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const statusMeta = {
  present: { label: "Жұмыста", dot: "bg-[#16a36f]", text: "text-[#0c7a55]", bg: "bg-[#e8f8f1]" },
  half: { label: "Жарты күн", dot: "bg-[#d8941c]", text: "text-[#956413]", bg: "bg-[#fff3d6]" },
  absent: { label: "Жоқ", dot: "bg-[#c43b5a]", text: "text-[#9f2f47]", bg: "bg-[#ffe8ee]" },
  dayoff: { label: "Демалыс", dot: "bg-[#64748b]", text: "text-[#526176]", bg: "bg-[#e9edf4]" },
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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "API қатесі");
  return result;
}

function App() {
  const [state, setState] = useState({ employees: [], attendance: {}, month: "2026-05", today: "2026-05-03", sheetSync: null });
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [month, setMonth] = useState("2026-05");
  const [query, setQuery] = useState("");
  const [syncState, setSyncState] = useState("ready");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!selectedId && state.employees.length) setSelectedId(state.employees[0].id);
  }, [selectedId, state.employees]);

  async function loadState() {
    try {
      setLoading(true);
      const next = await api("/api/state");
      setState(next);
      setMonth(next.month || "2026-05");
      setSelectedDay(Number((next.today || "2026-05-01").slice(-2)));
      if (!selectedId && next.employees.length) setSelectedId(next.employees[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const employees = state.employees || [];
  const selected = employees.find((employee) => employee.id === selectedId) || employees[0];
  const filteredEmployees = employees.filter((employee) =>
    employee.name.toLowerCase().includes(query.toLowerCase()) && (!roleFilter || employee.role === roleFilter),
  );
  const selectedMarks = useMemo(() => {
    const marks = {};
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const status = state.attendance?.[date]?.[selected?.id]?.status;
      if (status) marks[day] = status;
    }
    return marks;
  }, [month, selected?.id, state.attendance]);
  const todayMarked = employees.filter((employee) => state.attendance?.[`${month}-${String(selectedDay).padStart(2, "0")}`]?.[employee.id]).length;
  const counts = selected?.counts || { present: 0, half: 0, absent: 0, dayoff: 0 };

  async function addEmployee() {
    if (!newName.trim()) return;
    const next = await api("/api/employees", {
      method: "POST",
      body: JSON.stringify({ name: newName.trim(), role: newRole.trim() || "Қызметкер" }),
    });
    setState(next);
    const created = next.employees.find((employee) => employee.name === newName.trim());
    if (created) setSelectedId(created.id);
    setNewName("");
    setNewRole("");
    setAddOpen(false);
  }

  async function archiveSelected() {
    if (!selected) return;
    const next = await api(`/api/employees/${encodeURIComponent(selected.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived", archivedAt: new Date().toISOString() }),
    });
    setState(next);
    setSelectedId(next.employees[0]?.id || null);
  }

  async function restoreEmployee(employeeId) {
    const next = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    });
    setState(next);
    setSelectedId(employeeId);
    setArchiveOpen(false);
  }

  async function setStatus(status) {
    if (!selected) return;
    const date = `${month}-${String(selectedDay).padStart(2, "0")}`;
    const next = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ date, employeeId: selected.id, status }),
    });
    setState(next);
  }

  async function markAllPresent() {
    const date = `${month}-${String(selectedDay).padStart(2, "0")}`;
    const next = await api("/api/bulk-attendance", {
      method: "POST",
      body: JSON.stringify({ date, status: "present", role: roleFilter }),
    });
    setState(next);
  }

  async function syncSheets() {
    setSyncState("syncing");
    try {
      const next = await api("/api/sync", { method: "POST", body: "{}" });
      setState(next);
      setSyncState("done");
      setTimeout(() => setSyncState("ready"), 2400);
    } catch (err) {
      setError(err.message);
      setSyncState("ready");
    }
  }

  function goNextEmployee() {
    if (!employees.length) return;
    const index = employees.findIndex((employee) => employee.id === selected?.id);
    setSelectedId(employees[(index + 1) % employees.length].id);
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#07122b]">
      <section className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden bg-[#f9fbff] shadow-2xl md:my-5 md:min-h-[860px] md:rounded-[34px]">
        <header className="relative overflow-hidden bg-[#0b1b5f] px-5 pb-6 pt-5 text-white">
          <div className="absolute inset-0 opacity-35 [background:radial-gradient(circle_at_24%_0%,rgba(255,255,255,0.34),transparent_25%),linear-gradient(135deg,#10226f,#071240)]" />
          <div className="relative flex items-center justify-between">
            <button className="icon-button text-white/88" aria-label="Артқа">
              <ArrowLeft className="size-5" />
            </button>
            <div className="rounded-full border border-white/16 bg-white/10 px-3 py-1 text-xs font-semibold text-white/86 backdrop-blur">
              Mini App
            </div>
          </div>

          <div className="relative mt-5 rounded-[28px] bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <img className="mx-auto h-auto w-full max-w-[300px] object-contain" src="/brand/sert-logo.jpg" alt="Sert өндірістік компаниясы" />
          </div>

          <div className="relative mt-5 grid grid-cols-3 gap-2">
            <Metric icon={UserRound} label="Адам" value={employees.length} />
            <Metric icon={Check} label="Белгі" value={`${todayMarked}/${employees.length || 0}`} />
            <Metric icon={CalendarDays} label="Күн" value={selectedDay} />
          </div>
        </header>

        <section className="grid flex-1 grid-rows-[auto_auto_1fr_auto] gap-4 px-4 py-4">
          {error && (
            <div className="rounded-[18px] bg-[#ffe8ee] px-4 py-3 text-sm font-bold text-[#9f2f47]">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 rounded-[20px] border border-[#dfe6f2] bg-white px-4 py-3 shadow-[0_12px_30px_rgba(15,31,76,0.06)]">
            <Search className="size-4 text-[#7a86a0]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-[#9aa6bc]"
              placeholder="Қызметкер іздеу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              onClick={() => setAddOpen(true)}
              className="grid size-9 place-items-center rounded-full bg-[#0b1b5f] text-white shadow-[0_10px_20px_rgba(11,27,95,0.24)]"
              aria-label="Қосу"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="rounded-[24px] border border-[#dfe6f2] bg-white p-3 shadow-[0_12px_30px_rgba(15,31,76,0.06)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8b96ad]">Бүгінгі бақылау</p>
                <p className="text-sm font-black">{state.today}</p>
              </div>
              <button onClick={markAllPresent} className="rounded-[15px] bg-[#0b1b5f] px-3 py-2 text-xs font-black text-white">
                Барлығын жұмыста
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              <StatusMini label="Ж" value={state.todayControl?.present || 0} tone="present" />
              <StatusMini label="0.5" value={state.todayControl?.half || 0} tone="half" />
              <StatusMini label="Жоқ" value={state.todayControl?.absent || 0} tone="absent" />
              <StatusMini label="Дем" value={state.todayControl?.dayoff || 0} tone="dayoff" />
              <div className="rounded-xl bg-[#eef3ff] px-2 py-1 text-center text-[#0b1b5f]">
                <p className="text-[10px] font-black">Белгі жоқ</p>
                <p className="text-sm font-black">{state.todayControl?.unmarked || 0}</p>
              </div>
            </div>
            {!!state.unmarkedEmployees?.length && (
              <div className="mt-3 rounded-[16px] bg-[#f4f7fc] px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#8b96ad]">Әлі белгі жоқ</p>
                <p className="mt-1 text-sm font-bold text-[#24314a]">{state.unmarkedEmployees.map((employee) => employee.name).join(", ")}</p>
              </div>
            )}
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            <button
              onClick={() => setRoleFilter("")}
              className={cx("shrink-0 rounded-full px-4 py-2 text-xs font-black", !roleFilter ? "bg-[#0b1b5f] text-white" : "bg-white text-[#526176]")}
            >
              Барлығы
            </button>
            {(state.roles || []).map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={cx("shrink-0 rounded-full px-4 py-2 text-xs font-black", roleFilter === role ? "bg-[#0b1b5f] text-white" : "bg-white text-[#526176]")}
              >
                {role}
              </button>
            ))}
            {!!state.archivedEmployees?.length && (
              <button onClick={() => setArchiveOpen(true)} className="shrink-0 rounded-full bg-[#e9edf4] px-4 py-2 text-xs font-black text-[#526176]">
                Архив
              </button>
            )}
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {filteredEmployees.map((employee) => {
              const active = employee.id === selected?.id;
              const markedCount = Object.values(employee.counts || {}).reduce((sum, value) => sum + value, 0);
              return (
                <button
                  key={employee.id}
                  onClick={() => setSelectedId(employee.id)}
                  className={cx(
                    "shrink-0 rounded-[18px] border px-4 py-3 text-left transition",
                    active
                      ? "border-[#0b1b5f] bg-[#0b1b5f] text-white shadow-[0_16px_34px_rgba(11,27,95,0.24)]"
                      : "border-[#dde5f1] bg-white text-[#17233c]",
                  )}
                >
                  <span className="block text-sm font-extrabold">{employee.name}</span>
                  <span className={cx("mt-1 block text-xs", active ? "text-white/62" : "text-[#7a86a0]")}>
                    {markedCount} күн белгіленген
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-[28px] border border-[#dfe6f2] bg-white p-4 shadow-[0_18px_48px_rgba(15,31,76,0.08)]">
            {loading ? (
              <div className="py-24 text-center text-sm font-bold text-[#7a86a0]">Жүктеліп жатыр...</div>
            ) : !selected ? (
              <div className="py-24 text-center">
                <p className="text-lg font-black">Қызметкер жоқ</p>
                <button onClick={() => setAddOpen(true)} className="mt-4 rounded-[18px] bg-[#0b1b5f] px-5 py-3 text-sm font-black text-white">
                  Бірінші қызметкерді қосу
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8b96ad]">{selected.role}</p>
                    <h2 className="mt-1 text-2xl font-black text-[#07122b]">{selected.name}</h2>
                  </div>
                  <button onClick={archiveSelected} className="grid size-11 place-items-center rounded-2xl bg-[#f4f7fc] text-[#64748b]" aria-label="Архивке жіберу">
                    <Archive className="size-5" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-2xl bg-[#f4f7fc] p-1.5">
                  <StatusMini label="Ж" value={counts.present || 0} tone="present" />
                  <StatusMini label="0.5" value={counts.half || 0} tone="half" />
                  <StatusMini label="Жоқ" value={counts.absent || 0} tone="absent" />
                  <StatusMini label="Дем" value={counts.dayoff || 0} tone="dayoff" />
                </div>

                <div className="mt-4 flex items-center justify-between rounded-[18px] bg-[#f4f7fc] px-3 py-2">
                  <button onClick={() => setMonth(addMonths(month, -1))} className="grid size-9 place-items-center rounded-full bg-white text-[#0b1b5f] shadow-sm" aria-label="Алдыңғы ай">
                    <ChevronLeft className="size-5" />
                  </button>
                  <div className="text-center">
                    <p className="text-sm font-black">{monthLabel(month)}</p>
                    <p className="text-xs font-semibold text-[#7d88a0]">Қатысу бақылауы</p>
                  </div>
                  <button onClick={() => setMonth(addMonths(month, 1))} className="grid size-9 place-items-center rounded-full bg-white text-[#0b1b5f] shadow-sm" aria-label="Келесі ай">
                    <ChevronRight className="size-5" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-1.5">
                  {weekDays.map((day) => (
                    <div key={day} className="grid h-7 place-items-center text-[11px] font-black text-[#9aa6bc]">
                      {day}
                    </div>
                  ))}
                  {Array.from({ length: weekdayOffset(month) }).map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square" />
                  ))}
                  {Array.from({ length: daysInMonth(month) }).map((_, index) => {
                    const day = index + 1;
                    const status = selectedMarks[day];
                    const active = day === selectedDay;
                    return (
                      <button
                        key={day}
                        onClick={() => setSelectedDay(day)}
                        className={cx(
                          "relative aspect-square rounded-[14px] text-sm font-black transition",
                          status ? `${statusMeta[status].bg} ${statusMeta[status].text}` : "bg-[#f2f5fa] text-[#24314a]",
                          active && "ring-2 ring-[#0b1b5f] ring-offset-2",
                        )}
                      >
                        <span>{day}</span>
                        {status && <span className={cx("absolute bottom-1.5 left-1/2 size-2 -translate-x-1/2 rounded-full", statusMeta[status].dot)} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="rounded-t-[30px] border border-[#dfe6f2] bg-white p-4 shadow-[0_-12px_40px_rgba(15,31,76,0.08)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8b96ad]">Таңдалған күн</p>
                <p className="text-lg font-black">{month}-{String(selectedDay).padStart(2, "0")}</p>
              </div>
              <div className="grid size-11 place-items-center rounded-2xl bg-[#eef3ff] text-[#0b1b5f]">
                <CalendarDays className="size-5" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <PremiumButton tone="emerald" onClick={() => setStatus("present")} disabled={!selected}>Жұмыста</PremiumButton>
              <PremiumButton tone="amber" onClick={() => setStatus("half")} disabled={!selected}>Жарты күн</PremiumButton>
              <PremiumButton tone="rose" onClick={() => setStatus("absent")} disabled={!selected}>Жоқ</PremiumButton>
              <PremiumButton tone="slate" onClick={() => setStatus("dayoff")} disabled={!selected}>Демалыс</PremiumButton>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <button onClick={goNextEmployee} className="rounded-[18px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_14px_30px_rgba(11,27,95,0.24)]">
                Келесі қызметкер
              </button>
              <button onClick={syncSheets} className="grid size-[52px] place-items-center rounded-[18px] bg-[#eef3ff] text-[#0b1b5f]" aria-label="Google Sheets">
                {syncState === "syncing" ? <Clock3 className="size-5 animate-spin" /> : syncState === "done" ? <Check className="size-5" /> : <FileSpreadsheet className="size-5" />}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-[16px] bg-[#f4f7fc] px-3 py-2 text-xs font-bold text-[#758198]">
              {syncState === "done" ? <Check className="size-4 text-emerald-600" /> : <Sparkles className="size-4 text-[#0b1b5f]" />}
              {syncState === "done" ? "Google Sheets жаңартылды" : "Өзгерістер базаға жазылады"}
            </div>
          </div>
        </section>
      </section>

      {addOpen && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-[#061133]/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[430px] rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-black">Қызметкер қосу</h3>
              <button onClick={() => setAddOpen(false)} className="grid size-10 place-items-center rounded-full bg-[#f4f7fc] text-[#64748b]" aria-label="Жабу">
                <X className="size-5" />
              </button>
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-[#8b96ad]">Аты-жөні</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} className="w-full rounded-[18px] border border-[#dfe6f2] px-4 py-3 font-bold outline-none focus:border-[#0b1b5f]" placeholder="Мысалы: Айбек Нұрлан" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-[#8b96ad]">Рөлі</span>
              <input value={newRole} onChange={(event) => setNewRole(event.target.value)} className="w-full rounded-[18px] border border-[#dfe6f2] px-4 py-3 font-bold outline-none focus:border-[#0b1b5f]" placeholder="Мысалы: Қойма" />
            </label>
            <button onClick={addEmployee} className="mt-4 w-full rounded-[18px] bg-[#0b1b5f] px-4 py-4 text-sm font-black text-white shadow-[0_14px_30px_rgba(11,27,95,0.24)]">
              Қосу және сақтау
            </button>
          </div>
        </div>
      )}

      {archiveOpen && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-[#061133]/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[430px] rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-black">Архив</h3>
              <button onClick={() => setArchiveOpen(false)} className="grid size-10 place-items-center rounded-full bg-[#f4f7fc] text-[#64748b]" aria-label="Жабу">
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-2">
              {state.archivedEmployees?.map((employee) => (
                <div key={employee.id} className="flex items-center justify-between rounded-[18px] bg-[#f4f7fc] px-4 py-3">
                  <div>
                    <p className="font-black">{employee.name}</p>
                    <p className="text-xs font-bold text-[#7a86a0]">{employee.role}</p>
                  </div>
                  <button onClick={() => restoreEmployee(employee.id)} className="grid size-10 place-items-center rounded-full bg-white text-[#0b1b5f]">
                    <RotateCcw className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[18px] border border-white/12 bg-white/10 p-3 backdrop-blur">
      <Icon className="size-4 text-white/76" />
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/48">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function StatusMini({ label, value, tone }) {
  return (
    <div className={cx("min-w-12 rounded-xl px-2 py-1 text-center", statusMeta[tone].bg, statusMeta[tone].text)}>
      <p className="text-[10px] font-black">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  );
}

function PremiumButton({ tone, children, onClick, disabled }) {
  const styles = {
    emerald: "from-[#0f8b62] to-[#19b77d] shadow-[0_12px_24px_rgba(15,139,98,0.22)]",
    amber: "from-[#b7791f] to-[#e2a12b] shadow-[0_12px_24px_rgba(183,121,31,0.2)]",
    rose: "from-[#9f2f47] to-[#d34c69] shadow-[0_12px_24px_rgba(159,47,71,0.18)]",
    slate: "from-[#3e4b61] to-[#65748c] shadow-[0_12px_24px_rgba(62,75,97,0.18)]",
  };
  return (
    <button disabled={disabled} onClick={onClick} className={cx("rounded-[18px] bg-gradient-to-br px-4 py-4 text-sm font-black text-white disabled:opacity-40", styles[tone])}>
      {children}
    </button>
  );
}

export default App;
