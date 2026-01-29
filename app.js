// app.js — Nexus Transport (Firestore, PIN, páginas + Caja + PWA) + Admin/Empleado + Conductores dinámicos
// Adaptación: entrada principal = Millas recorridas (miles * ratePerMile) + extras

/* ========== CONFIG FIREBASE ========== */
const firebaseConfig = {
  apiKey: "AIzaSyDGoSNKi1wapE1SpHxTc8wNZGGkJ2nQj7s",
  authDomain: "nexus-transport-2887b.firebaseapp.com",
  projectId: "nexus-transport-2887b",
  storageBucket: "nexus-transport-2887b.firebasestorage.app",
  messagingSenderId: "972915419764",
  appId: "1:972915419764:web:7d61dfb03bbe56df867f21"
};


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

/* ========== ESTADO LOCAL ========== */
const LOCAL_KEY = "nexus_transport_state_v1";

let state = {
  // PIN maestro (admin)
  pin: "058312",

  // Sesión local (rol)
  session: {
    role: null,       // "admin" | "employee"
    employeeName: "", // si es empleado
    techName: ""      // conductor asociado (mantenemos techName para no reescribir mucho)
  },

  appName: "Nexus Transport",
  logoUrl: "",
  pdfHeaderText: "",
  pdfFooterText: "",
  footerText: "© 2025 Nexus Transport — Sistema de servicios",

  tickets: [],

  // Conductores/usuarios (editable en Config)
  // Cada conductor tiene pin de empleado + % comisión
  staff: [
    { name: "Cynthia", pin: "1111", rate: 40 },
    { name: "Carmen",  pin: "2222", rate: 35 },
    { name: "Yerika",  pin: "3333", rate: 35 }
  ],
  defaultRate: 30,

  user: null,
  unsubscribeTickets: null
};

let currentEditingNumber = null;

/* ========== STORAGE ==========
   Guardamos todo excepto auth listener */
function loadState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };

      if (!Array.isArray(state.staff) || !state.staff.length) {
        state.staff = [
          { name: "Cynthia", pin: "1111", rate: 40 },
          { name: "Carmen",  pin: "2222", rate: 35 },
          { name: "Yerika",  pin: "3333", rate: 35 }
        ];
      }
      if (!state.session) state.session = { role: null, employeeName: "", techName: "" };
      if (state.defaultRate == null) state.defaultRate = 30;
    }
  } catch (e) {
    console.error("Error leyendo localStorage", e);
  }
}

