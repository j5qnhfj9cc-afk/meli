// =====================
// 1) CONFIG
// =====================
const TZ = "America/Argentina/Mendoza";

// TU HORARIO (mantén HH:MM con 0 a la izquierda)
const SCHEDULE = [
  { day: 1, start: "08:00", end: "10:00", course: "Ingles", room: "Ambiente 1" },
  { day: 1, start: "10:30", end: "12:45", course: "Comunicación de datos", room: "Ambiente 1" },
  { day: 2, start: "08:00", end: "10:15", course: "Economía", room: "Ambiente 1"},
  { day: 2, start: "16:00", end: "19:00", course: "Bases de datos", room: "Ambiente 1"},
  { day: 3, start: "08:00", end: "12:45", course: "Diseño de sistemas de información", room: "Ambiente 1" },
  { day: 3, start: "16:00", end: "19:00", course: "Desarrollo de software", room: "Ambiente 1" },
  { day: 4, start: "08:00", end: "11:15", course: "Análisis numérico", room: "Ambiente 1" },
  { day: 5, start: "08:00", end: "10:00", course: "Ingles", room: "Ambiente 1" },
  { day: 5, start: "10:30", end: "12:45", course: "Economía", room: "Ambiente 1" },
];

// ✅ REUNIONES (mantén HH:MM con 0 a la izquierda)
const MEETINGS = [
  // Ejemplos (edita)
  { day: 2, start: "20:30", end: "22:15", title: "Reunión", place: "Salón" },
  { day: 0, start: "09:30", end: "11:15", title: "Reunión", place: "Salón" },
];

// ✅ Fuente de parciales (JSON) desde tu Worker (URL completa con https)
const EXAMS_URL = "https://horarios-elu.cgyrqz7mnn.workers.dev/";

// Fallback si falla el fetch (opcional)
const EXAMS_FALLBACK = [
  // { date: "2026-03-12", title: "Parcial Economía", note: "Unidades 1-3" },
];

// =====================
// 2) UTILIDADES DE TIEMPO
// =====================
function toMinutes(hhmm){
  const [h,m] = hhmm.split(":").map(Number);
  return h*60 + m;
}

function ymdInTZ(date = new Date()){
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit"
  }).format(date);
}

function nowPartsInTZ(){
  const dt = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour:"2-digit", minute:"2-digit", hour12:false
  }).formatToParts(dt);

  const hour = Number(parts.find(p => p.type === "hour")?.value);
  const minute = Number(parts.find(p => p.type === "minute")?.value);

  const [y, mo, da] = ymdInTZ(dt).split("-").map(Number);
  const day = new Date(y, mo - 1, da).getDay(); // 0..6
  return { day, minutes: hour*60 + minute, y, mo, da };
}

function daysUntil(dateStr){
  const todayStr = ymdInTZ(new Date());
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const [ey, em, ed] = dateStr.split("-").map(Number);

  const today = new Date(ty, tm-1, td);
  const exam = new Date(ey, em-1, ed);

  const ms = exam.getTime() - today.getTime();
  return Math.ceil(ms / (1000*60*60*24));
}

function dayName(d){
  return ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][d];
}

// =====================
// 3) ESTADO: REUNIÓN / CLASE / LIBRE
// =====================
function currentClass(){
  const { day, minutes } = nowPartsInTZ();
  return SCHEDULE.find(s =>
    s.day === day &&
    minutes >= toMinutes(s.start) &&
    minutes < toMinutes(s.end)
  ) || null;
}

function currentMeeting(){
  const { day, minutes } = nowPartsInTZ();
  return MEETINGS.find(m =>
    m.day === day &&
    minutes >= toMinutes(m.start) &&
    minutes < toMinutes(m.end)
  ) || null;
}

function tickStatus(){
  const status = document.getElementById("status");
  if (!status) return;

  const m = currentMeeting();
  if (m){
    status.className = "status in";
    status.textContent = `🤵🏻‍♂️ Estoy en reunión: ${m.title} (${m.start}–${m.end})`;
    return;
  }

  const c = currentClass();
  if (c){
    status.className = "status in";
    status.textContent = `📖 Estoy en clases: ${c.course} (${c.start}–${c.end})`;
  } else {
    status.className = "status out";
    status.textContent = "✅ Estoy libre";
  }
}

