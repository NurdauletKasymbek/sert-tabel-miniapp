import { appendHistory, assertNotFutureDate, currentTime, invalidateStoreCache, loadStore, publicState, rebuildSummary, statusToLabel, todayDate, upsertAttendance, STATUSES } from "./_lib/sheets.js";

const WORK_END_HOUR = 18;
const TERMINAL_TZ = process.env.BOT_TIMEZONE || "Asia/Tashkent";

function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Терминал жіберген ISO уақытты жергілікті күн/сағатқа айналдыру (офлайн сканға керек)
function tsToDate(ts) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TERMINAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ts));
}
function tsToTime(ts) {
  return new Intl.DateTimeFormat("kk-KZ", {
    timeZone: TERMINAL_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts));
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function notifyAdmins(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  for (const adminId of adminIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: adminId, text, parse_mode: "HTML" }),
      });
    } catch {}
  }
}

// Тіркелмеген карта тигізілгенде — әкімшіге UID + қызметкерлер түймелерін жіберу.
// Әкімші түймені бассы — api/bot.js "bindcard:" callback-і UID-ті сол адамға байлайды.
async function notifyAdminsNewCard(uid, employees) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!adminIds.length) return;
  // Тек картасы жоқ, архивте емес қызметкерлер (тізім қысқа, қате байлау болмайды)
  const free = (employees || [])
    .filter((e) => !String(e.cardUid || "").trim() && e.status !== "archived")
    .slice(0, 40);
  const buttons = free.map((e) => ([{ text: e.name, callback_data: `bindcard:${e.id}:${uid}` }]));
  const header = [
    "🆕 <b>Жаңа карта тіркелмеген</b>",
    `🆔 UID: <code>${uid}</code>`,
    "",
    free.length ? "Кімге тіркейміз? 👇" : "⚠️ Картасыз бос қызметкер жоқ. Mini App-та қосыңыз.",
  ].join("\n");
  for (const adminId of adminIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: adminId,
          text: header,
          parse_mode: "HTML",
          ...(free.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
        }),
      });
    } catch {}
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    // Жазу операциясы — әрқашан ЖАҢА деректен бастаймыз (10 сек кэшті аттап өтеміз),
    // әйтпесе ескі көшірмемен бүкіл парақты қайта жазып, басқа жазбаларды өшіреміз.
    invalidateStoreCache();
    const store = await loadStore();
    const action = String(body.action || "").toLowerCase();

    // ==========================================
    // NFC КАРТА ТЕРМИНАЛЫ — картаны тигізу
    // ==========================================
    // Терминал {card_uid, terminal_id, timestamp} жібереді (action болмауы да мүмкін).
    // Қызметкерді КАРТА UID арқылы табады (Telegram ID емес — телефоны жоқтар үшін),
    // геолокация тексерілмейді (терминал жұмыс орнында тұр), кіру/шығу автоматты ауысады.
    if (action === "nfc-scan" || (!action && (body.card_uid || body.employee_id))) {
      const cardUid = String(body.card_uid || "").trim();
      const empIdIn = String(body.employee_id || "").trim(); // бет тану осыны жібереді
      if (!cardUid && !empIdIn) {
        res.status(200).json({ status: "error", message: "card_uid немесе employee_id қажет" });
        return;
      }
      const nEmp = empIdIn
        ? store.employees.find((e) => e.id === empIdIn)
        : store.employees.find((e) => {
            const c = String(e.cardUid || "").trim();
            return c && c.toLowerCase() === cardUid.toLowerCase();
          });
      if (!nEmp) {
        // Тек карта болса әкімшіге хабарлаймыз (бет тану кезінде емес)
        if (cardUid) await notifyAdminsNewCard(cardUid, store.employees);
        res.status(200).json({ status: "not_found", message: "Employee not found" });
        return;
      }
      if (nEmp.status === "archived") {
        res.status(200).json({ status: "error", message: "Тіркеу архивте" });
        return;
      }

      // Офлайн: терминал жіберген нақты тигізу уақытын қолданамыз (кейін жіберілсе де дұрыс)
      const validTs = body.timestamp && !Number.isNaN(new Date(body.timestamp).getTime());
      const tapIso = validTs ? new Date(body.timestamp).toISOString() : new Date().toISOString();
      const tapMs = new Date(tapIso).getTime();
      const nToday = validTs ? tsToDate(body.timestamp) : todayDate();
      const nNow = validTs ? tsToTime(body.timestamp) : currentTime();
      const nExisting = [...store.attendance].reverse().find(
        (row) => row.date === nToday && row.employeeId === nEmp.id,
      );

      // Автоматты кіру: бүгін кіру белгісі жоқ болса → КІРУ
      if (!nExisting || !nExisting.checkInTime) {
        const inTotal = timeToMinutes(nNow);
        const lateMin = inTotal > 9 * 60 ? inTotal - 9 * 60 : 0;
        const label = statusToLabel("present");
        await upsertAttendance([{
          date: nToday,
          employeeId: nEmp.id,
          name: nEmp.name,
          role: nEmp.role || "Қызметкер",
          label,
          time: nNow,
          updatedAt: tapIso,
          checkInTime: nNow,
          checkOutTime: "",
          lateMinutes: lateMin,
          earlyMinutes: 0,
        }]);
        await appendHistory([{
          at: new Date().toISOString(),
          action: "Кіру белгіленді (карта)",
          employeeId: nEmp.id,
          name: nEmp.name,
          date: nToday,
          oldLabel: "",
          newLabel: `Кіру: ${nNow}${lateMin ? ` (${lateMin} мин кешік)` : ""}`,
        }]);
        const msgIn = lateMin > 0
          ? `⚠️ <b>${nEmp.name}</b> ${lateMin} минутқа кешікті (${nNow}) 🎫`
          : `✅ <b>${nEmp.name}</b> жұмысқа келді (${nNow}) 🎫`;
        await notifyAdmins(msgIn);
        res.status(200).json({ status: "success", employee_name: nEmp.name, role: nEmp.role || "", emp_id: nEmp.tabNumber || "", event_type: "in", late_minutes: lateMin });
        return;
      }

      // Қайталап басудан қорғау: соңғы әрекеттен кейін 30 сек өтпесе — ескерту
      // (бір басып кіргеннен кейін байқамай қайта басса, "шығу" болып кетпейді)
      const lastActionMs = nExisting.updatedAt ? new Date(nExisting.updatedAt).getTime() : 0;
      if (lastActionMs && tapMs - lastActionMs < 30000) {
        res.status(200).json({
          status: "duplicate",
          employee_name: nEmp.name,
          role: nEmp.role || "",
          emp_id: nEmp.tabNumber || "",
          event_type: nExisting.checkOutTime ? "out" : "in",
          message: "Сіз жаңа ғана белгілендіңіз",
        });
        return;
      }

      // Бүгін екеуі де белгіленген болса — қайталама тигізу
      if (nExisting.checkOutTime) {
        res.status(200).json({ status: "success", employee_name: nEmp.name, role: nEmp.role || "", emp_id: nEmp.tabNumber || "", event_type: "out", message: "Бүгін кіру-шығу белгіленген" });
        return;
      }

      // Кіру бар, шығу жоқ → ШЫҒУ
      const outTotal = timeToMinutes(nNow);
      const earlyMin = outTotal < WORK_END_HOUR * 60 ? WORK_END_HOUR * 60 - outTotal : 0;
      await upsertAttendance([{
        ...nExisting,
        checkOutTime: nNow,
        earlyMinutes: earlyMin,
        updatedAt: tapIso,
      }]);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Шығу белгіленді (карта)",
        employeeId: nEmp.id,
        name: nEmp.name,
        date: nToday,
        oldLabel: nExisting.label,
        newLabel: `Шығу: ${nNow}${earlyMin ? ` (${earlyMin} мин ерте)` : ""}`,
      }]);
      invalidateStoreCache();
      await rebuildSummary(await loadStore());
      const msgOut = earlyMin > 0
        ? `⚠️ <b>${nEmp.name}</b> жұмыстан ${earlyMin} минут ерте (${nNow}) 🎫`
        : `✅ <b>${nEmp.name}</b> жұмыс күнін аяқтады (${nNow}) 🎫`;
      await notifyAdmins(msgOut);
      res.status(200).json({ status: "success", employee_name: nEmp.name, role: nEmp.role || "", emp_id: nEmp.tabNumber || "", event_type: "out", early_minutes: earlyMin });
      return;
    }

    if (action === "worker-checkin" || action === "worker-checkout") {
      const telegramId = String(body.telegramId || "").trim();
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (!telegramId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: "Telegram ID немесе координат қате" });
        return;
      }

      const wEmployee = store.employees.find(
        (e) => {
          const tid = String(e.telegramId || "").trim();
          return tid && tid === telegramId;
        },
      );
      if (!wEmployee) {
        res.status(403).json({ error: "Сіз жүйеде тіркелмегенсіз. Әкімшіге хабарласыңыз." });
        return;
      }
      if (wEmployee.status === "archived") {
        res.status(403).json({ error: "Сіздің тіркеуіңіз архивте." });
        return;
      }

      const wLat = Number(process.env.WORKPLACE_LAT);
      const wLon = Number(process.env.WORKPLACE_LON);
      const wRadius = Number(process.env.WORKPLACE_RADIUS_M || "10");
      // Геолокация тексеруінен босатылған Telegram ID-лер (тестілеу/қашықтан
      // белгілеу үшін). GEO_BYPASS_TELEGRAM_IDS env-те үтірмен беріледі —
      // бұл ID-лер кез келген жерден КІРУ/ШЫҒУ баса алады.
      const geoBypassIds = (process.env.GEO_BYPASS_TELEGRAM_IDS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const geoBypass = geoBypassIds.includes(telegramId);
      let outsideDistance = 0;
      if (!geoBypass && Number.isFinite(wLat) && Number.isFinite(wLon)) {
        const dist = distanceMeters(wLat, wLon, lat, lon);
        outsideDistance = Math.round(dist);
        if (dist > wRadius) {
          // Кіру: блоктаймыз. Шығу: жалғастырамыз — қызметкер жұмыс
          // бабымен сыртта болуы мүмкін (admin-ге уведомление кейінде).
          if (action === "worker-checkin") {
            res.status(400).json({
              error: `❌ Жұмыс орнында емессіз (${Math.round(dist)}м). Рұқсат: ${wRadius}м.`,
              distance: Math.round(dist),
            });
            return;
          }
        } else {
          outsideDistance = 0;
        }
      }

      const wToday = todayDate();
      const now = currentTime();
      const wExisting = [...store.attendance].reverse().find(
        (row) => row.date === wToday && row.employeeId === wEmployee.id,
      );

      if (action === "worker-checkin") {
        if (wExisting?.checkInTime) {
          res.status(400).json({ error: "Бүгін кіру белгісі бар. Шығуды басыңыз." });
          return;
        }
        const checkInTotal = timeToMinutes(now);
        const lateMin = checkInTotal > 9 * 60 ? checkInTotal - 9 * 60 : 0;
        // Нақты сағат жазылады — кеш келсе де "Жұмыста" болып қалады, жалақы
        // істелген минутқа пропорционал есептеледі (salaryReport).
        const status = "present";
        const label = statusToLabel(status);

        await upsertAttendance([{
          date: wToday,
          employeeId: wEmployee.id,
          name: wEmployee.name,
          role: wEmployee.role || "Қызметкер",
          label,
          time: now,
          updatedAt: new Date().toISOString(),
          checkInTime: now,
          checkOutTime: "",
          lateMinutes: lateMin,
          earlyMinutes: 0,
        }]);
        await appendHistory([{
          at: new Date().toISOString(),
          action: "Кіру белгіленді",
          employeeId: wEmployee.id,
          name: wEmployee.name,
          date: wToday,
          oldLabel: "",
          newLabel: `Кіру: ${now}${lateMin ? ` (${lateMin} мин кешік)` : ""}`,
        }]);

        const adminMsg = lateMin > 0
          ? `⚠️ <b>${wEmployee.name}</b> ${lateMin} минутқа кешікті (${now})`
          : `✅ <b>${wEmployee.name}</b> жұмысқа келді (${now})`;
        notifyAdmins(adminMsg).catch(() => {});

        res.status(200).json({
          ok: true,
          checkInTime: now,
          lateMinutes: lateMin,
          label,
          message: lateMin > 0
            ? `⚠️ Кешіктіңіз: ${lateMin} минут (жұмыс 09:00-де басталады)`
            : "✅ Кіру белгіленді",
        });
        return;
      }

      // worker-checkout
      if (!wExisting || !wExisting.checkInTime) {
        res.status(400).json({ error: "Алдымен кіру белгісі қажет." });
        return;
      }
      if (wExisting.checkOutTime) {
        res.status(400).json({ error: "Бүгін шығу белгісі бар." });
        return;
      }

      const checkOutTotal = timeToMinutes(now);
      const earlyMin = checkOutTotal < WORK_END_HOUR * 60 ? WORK_END_HOUR * 60 - checkOutTotal : 0;
      // Белгі өзгермейді — қысқа күн "Жарты күн" деп қойылмайды, нақты
      // Кіру/Шығу сағаты сақталады да, жалақы сол сағатқа пропорционал есептеледі.
      const newLabel = wExisting.label;

      await upsertAttendance([{
        ...wExisting,
        label: newLabel,
        checkOutTime: now,
        earlyMinutes: earlyMin,
        updatedAt: new Date().toISOString(),
      }]);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Шығу белгіленді",
        employeeId: wEmployee.id,
        name: wEmployee.name,
        date: wToday,
        oldLabel: wExisting.label,
        newLabel: `Шығу: ${now}${earlyMin ? ` (${earlyMin} мин ерте)` : ""}`,
      }]);
      invalidateStoreCache();
      await rebuildSummary(await loadStore());

      const parts = [];
      if (outsideDistance > 0) {
        parts.push(`🚙 <b>${wEmployee.name}</b> сыртта шықты (~${outsideDistance}м)`);
      } else {
        parts.push(`✅ <b>${wEmployee.name}</b>`);
      }
      if (earlyMin > 0) {
        parts.push(`⚠️ Жұмыстан ${earlyMin} минут ерте (${now})`);
      } else {
        parts.push(`Жұмыс күнін аяқтады (${now})`);
      }
      notifyAdmins(parts.join("\n")).catch(() => {});

      res.status(200).json({
        ok: true,
        checkOutTime: now,
        earlyMinutes: earlyMin,
        label: newLabel,
        message: earlyMin > 0
          ? `⚠️ ${earlyMin} минут ерте кету (жұмыс 18:00-де бітеді)`
          : "✅ Шығу белгіленді",
      });
      return;
    }

    const date = String(body.date || "");
    const employeeId = String(body.employeeId || "");
    const employee = store.employees.find((item) => item.id === employeeId);

    // Аралықпен белгілеу (мыс. командировка) — бір қызметкерге бірнеше күн бірден.
    if (action === "range") {
      const status = String(body.status || "");
      const startDate = String(body.startDate || "");
      const endDate = String(body.endDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !employee || !STATUSES[status]) {
        res.status(400).json({ error: "Күн аралығы, қызметкер немесе статус қате" });
        return;
      }
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      if (end < start) {
        res.status(400).json({ error: "Аяқтау күні бастау күнінен кіші болмауы керек" });
        return;
      }
      const dates = [];
      for (let d = new Date(start); d <= end && dates.length < 90; d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }
      const label = statusToLabel(status);
      const role = employee.role || "Қызметкер";
      const stamp = new Date().toISOString();
      const changed = dates.map((d) => ({
        date: d, employeeId, name: employee.name, role, label, time: "",
        updatedAt: stamp, checkInTime: "", checkOutTime: "", lateMinutes: 0, earlyMinutes: 0,
      }));
      await upsertAttendance(changed);
      await appendHistory([{
        at: stamp, action: "Аралық белгі", employeeId, name: employee.name,
        date: `${startDate}…${endDate}`, oldLabel: "", newLabel: `${label} (${dates.length} күн)`,
      }]);
      invalidateStoreCache();
      const fresh = await loadStore();
      await rebuildSummary(fresh);
      res.status(200).json(publicState(fresh));
      return;
    }

    // Әкімші нақты Кіру/Шығу уақытын қолмен түзетеді (мыс. бұзылған жазбаны).
    if (action === "set-times") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee) {
        res.status(400).json({ error: "Күн немесе қызметкер ID қате" });
        return;
      }
      assertNotFutureDate(date);
      const checkInTime = String(body.checkInTime || "").trim();
      const checkOutTime = String(body.checkOutTime || "").trim();
      const timeRe = /^\d{1,2}:\d{2}$/;
      if (checkInTime && !timeRe.test(checkInTime)) {
        res.status(400).json({ error: "Кіру уақыты қате (мыс. 09:00)" });
        return;
      }
      if (checkOutTime && !timeRe.test(checkOutTime)) {
        res.status(400).json({ error: "Шығу уақыты қате (мыс. 18:00)" });
        return;
      }
      if (checkInTime && checkOutTime && timeToMinutes(checkOutTime) <= timeToMinutes(checkInTime)) {
        res.status(400).json({ error: "Шығу уақыты Кіруден кейін болуы керек" });
        return;
      }
      const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
      const inTotal = timeToMinutes(checkInTime);
      const lateMinutes = checkInTime && inTotal > 9 * 60 ? inTotal - 9 * 60 : 0;
      const outTotal = timeToMinutes(checkOutTime);
      const earlyMinutes = checkOutTime && outTotal < WORK_END_HOUR * 60 ? WORK_END_HOUR * 60 - outTotal : 0;
      // Кіру қойылса — күн «Жұмыста» болады (бар белгіні сақтаймыз: жарты күн т.б.).
      const label = (existing?.label && existing.label !== "Жоқ" && existing.label !== "Демалыс")
        ? existing.label
        : (checkInTime ? statusToLabel("present") : (existing?.label || ""));
      await upsertAttendance([{
        date,
        employeeId,
        name: employee.name,
        role: employee.role || "Қызметкер",
        label,
        time: checkInTime || existing?.time || "",
        updatedAt: new Date().toISOString(),
        checkInTime,
        checkOutTime,
        lateMinutes,
        earlyMinutes,
      }]);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Уақыт түзетілді",
        employeeId,
        name: employee.name,
        date,
        oldLabel: existing ? `Кіру: ${existing.checkInTime || "—"} / Шығу: ${existing.checkOutTime || "—"}` : "",
        newLabel: `Кіру: ${checkInTime || "—"} / Шығу: ${checkOutTime || "—"}`,
      }]);
      invalidateStoreCache();
      const fresh = await loadStore();
      await rebuildSummary(fresh);
      res.status(200).json(publicState(fresh));
      return;
    }

    if (action === "checkout") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee) {
        res.status(400).json({ error: "Күн немесе қызметкер ID қате" });
        return;
      }
      const checkOutTime = String(body.checkOutTime || "");
      let earlyMinutes = Number(body.earlyMinutes);
      if (!Number.isFinite(earlyMinutes)) {
        const total = timeToMinutes(checkOutTime);
        earlyMinutes = total > 0 && total < WORK_END_HOUR * 60 ? WORK_END_HOUR * 60 - total : 0;
      }
      const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
      if (!existing) {
        res.status(400).json({ error: "Бүгінгі кіру белгісі табылмады" });
        return;
      }

      // Белгі сол күйінде қалады — қысқа жұмыс күні нақты сағатпен есепке алынады.
      const newLabel = existing.label;

      await upsertAttendance([{
        ...existing,
        label: newLabel,
        checkOutTime,
        earlyMinutes,
        updatedAt: new Date().toISOString(),
      }]);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Шығу белгіленді",
        employeeId,
        name: employee.name,
        date,
        oldLabel: existing.label,
        newLabel: `Шығу: ${checkOutTime}${earlyMinutes > 0 ? ` (${earlyMinutes} мин ерте)` : ""}${newLabel !== existing.label ? ` [${newLabel}]` : ""}`,
      }]);
      invalidateStoreCache();
      const fresh = await loadStore();
      await rebuildSummary(fresh);
      res.status(200).json(publicState(fresh));
      return;
    }

    let status = String(body.status || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employee || !STATUSES[status]) {
      res.status(400).json({ error: "Күн, қызметкер немесе статус қате" });
      return;
    }
    assertNotFutureDate(date);

    const existing = [...store.attendance].reverse().find((row) => row.date === date && row.employeeId === employeeId);
    const oldLabel = existing?.label || "";
    const role = employee.role || "Қызметкер";
    const now = currentTime();
    const isNewCheckIn = !existing && status === "present" && date === todayDate();
    const label = statusToLabel(status);

    // Keep only one record per employee per day so changing a mistaken mark really replaces it.
    const newCheckIn = existing?.checkInTime || ((status === "present" || status === "half") ? now : "");
    let lateMin = existing?.lateMinutes || 0;
    if (isNewCheckIn) {
      const total = timeToMinutes(now);
      lateMin = total > 9 * 60 ? total - 9 * 60 : 0;
    }
    await upsertAttendance([{
      date,
      employeeId,
      name: employee.name,
      role,
      label,
      time: now,
      updatedAt: new Date().toISOString(),
      checkInTime: newCheckIn,
      checkOutTime: existing?.checkOutTime || "",
      lateMinutes: lateMin,
      earlyMinutes: existing?.earlyMinutes || 0,
    }]);
    await appendHistory([{
      at: new Date().toISOString(),
      action: oldLabel ? "Белгі өзгерді" : "Белгі қойылды",
      employeeId,
      name: employee.name,
      date,
      oldLabel,
      newLabel: label,
    }]);
    invalidateStoreCache();
    const freshStore = await loadStore();
    await rebuildSummary(freshStore);
    res.status(200).json(publicState(freshStore));
  } catch (error) {
    res.status(500).json({ error: `Белгі сақталмады: ${error.message}` });
  }
}