function saveState() {
  const copy = { ...state };
  delete copy.user;
  delete copy.unsubscribeTickets;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

/* ========== FIRESTORE: REFERENCIAS COMPARTIDAS ========== */
function ticketsCollectionRef() {
  // ✅ cambio de colección: antes "salonTickets"
  return db.collection("transportTrips");
}
function brandingDocRef() {
  // Puedes mantener branding/salon si ya lo tienes, o separarlo:
  // return db.collection("branding").doc("transport");
  return db.collection("branding").doc("transport");
}

/* ========== DOM ========== */
const pinScreen = document.getElementById("pinScreen");
const authScreen = document.getElementById("authScreen");
const appShell = document.getElementById("appShell");

// PIN Admin
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const pinEnterBtn = document.getElementById("pinEnterBtn");

// PIN Empleado
const empNameInput = document.getElementById("empNameInput");
const empPinInput = document.getElementById("empPinInput");
const empEnterBtn = document.getElementById("empEnterBtn");

// Auth
const googleSignInBtn = document.getElementById("googleSignInBtn");
const authBackToPinBtn = document.getElementById("authBackToPinBtn");

// nav / topbar
const appNameEditable = document.getElementById("appNameEditable");
const pinAppNameTitle = document.getElementById("pinAppName");
const userEmailSpan = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const appLogoImg = document.getElementById("appLogo");
const pinLogoImg = document.getElementById("pinLogo");
const footerTextSpan = document.getElementById("footerText");
const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const sessionSubtitle = document.getElementById("sessionSubtitle");

const pages = {
  dashboard: document.getElementById("page-dashboard"),
  historial: document.getElementById("page-historial"),
  caja: document.getElementById("page-caja"),
  config: document.getElementById("page-config"),
  comisiones: document.getElementById("page-comisiones"),
  propinas: document.getElementById("page-propinas"),
  retenciones: document.getElementById("page-retenciones")
};

// dashboard form
const ticketNumberInput = document.getElementById("ticketNumber");
const ticketDateInput = document.getElementById("ticketDate");
const clientNameInput = document.getElementById("clientName");
const technicianSelect = document.getElementById("technician");          // (UI puede decir Conductor)
const technicianCustomInput = document.getElementById("technicianCustom");
const paymentMethodSelect = document.getElementById("paymentMethod");
const serviceDescInput = document.getElementById("serviceDesc");

// ✅ NUEVO: inputs transporte
const milesInput = document.getElementById("miles");
const ratePerMileInput = document.getElementById("ratePerMile");

// Mantenemos tipAmountInput pero lo tratamos como "extras" (peajes, parking, etc.)
const tipAmountInput = document.getElementById("tipAmount");
const totalAmountInput = document.getElementById("totalAmount");

const newTicketBtn = document.getElementById("newTicketBtn");
const saveTicketBtn = document.getElementById("saveTicketBtn");
const formMessage = document.getElementById("formMessage");

// historial
const ticketsTableBody = document.getElementById("ticketsTableBody");
const filterStartInput = document.getElementById("filterStart");
const filterEndInput = document.getElementById("filterEnd");
const filterTechSelect = document.getElementById("filterTech");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const backupJsonBtn = document.getElementById("backupJsonBtn");

// config
const logoUrlInput = document.getElementById("logoUrlInput");
const pdfHeaderTextArea = document.getElementById("pdfHeaderText");
const pdfFooterTextArea = document.getElementById("pdfFooterText");
const footerTextInput = document.getElementById("footerTextInput");
const newPinInput = document.getElementById("newPinInput");
const changePinBtn = document.getElementById("changePinBtn");
const pinChangeMessage = document.getElementById("pinChangeMessage");
const saveBrandingBtn = document.getElementById("saveBrandingBtn");
const brandingStatus = document.getElementById("brandingStatus");

// admin area (config)
const adminArea = document.getElementById("adminArea");
const staffNameInput = document.getElementById("staffNameInput");
const staffRateInput = document.getElementById("staffRateInput");
const staffPinInput = document.getElementById("staffPinInput");
const addStaffBtn = document.getElementById("addStaffBtn");
const resetStaffBtn = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

// caja
const cajaStartInput = document.getElementById("cajaStart");
const cajaEndInput = document.getElementById("cajaEnd");
const cajaApplyBtn = document.getElementById("cajaApplyBtn");
const cajaClearBtn = document.getElementById("cajaClearBtn");
const cajaTotalCashSpan = document.getElementById("cajaTotalCash");
const cajaTotalAthSpan = document.getElementById("cajaTotalAth");
const cajaTotalCardSpan = document.getElementById("cajaTotalCard");
const cajaTotalAllSpan = document.getElementById("cajaTotalAll");

// comisiones
const comiStartInput = document.getElementById("comiStart");
const comiEndInput = document.getElementById("comiEnd");
const comiTechSelect = document.getElementById("comiTech");
const comiApplyBtn = document.getElementById("comiApplyBtn");
const comiClearBtn = document.getElementById("comiClearBtn");
const comiTableBody = document.getElementById("comiTableBody");
const comiTotalSpan = document.getElementById("comiTotal");

// propinas (ahora serán "extras", pero no cambiamos ids)
const tipsStartInput = document.getElementById("tipsStart");
const tipsEndInput = document.getElementById("tipsEnd");
const tipsTechSelect = document.getElementById("tipsTech");
const tipsGroupSelect = document.getElementById("tipsGroup");
const tipsApplyBtn = document.getElementById("tipsApplyBtn");
const tipsClearBtn = document.getElementById("tipsClearBtn");
const tipsTableBody = document.getElementById("tipsTableBody");
const tipsTotalSpan = document.getElementById("tipsTotal");

// retenciones
const retenStartInput = document.getElementById("retenStart");
const retenEndInput = document.getElementById("retenEnd");
const retenTechSelect = document.getElementById("retenTech");
const retenApplyBtn = document.getElementById("retenApplyBtn");
const retenClearBtn = document.getElementById("retenClearBtn");
const retenTableBody = document.getElementById("retenTableBody");
const retenTotalSpan = document.getElementById("retenTotal");

// botón PDF retenciones
const retenPdfBtn = document.getElementById("retenPdfBtn");

/* ========== ROLE / PERMISOS ========== */
function isAdmin() {
  return state.session?.role === "admin";
}
function isEmployee() {
  return state.session?.role === "employee";
}

/* ========== STAFF DINÁMICO ========== */
function normalizeName(s) {
  return String(s || "").trim();
}
function staffNames() {
  return (state.staff || []).map(x => x.name).filter(Boolean);
}
function findStaffByName(name) {
  const n = normalizeName(name).toLowerCase();
  return (state.staff || []).find(s => normalizeName(s.name).toLowerCase() === n) || null;
}
function getCommissionRateForTech(tech) {
  const rec = findStaffByName(tech);
  if (rec && rec.rate != null) return Number(rec.rate) || 0;
  return Number(state.defaultRate) || 0;
}

/* ========== SELECTS: construir opciones ==========
   - Admin: todas + "Seleccionar..."
   - Empleado: solo su conductor */
function fillTechSelect(selectEl, { includeAll = false, includeEmpty = false } = {}) {
  if (!selectEl) return;
  const current = selectEl.value;

  selectEl.innerHTML = "";

  if (includeEmpty) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Seleccionar...";
    selectEl.appendChild(opt);
  }

  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Todos";
    selectEl.appendChild(opt);
  }

  const names = staffNames();

  if (isEmployee()) {
    const only = state.session.techName;
    const opt = document.createElement("option");
    opt.value = only;
    opt.textContent = only;
    selectEl.appendChild(opt);
    selectEl.value = only;
    return;
  }

  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });

  if (Array.from(selectEl.options).some(o => o.value === current)) {
    selectEl.value = current;
  }
}

function refreshAllTechSelects() {
  fillTechSelect(technicianSelect, { includeEmpty: true });
  fillTechSelect(filterTechSelect, { includeAll: true });
  fillTechSelect(comiTechSelect, { includeAll: true });
  fillTechSelect(tipsTechSelect, { includeAll: true });
  fillTechSelect(retenTechSelect, { includeAll: true });
}

/* ========== UI por rol ========== */
function applyRoleUI() {
  const adminEls = Array.from(document.querySelectorAll(".nav-admin"));
  const adminNavBtns = Array.from(document.querySelectorAll(".nav-btn.nav-admin"));

  if (isAdmin()) {
    adminEls.forEach(el => (el.style.display = ""));
    adminNavBtns.forEach(btn => (btn.style.display = ""));
    if (technicianCustomInput) {
      technicianCustomInput.disabled = false;
      technicianCustomInput.placeholder = "Otro conductor (opcional)";
    }
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — control total";
    if (adminArea) adminArea.style.display = "";
  } else {
    adminEls.forEach(el => (el.style.display = "none"));
    adminNavBtns.forEach(btn => (btn.style.display = "none"));

    if (technicianCustomInput) {
      technicianCustomInput.value = "";
      technicianCustomInput.disabled = true;
      technicianCustomInput.placeholder = "Solo admin";
    }
    if (sessionSubtitle) sessionSubtitle.textContent =
      `Empleado: ${state.session.employeeName} — Conductor: ${state.session.techName}`;
    if (adminArea) adminArea.style.display = "none";

    const allowed = ["dashboard", "historial"];
    const active = Object.keys(pages).find(k => pages[k].classList.contains("active-page")) || "dashboard";
    if (!allowed.includes(active)) setActivePage("dashboard");
  }

  refreshAllTechSelects();
}

/* ========== HELPERS ==========
   comisión SOLO sobre base (millas × tarifa). NO incluye extras */
function serviceSubtotal(t) {
  const miles = Number(t.miles || 0);
  const rate = Number(t.ratePerMile || 0);
  const base = miles * rate;
  return isFinite(base) ? base : 0;
}