// =====================
// 4) RENDER HORARIO + REUNIONES
// =====================
function renderSchedule(){
  const tbody = document.querySelector("#table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...SCHEDULE].sort((a,b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start));
  for (const s of sorted){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dayName(s.day)}</td>
      <td>${s.start}–${s.end}</td>
      <td>${s.course}</td>
      <td>${s.room || "-"}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderMeetings(){
  const tbody = document.querySelector("#meetingsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!MEETINGS.length){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" style="opacity:.7;">No hay reuniones cargadas.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const sorted = [...MEETINGS].sort((a,b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start));
  for (const m of sorted){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dayName(m.day)}</td>
      <td>${m.start}–${m.end}</td>
      <td>${m.title}</td>
      <td>${m.place || "-"}</td>
    `;
    tbody.appendChild(tr);
  }
}

// =====================
// 5) PARCIALES: CARGA + PRÓXIMO + CALENDARIO MENSUAL
// =====================
let EXAMS = [];
let viewYear = null;
let viewMonth = null; // 1..12

async function loadExams(){
  if (EXAMS_URL){
    const url = EXAMS_URL + (EXAMS_URL.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar EXAMS_URL");
    const data = await res.json();
    EXAMS = Array.isArray(data) ? data : [];
  } else {
    EXAMS = EXAMS_FALLBACK;
  }

  EXAMS = EXAMS
    .filter(e => e && typeof e.date === "string" && e.date.length === 10)
    .map(e => ({ date: e.date, title: e.title || "Examen", note: e.note || "" }))
    .sort((a,b) => a.date.localeCompare(b.date));
}

function getNextExam(){
  const today = ymdInTZ(new Date());
  return EXAMS.find(e => e.date >= today) || null;
}

function renderNextExam(){
  const box = document.getElementById("nextExam");
  const meta = document.getElementById("nextExamMeta");
  if (!box || !meta) return;

  const next = getNextExam();
  if (!next){
    box.textContent = "No hay parciales cargados";
    meta.textContent = "Agrega parciales en tu calendario y se verán aquí.";
    return;
  }

  const d = daysUntil(next.date);
  box.textContent = d === 0
    ? `📌 Hoy: ${next.title}`
    : `⏳ Faltan ${d} día${d===1?"":"s"} para: ${next.title}`;

  meta.textContent = `${next.date}${next.note ? " — " + next.note : ""}`;
}

function examsByDateMap(){
  const map = new Map();
  for (const e of EXAMS){
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

function renderCalendar(year, month){
  const title = document.getElementById("calMonthTitle");
  const body = document.getElementById("calendarBody");
  if (!title || !body) return;

  const monthName = new Intl.DateTimeFormat("es-AR", { month:"long" })
    .format(new Date(year, month-1, 1));
  title.textContent = `${monthName[0].toUpperCase() + monthName.slice(1)} ${year}`;

  body.innerHTML = "";

  const map = examsByDateMap();

  const first = new Date(year, month-1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysPrevMonth = new Date(year, month-1, 0).getDate();

  let cell = 0;

  for (let week = 0; week < 6; week++){
    const tr = document.createElement("tr");

    for (let dow = 0; dow < 7; dow++){
      const td = document.createElement("td");

      let d, m = month, y = year;
      let isOtherMonth = false;

      if (cell < startDow) {
        d = daysPrevMonth - (startDow - 1 - cell);
        m = month - 1; y = year;
        if (m === 0){ m = 12; y--; }
        isOtherMonth = true;
      } else if (cell >= startDow + daysInMonth) {
        d = cell - (startDow + daysInMonth) + 1;
        m = month + 1; y = year;
        if (m === 13){ m = 1; y++; }
        isOtherMonth = true;
      } else {
        d = cell - startDow + 1;
      }

      const dd = String(d).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const dateStr = `${y}-${mm}-${dd}`;
      const items = map.get(dateStr) || [];

      const faded = isOtherMonth ? ' style="opacity:.45"' : "";
      td.innerHTML =
        `<div class="daynum"${faded}>${d}</div>` +
        items.map(e => `<span class="chip">📘 ${escapeHtml(e.title)}</span>`).join("");

      tr.appendChild(td);
      cell++;
    }

    body.appendChild(tr);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function initCalendarNav(){
  const prev = document.getElementById("prevMonth");
  const next = document.getElementById("nextMonth");

  const { y, mo } = nowPartsInTZ();
  viewYear = y;
  viewMonth = mo;

  const rerender = () => renderCalendar(viewYear, viewMonth);

  if (prev) prev.addEventListener("click", () => {
    viewMonth--;
    if (viewMonth === 0){ viewMonth = 12; viewYear--; }
    rerender();
  });

  if (next) next.addEventListener("click", () => {
    viewMonth++;
    if (viewMonth === 13){ viewMonth = 1; viewYear++; }
    rerender();
  });

  rerender();
}

// =====================
// 6) TEMA OSCURO
// =====================
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = theme === "dark" ? "☀️ Claro" : "🌙 Oscuro";
}

function initTheme(){
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  const btn = document.getElementById("themeBtn");
  if (btn){
    btn.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }
}

// =====================
// 7) START
// =====================
(async function start(){
  initTheme();

  renderSchedule();
  renderMeetings();

  tickStatus();
  setInterval(tickStatus, 30_000);

  try {
    await loadExams();
  } catch (e) {
    EXAMS = EXAMS_FALLBACK;
  }

  renderNextExam();
  initCalendarNav();

  setInterval(renderNextExam, 60_000);
})();
