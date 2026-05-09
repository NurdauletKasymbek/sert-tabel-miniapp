import { appendHistory, assertNotFutureDate, currentTime, loadStore, publicState, rebuildSummary, saveAttendance, statusToLabel, todayDate, STATUSES } from "./_lib/sheets.js";

const HALF_DAY_AFTER_HOUR = 12;
const HALF_DAY_THRESHOLD_HOURS = 4.5;
const WORK_END_HOUR = 18;

function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = String(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = await loadStore();
    const action = String(body.action || "").toLowerCase();

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
      let outsideDistance = 0;
      if (Number.isFinite(wLat) && Number.isFinite(wLon)) {
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
        const checkInHour = Number(now.split(":")[0] || 0);
        const checkInTotal = timeToMinutes(now);
        const lateMin = checkInTotal > 9 * 60 ? checkInTotal - 9 * 60 : 0;
        const status = checkInHour >= HALF_DAY_AFTER_HOUR ? "half" : "present";
        const label = statusToLabel(status);

        store.attendance = store.attendance.filter(
          (row) => !(row.date === wToday && row.employeeId === wEmployee.id),
        );
        store.attendance.push({
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
        });

        await saveAttendance(store.attendance);
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
      const workedMinutes = checkOutTotal - timeToMinutes(wExisting.checkInTime);
      let newLabel = wExisting.label;
      if (workedMinutes > 0 && workedMinutes < HALF_DAY_THRESHOLD_HOURS * 60 && wExisting.label === "Жұмыста") {
        newLabel = "Жарты күн";
      }

      store.attendance = store.attendance.filter(
        (row) => !(row.date === wToday && row.employeeId === wEmployee.id),
      );
      store.attendance.push({
        ...wExisting,
        label: newLabel,
        checkOutTime: now,
        earlyMinutes: earlyMin,
        updatedAt: new Date().toISOString(),
      });

      await saveAttendance(store.attendance);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Шығу белгіленді",
        employeeId: wEmployee.id,
        name: wEmployee.name,
        date: wToday,
        oldLabel: wExisting.label,
        newLabel: `Шығу: ${now}${earlyMin ? ` (${earlyMin} мин ерте)` : ""}`,
      }]);
      await rebuildSummary({ ...store });

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

      let newLabel = existing.label;
      if (existing.checkInTime && checkOutTime) {
        const workedMinutes = timeToMinutes(checkOutTime) - timeToMinutes(existing.checkInTime);
        if (workedMinutes > 0 && workedMinutes < HALF_DAY_THRESHOLD_HOURS * 60 && existing.label === "Жұмыста") {
          newLabel = "Жарты күн";
        }
      }

      store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
      store.attendance.push({
        ...existing,
        label: newLabel,
        checkOutTime,
        earlyMinutes,
        updatedAt: new Date().toISOString(),
      });
      await saveAttendance(store.attendance);
      await appendHistory([{
        at: new Date().toISOString(),
        action: "Шығу белгіленді",
        employeeId,
        name: employee.name,
        date,
        oldLabel: existing.label,
        newLabel: `Шығу: ${checkOutTime}${earlyMinutes > 0 ? ` (${earlyMinutes} мин ерте)` : ""}${newLabel !== existing.label ? ` [${newLabel}]` : ""}`,
      }]);
      await rebuildSummary({ ...store });
      res.status(200).json(publicState(store));
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

    if (isNewCheckIn) {
      const checkInHour = Number(now.split(":")[0] || 0);
      if (checkInHour >= HALF_DAY_AFTER_HOUR) {
        status = "half";
      }
    }
    const label = statusToLabel(status);

    // Keep only one record per employee per day so changing a mistaken mark really replaces it.
    store.attendance = store.attendance.filter((row) => !(row.date === date && row.employeeId === employeeId));
    const newCheckIn = existing?.checkInTime || ((status === "present" || status === "half") ? now : "");
    let lateMin = existing?.lateMinutes || 0;
    if (isNewCheckIn) {
      const total = timeToMinutes(now);
      lateMin = total > 9 * 60 ? total - 9 * 60 : 0;
    }
    store.attendance.push({
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
    });

    await saveAttendance(store.attendance);
    await appendHistory([{
      at: new Date().toISOString(),
      action: oldLabel ? "Белгі өзгерді" : "Белгі қойылды",
      employeeId,
      name: employee.name,
      date,
      oldLabel,
      newLabel: label,
    }]);
    await rebuildSummary(store);
    res.status(200).json(publicState(store));
  } catch (error) {
    res.status(500).json({ error: `Белгі сақталмады: ${error.message}` });
  }
}