/* ========== RENDER (branding + tickets + caja) ========== */
function renderBranding() {
  appNameEditable.textContent = state.appName || "Nexus Transport";
  pinAppNameTitle.textContent = state.appName || "Nexus Transport";

  logoUrlInput.value = state.logoUrl || "";
  pdfHeaderTextArea.value = state.pdfHeaderText || "";
  pdfFooterTextArea.value = state.pdfFooterText || "";
  footerTextInput.value = state.footerText || "© 2025 Nexus Transport — Sistema de servicios";
  footerTextSpan.textContent = state.footerText || "© 2025 Nexus Transport — Sistema de servicios";

  const logoSrc = state.logoUrl && state.logoUrl.trim() !== "" ? state.logoUrl.trim() : "assets/logo.png";
  appLogoImg.src = logoSrc;
  pinLogoImg.src = logoSrc;
}

function nextTicketNumber() {
  if (!state.tickets.length) return 1;
  const max = state.tickets.reduce((m, t) => Math.max(m, Number(t.number || 0)), 0);
  return max + 1;
}

function renderTicketNumber() {
  ticketNumberInput.value = nextTicketNumber();
}

/* ========== FILTRO POR EMPLEADO ==========
   Empleado solo ve sus tickets */
function roleFilteredTickets(list) {
  if (!isEmployee()) return list;
  const tech = state.session.techName;
  return (list || []).filter(t => (t.technician || "") === tech);
}

/* Historial */
function renderTicketsTable(listOverride) {
  const base = listOverride || state.tickets;
  const list = roleFilteredTickets(base);

  ticketsTableBody.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.number || ""}</td>
        <td>${t.date || ""}</td>
        <td>${t.clientName || ""}</td>
        <td>${t.technician || ""}</td>
        <td>${t.serviceDesc || ""}</td>
        <td>${t.paymentMethod || ""}</td>
        <td>$${Number(t.totalAmount || 0).toFixed(2)}</td>
        <td class="nav-admin">
          <button class="btn-table edit" data-action="edit" data-number="${t.number}">Editar</button>
          <button class="btn-table delete" data-action="delete" data-number="${t.number}">X</button>
        </td>
      `;
      ticketsTableBody.appendChild(tr);
    });
}

/* CAJA: totales por método (solo admin) */
function computeCajaTotals() {
  if (!isAdmin()) return;

  const start = cajaStartInput.value;
  const end = cajaEndInput.value;

  let efectivo = 0, ath = 0, tarjeta = 0;

  state.tickets.forEach((t) => {
    if (!t.date) return;
    if (start && t.date < start) return;
    if (end && t.date > end) return;

    const total = Number(t.totalAmount || 0);
    if (t.paymentMethod === "Efectivo") efectivo += total;
    else if (t.paymentMethod === "ATH Móvil") ath += total;
    else if (t.paymentMethod === "Tarjeta") tarjeta += total;
  });

  const all = efectivo + ath + tarjeta;

  cajaTotalCashSpan.textContent = `$${efectivo.toFixed(2)}`;
  cajaTotalAthSpan.textContent = `$${ath.toFixed(2)}`;
  cajaTotalCardSpan.textContent = `$${tarjeta.toFixed(2)}`;
  cajaTotalAllSpan.textContent = `$${all.toFixed(2)}`;
}

/* ========== COMISIONES ========== */
function getFilteredTicketsForCommissions() {
  if (!isAdmin()) return [];
  const start = comiStartInput ? comiStartInput.value : "";
  const end = comiEndInput ? comiEndInput.value : "";
  const tech = comiTechSelect ? comiTechSelect.value : "";

  return state.tickets.filter((t) => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (tech && t.technician !== tech) return false;
    return true;
  });
}

function renderCommissionsSummary() {
  if (!isAdmin()) return;
  if (!comiTableBody || !comiTotalSpan) return;

  let list = getFilteredTicketsForCommissions();
  const hasFilters =
    (comiStartInput && comiStartInput.value) ||
    (comiEndInput && comiEndInput.value) ||
    (comiTechSelect && comiTechSelect.value);

  if (!list.length && !hasFilters && state.tickets.length) list = state.tickets.slice();

  const byTech = {};
  let grandCommission = 0;

  list.forEach((t) => {
    const tech = t.technician || "Sin conductor";
    const base = serviceSubtotal(t); // base = miles*rate
    const rate = getCommissionRateForTech(tech);
    const commission = (base * rate) / 100;

    if (!byTech[tech]) byTech[tech] = { technician: tech, totalSales: 0, totalCommission: 0, rate };
    byTech[tech].totalSales += base;
    byTech[tech].totalCommission += commission;
    grandCommission += commission;
  });

  const rows = Object.values(byTech).sort((a, b) => a.technician.localeCompare(b.technician));
  comiTableBody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.technician}</td>
      <td>${row.rate.toFixed(1)}%</td>
      <td>$${row.totalSales.toFixed(2)}</td>
      <td>$${row.totalCommission.toFixed(2)}</td>
    `;
    comiTableBody.appendChild(tr);
  });

  comiTotalSpan.textContent = `$${grandCommission.toFixed(2)}`;
}

/* ========== "PROPINA" (ahora Extras) ==========
   mantenemos IDs para no romper HTML */
function getWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getFilteredTicketsForTips() {
  if (!isAdmin()) return [];
  const start = tipsStartInput ? tipsStartInput.value : "";
  const end = tipsEndInput ? tipsEndInput.value : "";
  const tech = tipsTechSelect ? tipsTechSelect.value : "";

  return state.tickets.filter((t) => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (tech && t.technician !== tech) return false;
    return true;
  });
}

function renderTipsSummary() {
  if (!isAdmin()) return;
  if (!tipsTableBody || !tipsTotalSpan) return;

  const group = (tipsGroupSelect && tipsGroupSelect.value) ? tipsGroupSelect.value : "tech";
  const list = getFilteredTicketsForTips();

  const map = new Map();
  let totalExtras = 0;

  list.forEach((t) => {
    const extras = Number(t.extras || t.tipAmount || 0);
    if (!extras) return;

    let key = "Sin grupo";
    if (group === "tech") key = t.technician || "Sin conductor";
    else if (group === "day") key = t.date || "Sin fecha";
    else if (group === "week") key = t.date ? getWeekKey(t.date) : "Sin semana";

    map.set(key, (map.get(key) || 0) + extras);
    totalExtras += extras;
  });

  const rows = Array.from(map.entries())
    .map(([k, v]) => ({ key: k, total: v }))
    .sort((a, b) => a.key.localeCompare(b.key));

  tipsTableBody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.key}</td><td>$${r.total.toFixed(2)}</td>`;
    tipsTableBody.appendChild(tr);
  });

  tipsTotalSpan.textContent = `$${totalExtras.toFixed(2)}`;
}

/* ========== RETENCIONES 10% (admin only) ==========
   Retención = 10% de la comisión */
function getFilteredTicketsForReten() {
  if (!isAdmin()) return [];
  const start = retenStartInput ? retenStartInput.value : "";
  const end = retenEndInput ? retenEndInput.value : "";
  const tech = retenTechSelect ? retenTechSelect.value : "";

  return state.tickets.filter((t) => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (tech && t.technician !== tech) return false;
    return true;
  });
}

function renderRetencionesSummary() {
  if (!isAdmin()) return;
  if (!retenTableBody || !retenTotalSpan) return;

  const list = getFilteredTicketsForReten();
  const byTech = {};
  let netGrand = 0;

  list.forEach((t) => {
    const tech = t.technician || "Sin conductor";
    const base = serviceSubtotal(t);
    const rate = getCommissionRateForTech(tech);
    const commission = (base * rate) / 100;
    const reten = commission * 0.10;
    const net = commission - reten;

    if (!byTech[tech]) {
      byTech[tech] = { technician: tech, base: 0, rate, commission: 0, reten: 0, net: 0 };
    }
    byTech[tech].base += base;
    byTech[tech].commission += commission;
    byTech[tech].reten += reten;
    byTech[tech].net += net;
    netGrand += net;
  });

  const rows = Object.values(byTech).sort((a, b) => a.technician.localeCompare(b.technician));
  retenTableBody.innerHTML = "";

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.technician}</td>
      <td>$${r.base.toFixed(2)}</td>
      <td>${(r.rate ?? getCommissionRateForTech(r.technician)).toFixed(1)}%</td>
      <td>$${r.commission.toFixed(2)}</td>
      <td>$${r.reten.toFixed(2)}</td>
      <td>$${r.net.toFixed(2)}</td>
    `;
    retenTableBody.appendChild(tr);
  });

  retenTotalSpan.textContent = `$${netGrand.toFixed(2)}`;
}

/* ========== PDF RETENCIONES (sin cambios de lógica, solo base = miles*rate) ==========
   (Tu función exportRetencionesPDF se mantiene casi igual; solo cambia textos "Técnica" si quieres) */
function exportRetencionesPDF() {
  if (!isAdmin()) return alert("Solo admin puede exportar PDF de retenciones.");

  const jsPDFLib = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFLib) return alert("La librería jsPDF no se cargó.");

  const list = getFilteredTicketsForReten();
  if (!list.length) return alert("No hay datos de retenciones con el filtro actual.");

  const start = (retenStartInput && retenStartInput.value) ? retenStartInput.value : "";
  const end = (retenEndInput && retenEndInput.value) ? retenEndInput.value : "";
  const techFilter = (retenTechSelect && retenTechSelect.value) ? retenTechSelect.value : "";

  const byTech = {};
  list.forEach((t) => {
    const tech = t.technician || "Sin conductor";
    const base = serviceSubtotal(t);
    const rate = getCommissionRateForTech(tech);
    const commission = (base * rate) / 100;
    const reten = commission * 0.10;
    const net = commission - reten;

    if (!byTech[tech]) byTech[tech] = { tech, base: 0, commission: 0, reten: 0, net: 0, rate, tickets: [] };
    byTech[tech].base += base;
    byTech[tech].commission += commission;
    byTech[tech].reten += reten;
    byTech[tech].net += net;
    byTech[tech].tickets.push(t);
  });

  const rows = Object.values(byTech).sort((a, b) => a.tech.localeCompare(b.tech));

  const doc = new jsPDFLib({ orientation: "p", unit: "mm", format: "a4" });
  const marginLeft = 12;
  let y = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(state.appName || "Nexus Transport", marginLeft, y);
  y += 6;

  doc.setFontSize(12);
  doc.text("Retenciones (10%) — Resumen por Conductor", marginLeft, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  if (state.pdfHeaderText) {
    const lines = doc.splitTextToSize(state.pdfHeaderText, 180);
    doc.text(lines, marginLeft, y);
    y += lines.length * 4 + 2;
  }

  const now = new Date();
  const rangeTxt = `Rango: ${start || "—"} a ${end || "—"}${techFilter ? ` | Conductor: ${techFilter}` : ""}`;
  doc.text(rangeTxt, marginLeft, y);
  y += 5;
  doc.text(`Generado: ${now.toLocaleString()}`, marginLeft, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.text("Conductor", marginLeft, y);
  doc.text("Base", marginLeft + 62, y, { align: "right" });
  doc.text("Comisión", marginLeft + 102, y, { align: "right" });
  doc.text("Ret 10%", marginLeft + 142, y, { align: "right" });
  doc.text("Neto", marginLeft + 188, y, { align: "right" });
  y += 4;

  doc.setFont("helvetica", "normal");

  let grandBase = 0, grandCom = 0, grandRet = 0, grandNet = 0;

  rows.forEach((r) => {
    if (y > 270) { doc.addPage(); y = 14; }

    grandBase += r.base;
    grandCom += r.commission;
    grandRet += r.reten;
    grandNet += r.net;

    doc.text(String(r.tech).substring(0, 22), marginLeft, y);
    doc.text(`$${r.base.toFixed(2)}`, marginLeft + 62, y, { align: "right" });
    doc.text(`$${r.commission.toFixed(2)}`, marginLeft + 102, y, { align: "right" });
    doc.text(`$${r.reten.toFixed(2)}`, marginLeft + 142, y, { align: "right" });
    doc.text(`$${r.net.toFixed(2)}`, marginLeft + 188, y, { align: "right" });
    y += 4;
  });

  y += 6;
  if (y > 270) { doc.addPage(); y = 14; }

  doc.setFont("helvetica", "bold");
  doc.text("TOTALES:", marginLeft, y);
  doc.text(`$${grandBase.toFixed(2)}`, marginLeft + 62, y, { align: "right" });
  doc.text(`$${grandCom.toFixed(2)}`, marginLeft + 102, y, { align: "right" });
  doc.text(`$${grandRet.toFixed(2)}`, marginLeft + 142, y, { align: "right" });
  doc.text(`$${grandNet.toFixed(2)}`, marginLeft + 188, y, { align: "right" });
  y += 8;

  if (techFilter && byTech[techFilter] && byTech[techFilter].tickets?.length) {
    doc.addPage();
    y = 14;

    const r = byTech[techFilter];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Detalle — ${techFilter}`, marginLeft, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`% Comisión: ${(getCommissionRateForTech(techFilter)).toFixed(1)}%`, marginLeft, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text("#", marginLeft, y);
    doc.text("Fecha", marginLeft + 12, y);
    doc.text("Cliente", marginLeft + 34, y);
    doc.text("Ruta", marginLeft + 78, y);
    doc.text("Base", marginLeft + 125, y, { align: "right" });
    doc.text("Comisión", marginLeft + 152, y, { align: "right" });
    doc.text("Ret", marginLeft + 172, y, { align: "right" });
    doc.text("Neto", marginLeft + 188, y, { align: "right" });
    y += 4;

    doc.setFont("helvetica", "normal");

    const ticketsSorted = r.tickets.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    ticketsSorted.forEach((t) => {
      if (y > 270) { doc.addPage(); y = 14; }

      const base = serviceSubtotal(t);
      const rate = getCommissionRateForTech(techFilter);
      const commission = (base * rate) / 100;
      const reten = commission * 0.10;
      const net = commission - reten;

      doc.text(String(t.number || ""), marginLeft, y);
      doc.text(String(t.date || ""), marginLeft + 12, y);
      doc.text(String(t.clientName || "").substring(0, 18), marginLeft + 34, y);
      doc.text(String(t.serviceDesc || "").substring(0, 20), marginLeft + 78, y);

      doc.text(`$${base.toFixed(2)}`, marginLeft + 125, y, { align: "right" });
      doc.text(`$${commission.toFixed(2)}`, marginLeft + 152, y, { align: "right" });
      doc.text(`$${reten.toFixed(2)}`, marginLeft + 172, y, { align: "right" });
      doc.text(`$${net.toFixed(2)}`, marginLeft + 188, y, { align: "right" });

      y += 4;
    });

    y += 8;
    if (y > 270) { doc.addPage(); y = 14; }

    doc.setFont("helvetica", "bold");
    doc.text("TOTAL CONDUCTOR:", marginLeft, y);
    doc.text(`$${r.base.toFixed(2)}`, marginLeft + 125, y, { align: "right" });
    doc.text(`$${r.commission.toFixed(2)}`, marginLeft + 152, y, { align: "right" });
    doc.text(`$${r.reten.toFixed(2)}`, marginLeft + 172, y, { align: "right" });
    doc.text(`$${r.net.toFixed(2)}`, marginLeft + 188, y, { align: "right" });
  }

  if (state.pdfFooterText) {
    const footerLines = doc.splitTextToSize(state.pdfFooterText, 180);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(footerLines, marginLeft, 288);
  }

  const fname = techFilter
    ? `retenciones-${techFilter}-${start || "all"}-${end || "all"}.pdf`
    : `retenciones-resumen-${start || "all"}-${end || "all"}.pdf`;

  doc.save(fname);
}

/* ========== VISTAS / PÁGINAS ========== */
function showPinScreen() {
  pinScreen.classList.remove("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.add("hidden");

  pinInput.value = "";
  if (empNameInput) empNameInput.value = "";
  if (empPinInput) empPinInput.value = "";
  pinError.textContent = "";
}

function showAuthScreen() {
  pinScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
}

function showAppShell() {
  pinScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function setActivePage(pageName) {
  if (isEmployee() && !["dashboard", "historial"].includes(pageName)) {
    pageName = "dashboard";
  }

  Object.keys(pages).forEach((name) => {
    pages[name].classList.toggle("active-page", name === pageName);
  });

  navButtons.forEach((btn) => {
    const target = btn.getAttribute("data-page");
    btn.classList.toggle("nav-btn-active", target === pageName);
  });

  if (pageName === "comisiones") renderCommissionsSummary();
  if (pageName === "propinas") renderTipsSummary();
  if (pageName === "retenciones") renderRetencionesSummary();
}

/* ========== LOGIN ==========
   Admin: pin maestro
   Empleado: nombre + pin */
function handleAdminPinEnter() {
  const v = (pinInput.value || "").trim();
  if (!v) return (pinError.textContent = "Ingrese el PIN admin.");
  if (v === state.pin) {
    state.session = { role: "admin", employeeName: "", techName: "" };
    saveState();
    pinError.textContent = "";
    showAuthScreen();
  } else {
    pinError.textContent = "PIN admin incorrecto.";
  }
}

function handleEmployeeEnter() {
  const name = normalizeName(empNameInput.value);
  const pin = String(empPinInput.value || "").trim();

  if (!name || !pin) {
    pinError.textContent = "Empleado: escribe Nombre y PIN.";
    return;
  }

  const rec = findStaffByName(name);
  if (!rec) {
    pinError.textContent = "Empleado no existe (crearlo en Configuración).";
    return;
  }
  if (String(rec.pin) !== pin) {
    pinError.textContent = "PIN de empleado incorrecto.";
    return;
  }

  state.session = { role: "employee", employeeName: rec.name, techName: rec.name };
  saveState();
  pinError.textContent = "";
  showAuthScreen();
}

/* ========== FIRESTORE LISTEN + AUTH ========== */
function startTicketsListener() {
  if (state.unsubscribeTickets) {
    state.unsubscribeTickets();
    state.unsubscribeTickets = null;
  }

  state.unsubscribeTickets = ticketsCollectionRef()
    .orderBy("number", "asc")
    .onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((doc) => arr.push(doc.data()));
        state.tickets = arr;
        saveState();

        renderTicketNumber();
        renderTicketsTable();
        computeCajaTotals();
        renderCommissionsSummary();
        renderTipsSummary();
        renderRetencionesSummary();
      },
      (err) => console.error("onSnapshot error", err)
    );
}

async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    state.user = result.user;
    userEmailSpan.textContent = state.user.email || "";
    saveState();

    await loadBrandingFromCloud();
    startTicketsListener();

    showAppShell();
    applyRoleUI();
    setActivePage("dashboard");
  } catch (err) {
    console.error("Error Google SignIn", err);
    alert("No se pudo iniciar sesión con Google.");
  }
}

async function signOutAndReset() {
  try { await auth.signOut(); } catch (e) { console.error("Error signOut", e); }

  if (state.unsubscribeTickets) {
    state.unsubscribeTickets();
    state.unsubscribeTickets = null;
  }

  state.user = null;
  userEmailSpan.textContent = "Sin conexión a Google";
  state.session = { role: null, employeeName: "", techName: "" };
  saveState();
  showPinScreen();
}

auth.onAuthStateChanged((user) => {
  state.user = user || null;
  if (user) {
    userEmailSpan.textContent = user.email || "";
    startTicketsListener();
  } else {
    userEmailSpan.textContent = "Sin conexión a Google";
    if (state.unsubscribeTickets) {
      state.unsubscribeTickets();
      state.unsubscribeTickets = null;
    }
  }
});

/* ========== DASHBOARD: TICKETS (Transporte) ========== */
function recalcTotal() {
  const miles = Number(milesInput?.value || 0);
  const rate = Number(ratePerMileInput?.value || 0);
  const extras = Number(tipAmountInput?.value || 0);

  const subtotal = miles * rate;
  const total = subtotal + extras;

  totalAmountInput.value = (isFinite(total) ? total : 0).toFixed(2);
}

function resetFormForNewTicket() {
  const today = new Date();
  ticketDateInput.value = today.toISOString().slice(0, 10);
  clientNameInput.value = "";

  if (isEmployee()) {
    technicianSelect.value = state.session.techName || "";
    technicianCustomInput.value = "";
  } else {
    technicianSelect.value = "";
    technicianCustomInput.value = "";
  }

  paymentMethodSelect.value = "";
  serviceDescInput.value = "";

  if (milesInput) milesInput.value = "";
  if (ratePerMileInput) ratePerMileInput.value = "";
  tipAmountInput.value = "";

  recalcTotal();

  ticketNumberInput.value = nextTicketNumber();
  formMessage.textContent = "";
  currentEditingNumber = null;
}

function collectTicketFromForm() {
  const number = Number(ticketNumberInput.value || 0);
  const date = ticketDateInput.value;
  const clientName = clientNameInput.value.trim();

  let technician = "";
  if (isEmployee()) {
    technician = state.session.techName || "";
  } else {
    const techPre = technicianSelect.value;
    const techCustom = technicianCustomInput.value.trim();
    technician = techCustom || techPre || "";
  }

  const paymentMethod = paymentMethodSelect.value;
  const serviceDesc = serviceDescInput.value.trim();

  const miles = Number(milesInput?.value || 0);
  const ratePerMile = Number(ratePerMileInput?.value || 0);
  const extras = Number(tipAmountInput.value || 0);
  const totalAmount = Number(totalAmountInput.value || 0);

  if (!number || !date || !clientName || !technician || !paymentMethod || !serviceDesc || miles <= 0 || ratePerMile < 0) {
    throw new Error("Faltan campos requeridos.");
  }

  return {
    number,
    date,
    clientName,
    technician,
    paymentMethod,
    serviceDesc,

    miles,
    ratePerMile,
    extras,         // nuevo campo
    tipAmount: extras, // compatibilidad (por si algo aún lo usa)
    totalAmount,

    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function saveTicket() {
  if (!state.user) {
    formMessage.textContent = "Conéctate con Google antes de guardar servicios.";
    return;
  }
  if (!state.session?.role) {
    formMessage.textContent = "Inicia sesión (admin o empleado) primero.";
    return;
  }

  try {
    const ticket = collectTicketFromForm();
    const docId = String(ticket.number);

    await ticketsCollectionRef().doc(docId).set(ticket, { merge: true });

    formMessage.textContent = currentEditingNumber
      ? "Servicio actualizado correctamente."
      : "Servicio guardado y sincronizado con Firebase.";

    currentEditingNumber = null;
    resetFormForNewTicket();
  } catch (err) {
    console.error("Error guardando", err);
    formMessage.textContent = err.message || "Error al guardar.";
  }
}

/* ========== BRANDING EN FIRESTORE (COMPARTIDO) ========== */
async function loadBrandingFromCloud() {
  if (!state.user) return;
  try {
    const snap = await brandingDocRef().get();
    if (snap.exists) {
      const data = snap.data();
      if (data.appName) state.appName = data.appName;
      if (data.logoUrl !== undefined) state.logoUrl = data.logoUrl;
      if (data.pdfHeaderText !== undefined) state.pdfHeaderText = data.pdfHeaderText;
      if (data.pdfFooterText !== undefined) state.pdfFooterText = data.pdfFooterText;
      if (data.footerText !== undefined) state.footerText = data.footerText;
      saveState();
      renderBranding();
    }
  } catch (e) {
    console.error("Error cargando branding", e);
  }
}

async function saveBrandingToCloud() {
  if (!state.user) {
    brandingStatus.textContent = "Conéctate con Google para guardar branding.";
    return;
  }
  try {
    const payload = {
      appName: state.appName,
      logoUrl: state.logoUrl || "",
      pdfHeaderText: state.pdfHeaderText || "",
      pdfFooterText: state.pdfFooterText || "",
      footerText: state.footerText || ""
    };
    await brandingDocRef().set(payload, { merge: true });
    brandingStatus.textContent = "Branding guardado en Firebase.";
  } catch (e) {
    console.error("Error guardando branding", e);
    brandingStatus.textContent = "Error al guardar branding.";
  }
}

/* ========== CONFIG: STAFF (CRUD) ========== */
function renderStaffTable() {
  if (!staffTableBody) return;

  staffTableBody.innerHTML = "";
  (state.staff || [])
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)))
    .forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${normalizeName(s.name)}</td>
        <td>${Number(s.rate || 0).toFixed(1)}%</td>
        <td>${String(s.pin || "")}</td>
        <td>
          <button class="btn-table edit" data-staff-action="edit" data-staff-name="${normalizeName(s.name)}">Editar</button>
          <button class="btn-table delete" data-staff-action="delete" data-staff-name="${normalizeName(s.name)}">X</button>
        </td>
      `;
      staffTableBody.appendChild(tr);
    });
}

function addOrUpdateStaff() {
  if (!isAdmin()) return;

  const name = normalizeName(staffNameInput.value);
  const pin = String(staffPinInput.value || "").trim();
  const rate = Number(staffRateInput.value || 0);

  if (!name) return alert("Escribe el nombre del conductor/empleado.");
  if (!pin || pin.length < 4) return alert("El PIN empleado debe tener al menos 4 dígitos.");
  if (!isFinite(rate) || rate < 0 || rate > 100) return alert("El % comisión debe estar entre 0 y 100.");

  const existing = findStaffByName(name);
  if (existing) {
    existing.name = name;
    existing.pin = pin;
    existing.rate = rate;
  } else {
    state.staff.push({ name, pin, rate });
  }

  saveState();
  renderStaffTable();
  refreshAllTechSelects();
  resetStaffForm();
}

function resetStaffForm() {
  if (!staffNameInput) return;
  staffNameInput.value = "";
  staffRateInput.value = "";
  staffPinInput.value = "";
}

/* ========== FILTROS / LISTA ========== */
function getFilteredTickets() {
  const start = filterStartInput?.value || "";
  const end = filterEndInput?.value || "";

  let tech = filterTechSelect?.value || "";
  if (isEmployee()) tech = state.session.techName || "";

  return state.tickets.filter((t) => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (tech && t.technician !== tech) return false;
    return true;
  });
}

/* ========== PDF + BACKUP JSON ==========
   Admin only */
function exportTicketsToPDF() {
  if (!isAdmin()) return alert("Solo admin puede exportar PDF.");
  const jsPDFLib = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFLib) return alert("La librería jsPDF no se cargó.");

  const list = getFilteredTickets();
  if (!list.length) return alert("No hay registros para exportar con el filtro actual.");

  const doc = new jsPDFLib({ orientation: "p", unit: "mm", format: "a4" });
  const marginLeft = 12;

  const col = { num: marginLeft, date: marginLeft + 12, client: marginLeft + 38, tech: marginLeft + 80, service: marginLeft + 112, method: marginLeft + 150, total: 200 };
  let y = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(state.appName || "Nexus Transport", marginLeft, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  if (state.pdfHeaderText) {
    const lines = doc.splitTextToSize(state.pdfHeaderText, 180);
    doc.text(lines, marginLeft, y);
    y += lines.length * 4 + 2;
  } else y += 2;

  const now = new Date();
  doc.text(`Generado: ${now.toLocaleString()}`, marginLeft, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("#", col.num, y);
  doc.text("Fecha", col.date, y);
  doc.text("Cliente", col.client, y);
  doc.text("Conductor", col.tech, y);
  doc.text("Ruta", col.service, y);
  doc.text("Método", col.method, y);
  doc.text("Total", col.total, y, { align: "right" });
  y += 4;

  doc.setFont("helvetica", "normal");

  let grandTotal = 0;

  list.forEach((t) => {
    if (y > 270) { doc.addPage(); y = 14; }
    const total = Number(t.totalAmount || 0);
    grandTotal += total;

    doc.text(String(t.number || ""), col.num, y);
    doc.text(String(t.date || ""), col.date, y);
    doc.text(String(t.clientName || "").substring(0, 18), col.client, y);
    doc.text(String(t.technician || "").substring(0, 14), col.tech, y);
    doc.text(String(t.serviceDesc || "").substring(0, 20), col.service, y);
    doc.text(String(t.paymentMethod || ""), col.method, y);
    doc.text(`$${total.toFixed(2)}`, col.total, y, { align: "right" });
    y += 4;
  });

  if (y > 260) { doc.addPage(); y = 20; }
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`GRAN TOTAL: $${grandTotal.toFixed(2)}`, marginLeft, y);

  if (state.pdfFooterText) {
    const footerLines = doc.splitTextToSize(state.pdfFooterText, 180);
    doc.setFontSize(9);
    doc.text(footerLines, marginLeft, 288);
  }

  doc.save("servicios-nexus-transport.pdf");
}

function downloadBackupJson() {
  if (!isAdmin()) return alert("Solo admin puede crear backup.");
  const list = getFilteredTickets();
  if (!list.length) return alert("No hay registros para exportar con el filtro actual.");

  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "servicios-nexus-transport.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========== CAMBIAR PIN MAESTRO ========== */
function changePin() {
  if (!isAdmin()) return alert("Solo admin puede cambiar PIN maestro.");
  const newPin = (newPinInput.value || "").trim();
  if (!newPin || newPin.length < 4) {
    pinChangeMessage.textContent = "El PIN debe tener al menos 4 dígitos.";
    return;
  }
  state.pin = newPin;
  saveState();
  pinChangeMessage.textContent = "PIN actualizado correctamente.";
  newPinInput.value = "";
}

/* ========== EVENTOS ========== */
pinEnterBtn.addEventListener("click", handleAdminPinEnter);
pinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleAdminPinEnter(); });

if (empEnterBtn) empEnterBtn.addEventListener("click", handleEmployeeEnter);
if (empPinInput) empPinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleEmployeeEnter(); });

googleSignInBtn.addEventListener("click", signInWithGoogle);
authBackToPinBtn.addEventListener("click", showPinScreen);
logoutBtn.addEventListener("click", signOutAndReset);

/* nav */
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const page = btn.getAttribute("data-page");
    setActivePage(page);
  });
});

/* Branding inputs */
appNameEditable.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.appName = appNameEditable.textContent.trim() || "Nexus Transport";
  saveState();
  renderBranding();
});

logoUrlInput.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.logoUrl = logoUrlInput.value.trim();
  saveState();
  renderBranding();
});

pdfHeaderTextArea.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.pdfHeaderText = pdfHeaderTextArea.value;
  saveState();
});

pdfFooterTextArea.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.pdfFooterText = pdfFooterTextArea.value;
  saveState();
});

footerTextInput.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.footerText = footerTextInput.value;
  saveState();
  footerTextSpan.textContent = state.footerText;
});

saveBrandingBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (!isAdmin()) return alert("Solo admin.");
  saveBrandingToCloud();
});

changePinBtn.addEventListener("click", (e) => {
  e.preventDefault();
  changePin();
});

/* Admin staff CRUD */
if (addStaffBtn) addStaffBtn.addEventListener("click", (e) => {
  e.preventDefault();
  addOrUpdateStaff();
});
if (resetStaffBtn) resetStaffBtn.addEventListener("click", (e) => {
  e.preventDefault();
  resetStaffForm();
});

if (staffTableBody) {
  staffTableBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-staff-action]");
    if (!btn) return;
    if (!isAdmin()) return;

    const action = btn.dataset.staffAction;
    const name = btn.dataset.staffName;

    const rec = findStaffByName(name);
    if (!rec) return;

    if (action === "edit") {
      staffNameInput.value = rec.name;
      staffRateInput.value = rec.rate;
      staffPinInput.value = rec.pin;
      return;
    }

    if (action === "delete") {
      const ok = confirm(`¿Eliminar conductor/empleado "${rec.name}"?`);
      if (!ok) return;

      state.staff = (state.staff || []).filter(s => normalizeName(s.name).toLowerCase() !== normalizeName(rec.name).toLowerCase());
      saveState();
      renderStaffTable();
      refreshAllTechSelects();
      resetStaffForm();
    }
  });
}

/* Dashboard */
newTicketBtn.addEventListener("click", (e) => { e.preventDefault(); resetFormForNewTicket(); });

// ✅ listeners nuevos
if (milesInput) milesInput.addEventListener("input", recalcTotal);
if (ratePerMileInput) ratePerMileInput.addEventListener("input", recalcTotal);
tipAmountInput.addEventListener("input", recalcTotal);

saveTicketBtn.addEventListener("click", (e) => { e.preventDefault(); saveTicket(); });

/* Historial filtros */
applyFilterBtn.addEventListener("click", () => { renderTicketsTable(getFilteredTickets()); });
clearFilterBtn.addEventListener("click", () => {
  if (isEmployee()) {
    filterStartInput.value = "";
    filterEndInput.value = "";
  } else {
    filterStartInput.value = "";
    filterEndInput.value = "";
    filterTechSelect.value = "";
  }
  renderTicketsTable();
});

/* Caja (admin) */
cajaApplyBtn.addEventListener("click", () => computeCajaTotals());
cajaClearBtn.addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);
  cajaStartInput.value = today;
  cajaEndInput.value = today;
  computeCajaTotals();
});

/* Export */
exportPdfBtn.addEventListener("click", exportTicketsToPDF);
backupJsonBtn.addEventListener("click", downloadBackupJson);

/* Comisiones */
if (comiApplyBtn) comiApplyBtn.addEventListener("click", () => renderCommissionsSummary());
if (comiClearBtn) comiClearBtn.addEventListener("click", () => {
  if (!isAdmin()) return;
  comiStartInput.value = "";
  comiEndInput.value = "";
  comiTechSelect.value = "";
  renderCommissionsSummary();
});

/* Extras (antes Propinas) */
if (tipsApplyBtn) tipsApplyBtn.addEventListener("click", () => renderTipsSummary());
if (tipsClearBtn) tipsClearBtn.addEventListener("click", () => {
  if (!isAdmin()) return;
  tipsStartInput.value = "";
  tipsEndInput.value = "";
  tipsTechSelect.value = "";
  tipsGroupSelect.value = "tech";
  renderTipsSummary();
});

/* Retenciones */
if (retenApplyBtn) retenApplyBtn.addEventListener("click", () => renderRetencionesSummary());
if (retenClearBtn) retenClearBtn.addEventListener("click", () => {
  if (!isAdmin()) return;
  retenStartInput.value = "";
  retenEndInput.value = "";
  retenTechSelect.value = "";
  renderRetencionesSummary();
});

if (retenPdfBtn) {
  retenPdfBtn.addEventListener("click", (e) => {
    e.preventDefault();
    exportRetencionesPDF();
  });
}

/* Editar / eliminar (admin only) */
ticketsTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  if (!isAdmin()) return;

  const action = btn.dataset.action;
  const number = Number(btn.dataset.number);
  if (!number) return;

  const ticket = state.tickets.find((t) => Number(t.number) === number);
  if (!ticket) return;

  if (action === "edit") {
    currentEditingNumber = number;

    ticketNumberInput.value = ticket.number;
    ticketDateInput.value = ticket.date;
    clientNameInput.value = ticket.clientName;
    serviceDescInput.value = ticket.serviceDesc;

    // ✅ carga transporte
    if (milesInput) milesInput.value = ticket.miles ?? "";
    if (ratePerMileInput) ratePerMileInput.value = ticket.ratePerMile ?? "";
    tipAmountInput.value = (ticket.extras ?? ticket.tipAmount ?? 0);

    fillTechSelect(technicianSelect, { includeEmpty: true });
    technicianSelect.value = ticket.technician || "";
    technicianCustomInput.value = "";

    paymentMethodSelect.value = ticket.paymentMethod;

    recalcTotal();
    formMessage.textContent = `Editando #${ticket.number}`;
    setActivePage("dashboard");
  }

  if (action === "delete") {
    if (!state.user) return alert("Conéctate con Google para eliminar.");

    const ok = confirm(`¿Eliminar el registro #${number}? Esta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      await ticketsCollectionRef().doc(String(number)).delete();
    } catch (err) {
      console.error("Error eliminando", err);
      alert("No se pudo eliminar.");
    }
  }
});

/* ========== INIT + PWA ========== */
function init() {
  loadState();
  renderBranding();

  refreshAllTechSelects();
  renderStaffTable();

  renderTicketNumber();
  renderTicketsTable(state.tickets);

  const today = new Date().toISOString().slice(0, 10);
  cajaStartInput.value = today;
  cajaEndInput.value = today;
  computeCajaTotals();

  resetFormForNewTicket();
  setActivePage("dashboard");
  showPinScreen();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.error("SW error", err));
  }
}

init();
