/*************************************************
 * app.js — Nexus Transport (COMPLETO)
 * Parte 1/3 — Firebase, Estado, Helpers, Roles, UI base
 *************************************************/

/* ========== FIREBASE CONFIG ========== */
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
const LOCAL_KEY = "nexus_transport_state_v10";

let state = {
  // PIN maestro admin
  pin: "058312",

  session: {
    role: null,        // "admin" | "driver"
    driverName: ""     // si es driver
  },

  appName: "Nexus Transport",
  footerText: "© 2026 Nexus Transport — Cuadres",

  // Ajustes (Config)
  defaultRate: 30,        // % descuento/chofer default
  retentionRate: 10,      // % retención default
  allowDriverEdit: false, // permiso chofer para editar/borrar

  // Choferes (Config)
  drivers: [
    { name: "Erika", pin: "1111", rate: 30 },
    { name: "Jose",  pin: "2222", rate: 25 }
  ],

  tickets: [],

  user: null,
  unsubscribeTickets: null
};

/* ========== CATEGORÍAS (LÓGICA DE CUADRE) ==========
   - Ingreso: suma positiva
   - Gasto / salidas: las tratamos como negativa para cuadre
   Ajusta aquí si tu hoja dice distinto */
const EXPENSE_CATEGORIES = new Set([
  "Gastos",
  "Uso del Cash",
  "Pago Peaje",
  "Se le Debe"
]);

// Cosas internas que NO deberían entrar a comisión (si aplica)
const NON_COMMISSION_CATEGORIES = new Set([
  "Gastos",
  "Uso del Cash",
  "Pago Peaje",
  "Se le Debe",
  "En Bolsa"
]);

/* ========== STORAGE ========= */
function loadState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };

      // defaults defensivos
      if (!state.session) state.session = { role: null, driverName: "" };
      if (!Array.isArray(state.drivers) || !state.drivers.length) {
        state.drivers = [{ name: "Erika", pin: "1111", rate: 30 }];
      }
      if (state.defaultRate == null) state.defaultRate = 30;
      if (state.retentionRate == null) state.retentionRate = 10;
      if (state.allowDriverEdit == null) state.allowDriverEdit = false;
      if (!Array.isArray(state.tickets)) state.tickets = [];
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

/* ========== FIRESTORE REFS ========= */
function ticketsCollectionRef() {
  return db.collection("transportTickets");
}
function brandingDocRef() {
  return db.collection("branding").doc("transport");
}

/* ========== HELPERS ========= */
function normalizeName(s) {
  return String(s || "").trim();
}
function isAdmin() {
  return state.session?.role === "admin";
}
function isDriver() {
  return state.session?.role === "driver";
}
function findDriverByName(name) {
  const n = normalizeName(name).toLowerCase();
  return (state.drivers || []).find(d => normalizeName(d.name).toLowerCase() === n) || null;
}
function driverNames() {
  return (state.drivers || []).map(d => d.name).filter(Boolean);
}
function getRateForDriver(name) {
  const d = findDriverByName(name);
  if (d && d.rate != null) return Number(d.rate) || 0;
  return Number(state.defaultRate) || 0;
}
function money(n) {
  const v = Number(n || 0);
  return isFinite(v) ? v : 0;
}
function milesNum(n) {
  const v = Number(n || 0);
  return isFinite(v) ? v : 0;
}
function isExpenseCategory(cat) {
  return EXPENSE_CATEGORIES.has(String(cat || "").trim());
}
function effectiveAmount(t) {
  // Guardas monto positivo en UI, pero para cuadre lo convertimos si es gasto
  const amt = money(t.amount);
  return isExpenseCategory(t.category) ? -Math.abs(amt) : Math.abs(amt);
}
function commissionableAmount(t) {
  if (NON_COMMISSION_CATEGORIES.has(String(t.category || "").trim())) return 0;
  return Math.max(0, effectiveAmount(t)); // solo ingresos
}

/* ========== CUADRE SEMANAL (JUEVES → JUEVES) ========= */
function weekRangeThuToThu(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  // getDay(): 0 dom .. 4 jue
  const day = d.getDay();
  // queremos el jueves anterior (o el mismo jueves)
  const diffToThu = (day >= 4) ? (day - 4) : (day + 3);
  const start = new Date(d);
  start.setDate(d.getDate() - diffToThu);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

/* ========== DOM (IDs del index que ya tienes) ========= */
// Screens
const pinScreen = document.getElementById("pinScreen");
const authScreen = document.getElementById("authScreen");
const appShell = document.getElementById("appShell");

// PIN admin/driver
const pinInput = document.getElementById("pinInput");
const pinEnterBtn = document.getElementById("pinEnterBtn");
const empNameInput = document.getElementById("empNameInput");
const empPinInput = document.getElementById("empPinInput");
const empEnterBtn = document.getElementById("empEnterBtn");
const pinError = document.getElementById("pinError");

// Auth
const googleSignInBtn = document.getElementById("googleSignInBtn");
const authBackToPinBtn = document.getElementById("authBackToPinBtn");

// Topbar/nav
const appNameEditable = document.getElementById("appNameEditable");
const pinAppNameTitle = document.getElementById("pinAppName");
const userEmailSpan = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const appLogoImg = document.getElementById("appLogo");
const pinLogoImg = document.getElementById("pinLogo");
const footerTextSpan = document.getElementById("footerText");
const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const sessionSubtitle = document.getElementById("sessionSubtitle");

// Pages
const pages = {
  dashboard: document.getElementById("page-dashboard"),
  historial: document.getElementById("page-historial"),
  caja: document.getElementById("page-caja"),
  resumen: document.getElementById("page-resumen"),
  comisiones: document.getElementById("page-comisiones"),
  config: document.getElementById("page-config")
};

// Dashboard form
const serviceNumberInput = document.getElementById("serviceNumber");
const serviceDateInput = document.getElementById("serviceDate");
const driverSelect = document.getElementById("driver");
const driverCustomInput = document.getElementById("driverCustom");
const paymentMethodSelect = document.getElementById("paymentMethod");
const categorySelect = document.getElementById("category");
const amountInput = document.getElementById("amount");
const milesInput = document.getElementById("miles");
const descriptionInput = document.getElementById("description");
const notesInput = document.getElementById("notes");
const newServiceBtn = document.getElementById("newServiceBtn");
const saveServiceBtn = document.getElementById("saveServiceBtn");
const formMessage = document.getElementById("formMessage");

// Historial
const servicesTableBody = document.getElementById("servicesTableBody");
const filterStartInput = document.getElementById("filterStart");
const filterEndInput = document.getElementById("filterEnd");
const filterDriverSelect = document.getElementById("filterDriver");
const filterCategorySelect = document.getElementById("filterCategory");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const backupJsonBtn = document.getElementById("backupJsonBtn");

// Caja
const cajaStartInput = document.getElementById("cajaStart");
const cajaEndInput = document.getElementById("cajaEnd");
const cajaDriverSelect = document.getElementById("cajaDriver");
const cajaApplyBtn = document.getElementById("cajaApplyBtn");
const cajaClearBtn = document.getElementById("cajaClearBtn");
const cajaTotalCashSpan = document.getElementById("cajaTotalCash");
const cajaTotalAthSpan = document.getElementById("cajaTotalAth");
const cajaTotalOtherSpan = document.getElementById("cajaTotalOther");
const cajaTotalAllSpan = document.getElementById("cajaTotalAll");

// Resumen
const sumStartInput = document.getElementById("sumStart");
const sumEndInput = document.getElementById("sumEnd");
const sumDriverSelect = document.getElementById("sumDriver");
const sumApplyBtn = document.getElementById("sumApplyBtn");
const sumClearBtn = document.getElementById("sumClearBtn");
const sumTableBody = document.getElementById("sumTableBody");
const sumGrandTotalSpan = document.getElementById("sumGrandTotal");

// Comisiones
const comiStartInput = document.getElementById("comiStart");
const comiEndInput = document.getElementById("comiEnd");
const comiDriverSelect = document.getElementById("comiDriver");
const comiApplyBtn = document.getElementById("comiApplyBtn");
const comiClearBtn = document.getElementById("comiClearBtn");
const comiTableBody = document.getElementById("comiTableBody");
const comiGrandTotalSpan = document.getElementById("comiGrandTotal");

// Config
const footerTextInput = document.getElementById("footerTextInput");
const newPinInput = document.getElementById("newPinInput");
const changePinBtn = document.getElementById("changePinBtn");
const pinChangeMessage = document.getElementById("pinChangeMessage");
const defaultRateInput = document.getElementById("defaultRateInput");
const retentionRateInput = document.getElementById("retentionRateInput");
const allowDriverEditCheckbox = document.getElementById("allowDriverEdit");

// Admin drivers CRUD
const adminArea = document.getElementById("adminArea");
const staffNameInput = document.getElementById("staffNameInput");
const staffPinInput = document.getElementById("staffPinInput");
const staffRateInput = document.getElementById("staffRateInput");
const addStaffBtn = document.getElementById("addStaffBtn");
const resetStaffBtn = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

/* ========== UI HELPERS ========= */
function showPinScreen() {
  pinScreen.classList.remove("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.add("hidden");

  if (pinInput) pinInput.value = "";
  if (empNameInput) empNameInput.value = "";
  if (empPinInput) empPinInput.value = "";
  if (pinError) pinError.textContent = "";
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
  // Driver: solo dashboard/historial
  if (isDriver() && !["dashboard", "historial"].includes(pageName)) pageName = "dashboard";

  Object.keys(pages).forEach((k) => {
    pages[k]?.classList.toggle("active-page", k === pageName);
  });

  navButtons.forEach(btn => {
    const target = btn.getAttribute("data-page");
    btn.classList.toggle("nav-btn-active", target === pageName);
  });

  if (pageName === "caja") computeCajaTotals();
  if (pageName === "resumen") renderSummary();
  if (pageName === "comisiones") renderCommissions();
}

function applyRoleUI() {
  const adminEls = Array.from(document.querySelectorAll(".nav-admin"));
  const adminNavBtns = Array.from(document.querySelectorAll(".nav-btn.nav-admin"));

  if (isAdmin()) {
    adminEls.forEach(el => (el.style.display = ""));
    adminNavBtns.forEach(btn => (btn.style.display = ""));
    if (driverCustomInput) {
      driverCustomInput.disabled = false;
      driverCustomInput.placeholder = "Otro chofer (solo admin)";
    }
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — control total";
    if (adminArea) adminArea.style.display = "";
  } else {
    adminEls.forEach(el => (el.style.display = "none"));
    adminNavBtns.forEach(btn => (btn.style.display = "none"));
    if (driverCustomInput) {
      driverCustomInput.value = "";
      driverCustomInput.disabled = true;
      driverCustomInput.placeholder = "Solo admin";
    }
    if (sessionSubtitle) sessionSubtitle.textContent = `Chofer: ${state.session.driverName}`;
    if (adminArea) adminArea.style.display = "none";

    // si estaba en una pestaña admin, lo mandamos a dashboard
    const active = Object.keys(pages).find(k => pages[k]?.classList.contains("active-page")) || "dashboard";
    if (!["dashboard", "historial"].includes(active)) setActivePage("dashboard");
  }

  refreshAllDriverSelects();
}

/* ========== BRANDING (simple) ========= */
function renderBranding() {
  if (appNameEditable) appNameEditable.textContent = state.appName || "Nexus Transport";
  if (pinAppNameTitle) pinAppNameTitle.textContent = state.appName || "Nexus Transport";

  if (footerTextInput) footerTextInput.value = state.footerText || "";
  if (footerTextSpan) footerTextSpan.textContent = state.footerText || "";

  // logos (si tuvieras url dinámica, aquí lo manejas; ahora es assets/logo.png)
  if (appLogoImg) appLogoImg.src = "assets/logo.png";
  if (pinLogoImg) pinLogoImg.src = "assets/logo.png";

  if (defaultRateInput) defaultRateInput.value = String(state.defaultRate ?? 30);
  if (retentionRateInput) retentionRateInput.value = String(state.retentionRate ?? 10);
  if (allowDriverEditCheckbox) allowDriverEditCheckbox.checked = !!state.allowDriverEdit;
}

/* ========== SELECTS: CHOFERES ========= */
function fillDriverSelect(selectEl, { includeAll = false, includeEmpty = false } = {}) {
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

  if (isDriver()) {
    const only = state.session.driverName || "";
    const opt = document.createElement("option");
    opt.value = only;
    opt.textContent = only;
    selectEl.appendChild(opt);
    selectEl.value = only;
    return;
  }

  driverNames().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });

  // restore if exists
  if (Array.from(selectEl.options).some(o => o.value === current)) selectEl.value = current;
}

function refreshAllDriverSelects() {
  fillDriverSelect(driverSelect, { includeEmpty: true });
  fillDriverSelect(filterDriverSelect, { includeAll: true });
  fillDriverSelect(cajaDriverSelect, { includeAll: true });
  fillDriverSelect(sumDriverSelect, { includeAll: true });
  fillDriverSelect(comiDriverSelect, { includeAll: true });
}

/* ========== FILTRO POR ROL ========= */
function roleFilteredTickets(list) {
  if (!isDriver()) return list || [];
  const me = state.session.driverName;
  return (list || []).filter(t => (t.driver || "") === me);
}

/*************************************************
 * app.js — Nexus Transport
 * Parte 2/3 — DOM, UI, Formularios, Historial
 * (Pegar después de la Parte 1/3)
 *************************************************/

/* ========== DOM: PANTALLAS ========= */
const pinScreen = document.getElementById("pinScreen");
const authScreen = document.getElementById("authScreen");
const appShell = document.getElementById("appShell");

/* ========== DOM: PIN ========= */
const pinInput = document.getElementById("pinInput");
const pinEnterBtn = document.getElementById("pinEnterBtn");
const empNameInput = document.getElementById("empNameInput");
const empPinInput = document.getElementById("empPinInput");
const empEnterBtn = document.getElementById("empEnterBtn");
const pinError = document.getElementById("pinError");

/* ========== DOM: AUTH ========= */
const googleSignInBtn = document.getElementById("googleSignInBtn");
const authBackToPinBtn = document.getElementById("authBackToPinBtn");

/* ========== DOM: TOPBAR ========= */
const appNameEditable = document.getElementById("appNameEditable");
const pinAppNameTitle = document.getElementById("pinAppName");
const userEmailSpan = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const appLogoImg = document.getElementById("appLogo");
const pinLogoImg = document.getElementById("pinLogo");
const footerTextSpan = document.getElementById("footerText");
const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const sessionSubtitle = document.getElementById("sessionSubtitle");

/* ========== DOM: PAGES ========= */
const pages = {
  dashboard: document.getElementById("page-dashboard"),
  historial: document.getElementById("page-historial"),
  caja: document.getElementById("page-caja"),
  resumen: document.getElementById("page-resumen"),
  comisiones: document.getElementById("page-comisiones"),
  config: document.getElementById("page-config")
};

/* ========== DOM: DASHBOARD FORM ========= */
const serviceNumberInput = document.getElementById("serviceNumber");
const serviceDateInput = document.getElementById("serviceDate");
const driverSelect = document.getElementById("driver");
const driverCustomInput = document.getElementById("driverCustom");
const paymentMethodSelect = document.getElementById("paymentMethod");
const categorySelect = document.getElementById("category");
const amountInput = document.getElementById("amount");
const milesInput = document.getElementById("miles");
const descriptionInput = document.getElementById("description");
const notesInput = document.getElementById("notes");
const newServiceBtn = document.getElementById("newServiceBtn");
const saveServiceBtn = document.getElementById("saveServiceBtn");
const formMessage = document.getElementById("formMessage");

/* ========== DOM: HISTORIAL ========= */
const servicesTableBody = document.getElementById("servicesTableBody");
const filterStartInput = document.getElementById("filterStart");
const filterEndInput = document.getElementById("filterEnd");
const filterDriverSelect = document.getElementById("filterDriver");
const filterCategorySelect = document.getElementById("filterCategory");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const backupJsonBtn = document.getElementById("backupJsonBtn");

/* ========== DOM: CAJA ========= */
const cajaStartInput = document.getElementById("cajaStart");
const cajaEndInput = document.getElementById("cajaEnd");
const cajaDriverSelect = document.getElementById("cajaDriver");
const cajaApplyBtn = document.getElementById("cajaApplyBtn");
const cajaClearBtn = document.getElementById("cajaClearBtn");
const cajaTotalCashSpan = document.getElementById("cajaTotalCash");
const cajaTotalAthSpan = document.getElementById("cajaTotalAth");
const cajaTotalOtherSpan = document.getElementById("cajaTotalOther");
const cajaTotalAllSpan = document.getElementById("cajaTotalAll");

/* ========== DOM: RESUMEN ========= */
const sumStartInput = document.getElementById("sumStart");
const sumEndInput = document.getElementById("sumEnd");
const sumDriverSelect = document.getElementById("sumDriver");
const sumApplyBtn = document.getElementById("sumApplyBtn");
const sumClearBtn = document.getElementById("sumClearBtn");
const sumTableBody = document.getElementById("sumTableBody");
const sumGrandTotalSpan = document.getElementById("sumGrandTotal");

/* ========== DOM: COMISIONES ========= */
const comiStartInput = document.getElementById("comiStart");
const comiEndInput = document.getElementById("comiEnd");
const comiDriverSelect = document.getElementById("comiDriver");
const comiApplyBtn = document.getElementById("comiApplyBtn");
const comiClearBtn = document.getElementById("comiClearBtn");
const comiTableBody = document.getElementById("comiTableBody");
const comiGrandTotalSpan = document.getElementById("comiGrandTotal");

/* ========== DOM: CONFIG ========= */
const footerTextInput = document.getElementById("footerTextInput");
const newPinInput = document.getElementById("newPinInput");
const changePinBtn = document.getElementById("changePinBtn");
const pinChangeMessage = document.getElementById("pinChangeMessage");
const defaultRateInput = document.getElementById("defaultRateInput");
const retentionRateInput = document.getElementById("retentionRateInput");
const allowDriverEditInput = document.getElementById("allowDriverEdit");

const adminArea = document.getElementById("adminArea");
const staffNameInput = document.getElementById("staffNameInput");
const staffPinInput = document.getElementById("staffPinInput");
const staffRateInput = document.getElementById("staffRateInput");
const addStaffBtn = document.getElementById("addStaffBtn");
const resetStaffBtn = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

/* ==============================
   UI: SHOW/HIDE SCREENS
================================ */
function showPinScreen() {
  pinScreen.classList.remove("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.add("hidden");

  pinInput.value = "";
  empNameInput.value = "";
  empPinInput.value = "";
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

/* ==============================
   Helpers: nombres / selects
================================ */
function normalizeName(s) {
  return String(s || "").trim();
}

function findDriverByName(name) {
  const n = normalizeName(name).toLowerCase();
  return (state.drivers || []).find(d => normalizeName(d.name).toLowerCase() === n) || null;
}

function driverNames() {
  return (state.drivers || []).map(d => d.name).filter(Boolean);
}

/* Rellena selects:
   - Admin: lista completa, opcional "Seleccionar..." o "Todos"
   - Chofer: solo su nombre */
function fillDriverSelect(selectEl, { includeEmpty = false, includeAll = false } = {}) {
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

  if (isDriver()) {
    const only = state.session.driverName;
    const opt = document.createElement("option");
    opt.value = only;
    opt.textContent = only;
    selectEl.appendChild(opt);
    selectEl.value = only;
    return;
  }

  driverNames().forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  });

  if (Array.from(selectEl.options).some(o => o.value === current)) {
    selectEl.value = current;
  }
}

function refreshAllDriverSelects() {
  fillDriverSelect(driverSelect, { includeEmpty: true });
  fillDriverSelect(filterDriverSelect, { includeAll: true });
  fillDriverSelect(cajaDriverSelect, { includeAll: true });
  fillDriverSelect(sumDriverSelect, { includeAll: true });
  fillDriverSelect(comiDriverSelect, { includeAll: true });
}

/* ==============================
   UI por rol (Admin vs Chofer)
================================ */
function applyRoleUI() {
  const adminEls = Array.from(document.querySelectorAll(".nav-admin"));
  const adminNavBtns = Array.from(document.querySelectorAll(".nav-btn.nav-admin"));

  if (isAdmin()) {
    adminEls.forEach(el => el.style.display = "");
    adminNavBtns.forEach(btn => btn.style.display = "");

    if (driverCustomInput) {
      driverCustomInput.disabled = false;
      driverCustomInput.placeholder = "Otro chofer (solo admin)";
    }

    if (adminArea) adminArea.style.display = "";
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — control total";
  } else {
    adminEls.forEach(el => el.style.display = "none");
    adminNavBtns.forEach(btn => btn.style.display = "none");

    if (driverCustomInput) {
      driverCustomInput.value = "";
      driverCustomInput.disabled = true;
      driverCustomInput.placeholder = "Solo admin";
    }

    if (adminArea) adminArea.style.display = "none";
    if (sessionSubtitle) sessionSubtitle.textContent = `Chofer: ${state.session.driverName} — Cuadre Jue→Jue`;

    // Si estaba en pestaña admin, volver a dashboard
    const allowed = ["dashboard", "historial"];
    const active = Object.keys(pages).find(k => pages[k].classList.contains("active-page")) || "dashboard";
    if (!allowed.includes(active)) setActivePage("dashboard");
  }

  refreshAllDriverSelects();
}

/* ==============================
   Navegación
================================ */
function setActivePage(pageName) {
  if (isDriver() && !["dashboard", "historial"].includes(pageName)) {
    pageName = "dashboard";
  }

  Object.keys(pages).forEach((k) => {
    pages[k].classList.toggle("active-page", k === pageName);
  });

  navButtons.forEach((btn) => {
    const target = btn.getAttribute("data-page");
    btn.classList.toggle("nav-btn-active", target === pageName);
  });

  // “hooks” para Parte 3 (cálculos)
  if (pageName === "caja") computeCajaTotalsUI();
  if (pageName === "resumen") renderResumenUI();
  if (pageName === "comisiones") renderComisionesUI();
}

/* ==============================
   Branding / textos
================================ */
function renderBranding() {
  if (appNameEditable) appNameEditable.textContent = state.appName || "Nexus Transport";
  if (pinAppNameTitle) pinAppNameTitle.textContent = state.appName || "Nexus Transport";

  if (footerTextInput) footerTextInput.value = state.footerText || "© 2025 Nexus Transport";
  if (footerTextSpan) footerTextSpan.textContent = state.footerText || "© 2025 Nexus Transport";

  const logoSrc = "assets/logo.png";
  if (appLogoImg) appLogoImg.src = logoSrc;
  if (pinLogoImg) pinLogoImg.src = logoSrc;

  // Config fields
  if (defaultRateInput) defaultRateInput.value = String(state.defaultRate ?? 25);
  if (retentionRateInput) retentionRateInput.value = String(state.retentionRate ?? 10);
  if (allowDriverEditInput) allowDriverEditInput.checked = !!state.allowDriverEdit;
}

/* ==============================
   Ticket numbering
================================ */
function nextServiceNumber() {
  if (!state.tickets.length) return 1;
  const max = state.tickets.reduce((m, t) => Math.max(m, Number(t.number || 0)), 0);
  return max + 1;
}

function renderServiceNumber() {
  if (serviceNumberInput) serviceNumberInput.value = nextServiceNumber();
}

/* ==============================
   Dashboard: Form logic
================================ */
let currentEditingNumber = null;

function resetFormForNewService() {
  const today = new Date().toISOString().slice(0, 10);
  if (serviceDateInput) serviceDateInput.value = today;

  // Chofer: fijo si es chofer
  if (isDriver()) {
    driverSelect.value = state.session.driverName || "";
    driverCustomInput.value = "";
  } else {
    driverSelect.value = "";
    driverCustomInput.value = "";
  }

  paymentMethodSelect.value = "";
  categorySelect.value = "";
  amountInput.value = "";
  milesInput.value = "";
  descriptionInput.value = "";
  notesInput.value = "";

  renderServiceNumber();
  if (formMessage) formMessage.textContent = "";
  currentEditingNumber = null;
}

/* Millas siempre manuales: NO auto-cálculos ocultos */
function collectServiceFromForm() {
  const number = Number(serviceNumberInput.value || 0);
  const date = serviceDateInput.value;

  // Chofer
  let driver = "";
  if (isDriver()) {
    driver = state.session.driverName || "";
  } else {
    const pre = driverSelect.value;
    const custom = (driverCustomInput.value || "").trim();
    driver = custom || pre || "";
  }

  const paymentMethod = paymentMethodSelect.value;
  const category = categorySelect.value;
  const amount = Number(amountInput.value || 0);
  const miles = Number(milesInput.value || 0);
  const description = (descriptionInput.value || "").trim();
  const notes = (notesInput.value || "").trim();

  // Validaciones base (profesional, sin ser restrictivo)
  if (!number || !date || !driver || !paymentMethod || !category) {
    throw new Error("Completa: Fecha, Chofer, Método y Categoría.");
  }

  // Para servicios con $ (casi todos), monto requerido
  if (!isFinite(amount) || amount < 0) {
    throw new Error("Monto inválido.");
  }

  // Millas: siempre permitidas, pueden ser 0 (pero si ponen millas deben ser válidas)
  if (!isFinite(miles) || miles < 0) {
    throw new Error("Millas inválidas.");
  }

  return {
    number,
    date,
    driver,
    paymentMethod,
    category,
    amount,
    miles,
    description,
    notes,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

/* ==============================
   Permisos de edición
================================ */
function canEditTickets() {
  if (isAdmin()) return true;
  // chofer: depende de config
  return !!state.allowDriverEdit;
}

/* ==============================
   Historial: filtros
================================ */
function roleFilteredTickets(list) {
  if (!isDriver()) return list;
  const d = state.session.driverName;
  return (list || []).filter(t => (t.driver || "") === d);
}

function getFilteredTickets() {
  const start = (filterStartInput && filterStartInput.value) ? filterStartInput.value : "";
  const end = (filterEndInput && filterEndInput.value) ? filterEndInput.value : "";
  let driver = (filterDriverSelect && filterDriverSelect.value) ? filterDriverSelect.value : "";
  const cat = (filterCategorySelect && filterCategorySelect.value) ? filterCategorySelect.value : "";

  if (isDriver()) driver = state.session.driverName || "";

  return roleFilteredTickets(state.tickets).filter(t => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (driver && t.driver !== driver) return false;
    if (cat && t.category !== cat) return false;
    return true;
  });
}

/* ==============================
   Render: tabla historial
================================ */
function renderServicesTable(listOverride) {
  if (!servicesTableBody) return;
  const base = listOverride || state.tickets;
  const list = roleFilteredTickets(base);

  servicesTableBody.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .forEach((t) => {
      const canEdit = canEditTickets();

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.number || ""}</td>
        <td>${t.date || ""}</td>
        <td>${t.driver || ""}</td>
        <td>${t.category || ""}</td>
        <td>${t.paymentMethod || ""}</td>
        <td>${(Number(t.miles || 0)).toFixed(2)}</td>
        <td>$${(Number(t.amount || 0)).toFixed(2)}</td>
        <td>${(t.description || "").substring(0, 40)}</td>
        <td class="nav-admin" style="${canEdit ? "" : "display:none"}">
          <button class="btn-table edit" data-action="edit" data-number="${t.number}">Editar</button>
          <button class="btn-table delete" data-action="delete" data-number="${t.number}">X</button>
        </td>
      `;
      servicesTableBody.appendChild(tr);
    });
}

/* ==============================
   Config: choferes tabla
================================ */
function renderDriversTable() {
  if (!staffTableBody) return;
  staffTableBody.innerHTML = "";

  (state.drivers || [])
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)))
    .forEach((d) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${normalizeName(d.name)}</td>
        <td>${String(d.pin || "")}</td>
        <td>${Number(d.rate || 0).toFixed(1)}%</td>
        <td>
          <button class="btn-table edit" data-driver-action="edit" data-driver-name="${normalizeName(d.name)}">Editar</button>
          <button class="btn-table delete" data-driver-action="delete" data-driver-name="${normalizeName(d.name)}">X</button>
        </td>
      `;
      staffTableBody.appendChild(tr);
    });
}

function resetDriverForm() {
  if (!staffNameInput) return;
  staffNameInput.value = "";
  staffPinInput.value = "";
  staffRateInput.value = "";
}

function addOrUpdateDriver() {
  if (!isAdmin()) return;

  const name = normalizeName(staffNameInput.value);
  const pin = String(staffPinInput.value || "").trim();
  const rate = Number(staffRateInput.value || 0);

  if (!name) return alert("Escribe el nombre del chofer.");
  if (!pin || pin.length < 4) return alert("El PIN debe tener al menos 4 dígitos.");
  if (!isFinite(rate) || rate < 0 || rate > 100) return alert("El % debe estar entre 0 y 100.");

  const existing = findDriverByName(name);
  if (existing) {
    existing.name = name;
    existing.pin = pin;
    existing.rate = rate;
  } else {
    state.drivers.push({ name, pin, rate });
  }

  saveState();
  renderDriversTable();
  refreshAllDriverSelects();
  resetDriverForm();
}

/* ==============================
   Config: PIN admin + opciones
================================ */
function changeAdminPin() {
  if (!isAdmin()) return alert("Solo admin.");
  const newPin = String(newPinInput.value || "").trim();
  if (!newPin || newPin.length < 4) {
    pinChangeMessage.textContent = "El PIN debe tener al menos 4 dígitos.";
    return;
  }
  state.pin = newPin;
  saveState();
  pinChangeMessage.textContent = "PIN actualizado.";
  newPinInput.value = "";
}

/* ==============================
   Caja/Resumen/Comisiones hooks
   (Parte 3 hará los cálculos reales)
================================ */
function computeCajaTotalsUI() {
  // Parte 3 se encarga del cálculo real.
  // Aquí solo limpiamos y dejamos listo.
  if (cajaTotalCashSpan) cajaTotalCashSpan.textContent = "$0.00";
  if (cajaTotalAthSpan) cajaTotalAthSpan.textContent = "$0.00";
  if (cajaTotalOtherSpan) cajaTotalOtherSpan.textContent = "$0.00";
  if (cajaTotalAllSpan) cajaTotalAllSpan.textContent = "$0.00";
}

function renderResumenUI() {
  if (!sumTableBody) return;
  sumTableBody.innerHTML = "";
  if (sumGrandTotalSpan) sumGrandTotalSpan.textContent = "$0.00";
}

function renderComisionesUI() {
  if (!comiTableBody) return;
  comiTableBody.innerHTML = "";
  if (comiGrandTotalSpan) comiGrandTotalSpan.textContent = "$0.00";
}

/* ==============================
   Login (PIN admin / PIN chofer)
================================ */
function handleAdminPinEnter() {
  const v = (pinInput.value || "").trim();
  if (!v) return (pinError.textContent = "Ingrese el PIN admin.");
  if (v === state.pin) {
    state.session = { role: "admin", driverName: "" };
    saveState();
    pinError.textContent = "";
    showAuthScreen();
  } else {
    pinError.textContent = "PIN admin incorrecto.";
  }
}

function handleDriverEnter() {
  const name = normalizeName(empNameInput.value);
  const pin = String(empPinInput.value || "").trim();

  if (!name || !pin) {
    pinError.textContent = "Chofer: escribe Nombre y PIN.";
    return;
  }

  const rec = findDriverByName(name);
  if (!rec) {
    pinError.textContent = "Chofer no existe (crearlo en Configuración).";
    return;
  }
  if (String(rec.pin) !== pin) {
    pinError.textContent = "PIN de chofer incorrecto.";
    return;
  }

  state.session = { role: "driver", driverName: rec.name };
  saveState();
  pinError.textContent = "";
  showAuthScreen();
}

/* ==============================
   Acciones: Backup JSON (admin)
================================ */
function downloadBackupJson() {
  if (!isAdmin()) return alert("Solo admin puede crear backup.");

  const list = getFilteredTickets();
  if (!list.length) return alert("No hay datos para exportar con el filtro actual.");

  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nexus-transport-backup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==============================
   Dashboard: Guardar (Firestore)
   Nota: Parte 3 define ticketsCollectionRef()
================================ */
async function saveService() {
  if (!state.user) {
    formMessage.textContent = "Conéctate con Google antes de guardar.";
    return;
  }
  if (!state.session?.role) {
    formMessage.textContent = "Inicia sesión (admin o chofer) primero.";
    return;
  }

  try {
    const ticket = collectServiceFromForm();
    const docId = String(ticket.number);

    await ticketsCollectionRef().doc(docId).set(ticket, { merge: true });

    formMessage.textContent = currentEditingNumber
      ? "Servicio actualizado."
      : "Servicio guardado y sincronizado.";

    currentEditingNumber = null;
    resetFormForNewService();
  } catch (err) {
    console.error(err);
    formMessage.textContent = err.message || "Error al guardar.";
  }
}

/* ==============================
   Editar/Eliminar desde historial
================================ */
async function deleteService(number) {
  if (!state.user) return alert("Conéctate con Google para eliminar.");
  const ok = confirm(`¿Eliminar el servicio #${number}?`);
  if (!ok) return;
  await ticketsCollectionRef().doc(String(number)).delete();
}

function editService(number) {
  const t = state.tickets.find(x => Number(x.number) === Number(number));
  if (!t) return;

  currentEditingNumber = Number(number);

  serviceNumberInput.value = t.number;
  serviceDateInput.value = t.date;

  // Chofer
  fillDriverSelect(driverSelect, { includeEmpty: true });
  if (isDriver()) {
    driverSelect.value = state.session.driverName || "";
    driverCustomInput.value = "";
  } else {
    driverSelect.value = t.driver || "";
    driverCustomInput.value = "";
  }

  paymentMethodSelect.value = t.paymentMethod || "";
  categorySelect.value = t.category || "";
  amountInput.value = Number(t.amount || 0);
  milesInput.value = Number(t.miles || 0);
  descriptionInput.value = t.description || "";
  notesInput.value = t.notes || "";

  formMessage.textContent = `Editando servicio #${t.number}`;
  setActivePage("dashboard");
}

/* ==============================
   Eventos UI
================================ */
function wireUIEvents() {
  // Nav
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.getAttribute("data-page");
      setActivePage(page);
    });
  });

  // PIN
  pinEnterBtn.addEventListener("click", handleAdminPinEnter);
  pinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleAdminPinEnter(); });

  empEnterBtn.addEventListener("click", handleDriverEnter);
  empPinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleDriverEnter(); });

  // Auth nav back
  authBackToPinBtn.addEventListener("click", showPinScreen);

  // Dashboard
  newServiceBtn.addEventListener("click", (e) => { e.preventDefault(); resetFormForNewService(); });
  saveServiceBtn.addEventListener("click", (e) => { e.preventDefault(); saveService(); });

  // Historial filtros
  applyFilterBtn.addEventListener("click", () => {
    renderServicesTable(getFilteredTickets());
  });

  clearFilterBtn.addEventListener("click", () => {
    filterStartInput.value = "";
    filterEndInput.value = "";
    if (!isDriver()) filterDriverSelect.value = "";
    filterCategorySelect.value = "";
    renderServicesTable();
  });

  // Backup JSON
  if (backupJsonBtn) backupJsonBtn.addEventListener("click", downloadBackupJson);

  // Caja
  if (cajaApplyBtn) cajaApplyBtn.addEventListener("click", () => computeCajaTotalsUI());
  if (cajaClearBtn) cajaClearBtn.addEventListener("click", () => {
    const today = new Date().toISOString().slice(0, 10);
    cajaStartInput.value = today;
    cajaEndInput.value = today;
    computeCajaTotalsUI();
  });

  // Resumen
  if (sumApplyBtn) sumApplyBtn.addEventListener("click", () => renderResumenUI());
  if (sumClearBtn) sumClearBtn.addEventListener("click", () => {
    sumStartInput.value = "";
    sumEndInput.value = "";
    sumDriverSelect.value = "";
    renderResumenUI();
  });

  // Comisiones
  if (comiApplyBtn) comiApplyBtn.addEventListener("click", () => renderComisionesUI());
  if (comiClearBtn) comiClearBtn.addEventListener("click", () => {
    comiStartInput.value = "";
    comiEndInput.value = "";
    comiDriverSelect.value = "";
    renderComisionesUI();
  });

  // Config
  if (changePinBtn) changePinBtn.addEventListener("click", (e) => {
    e.preventDefault();
    changeAdminPin();
  });

  if (footerTextInput) {
    footerTextInput.addEventListener("input", () => {
      if (!isAdmin()) return;
      state.footerText = footerTextInput.value || "© 2025 Nexus Transport";
      saveState();
      footerTextSpan.textContent = state.footerText;
    });
  }

  if (defaultRateInput) {
    defaultRateInput.addEventListener("input", () => {
      if (!isAdmin()) return;
      const v = Number(defaultRateInput.value || 0);
      if (!isFinite(v) || v < 0 || v > 100) return;
      state.defaultRate = v;
      saveState();
    });
  }

  if (retentionRateInput) {
    retentionRateInput.addEventListener("input", () => {
      if (!isAdmin()) return;
      const v = Number(retentionRateInput.value || 0);
      if (!isFinite(v) || v < 0 || v > 100) return;
      state.retentionRate = v;
      saveState();
    });
  }

  if (allowDriverEditInput) {
    allowDriverEditInput.addEventListener("change", () => {
      if (!isAdmin()) return;
      state.allowDriverEdit = !!allowDriverEditInput.checked;
      saveState();
      renderServicesTable();
    });
  }

  // CRUD choferes
  if (addStaffBtn) addStaffBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addOrUpdateDriver();
  });

  if (resetStaffBtn) resetStaffBtn.addEventListener("click", (e) => {
    e.preventDefault();
    resetDriverForm();
  });

  if (staffTableBody) {
    staffTableBody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-driver-action]");
      if (!btn) return;
      if (!isAdmin()) return;

      const action = btn.dataset.driverAction;
      const name = btn.dataset.driverName;
      const rec = findDriverByName(name);
      if (!rec) return;

      if (action === "edit") {
        staffNameInput.value = rec.name;
        staffPinInput.value = rec.pin;
        staffRateInput.value = rec.rate;
        return;
      }

      if (action === "delete") {
        const ok = confirm(`¿Eliminar chofer "${rec.name}"?`);
        if (!ok) return;
        state.drivers = (state.drivers || []).filter(d => normalizeName(d.name).toLowerCase() !== normalizeName(rec.name).toLowerCase());
        saveState();
        renderDriversTable();
        refreshAllDriverSelects();
        resetDriverForm();
      }
    });
  }

  // Edit/Delete en tabla historial
  if (servicesTableBody) {
    servicesTableBody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      if (!canEditTickets()) return; // permisos

      const action = btn.dataset.action;
      const number = Number(btn.dataset.number);
      if (!number) return;

      if (action === "edit") editService(number);
      if (action === "delete") await deleteService(number);
    });
  }
}

/* ==============================
   Render base inicial (sin listener)
================================ */
function renderInitialUI() {
  renderBranding();
  refreshAllDriverSelects();
  renderDriversTable();
  renderServiceNumber();
  renderServicesTable(state.tickets);

  // default: fechas
  const today = new Date().toISOString().slice(0, 10);
  if (cajaStartInput) cajaStartInput.value = today;
  if (cajaEndInput) cajaEndInput.value = today;

  resetFormForNewService();
  setActivePage("dashboard");
}

/* ==============================
   Auth UI helpers (Parte 3 usará)
================================ */
function updateUserUI() {
  if (userEmailSpan) userEmailSpan.textContent = state.user?.email || "Sin conexión a Google";
}

/* ==============================
   Init UI (Parte 3 llamará init final)
================================ */
function initUIOnly() {
  renderInitialUI();
  wireUIEvents();
  showPinScreen();
}

/*************************************************
 * app.js — Nexus Transport
 * Parte 3/3 — Firebase, Listener, Cálculos (Caja/Resumen/Comisiones),
 *            Semana Jue→Jue, Init final
 *************************************************/

/* ========== CONFIG FIREBASE (TUS APIs) ========== */
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

/* ========== Firestore refs ==========
   Colección principal de servicios/tickets */
function ticketsCollectionRef() {
  return db.collection("transportTickets");
}

/* Opcional: branding (si lo usas en config) */
function brandingDocRef() {
  return db.collection("branding").doc("transport");
}

/* ========== Helpers de fechas ========= */
function toDateUTC(dateStr) {
  // dateStr: "YYYY-MM-DD"
  const d = new Date(dateStr + "T00:00:00");
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function toISODateUTC(d) {
  // Date UTC -> "YYYY-MM-DD"
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Semana Jueves→Jueves:
   start = jueves (00:00) de la semana del dateStr
   end = jueves siguiente (00:00) */
function getThuWeekRange(dateStr) {
  const d = toDateUTC(dateStr);
  const dow = d.getUTCDay(); // 0=Sun ... 4=Thu
  const THU = 4;

  // cuántos días retroceder para caer en jueves
  let diff = dow - THU;
  // si es lunes(1) => 1-4=-3 => retrocede -3? NO; queremos ir al jueves anterior, o sea +?:
  // Ajuste: normalizamos para siempre ir al jueves anterior (o hoy si jueves)
  if (diff < 0) diff += 7; // ej lunes => -3 + 7 = 4 (retrocede 4 días hasta jueves anterior)
  const start = new Date(d);
  start.setUTCDate(start.getUTCDate() - diff);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    start: toISODateUTC(start),
    end: toISODateUTC(end) // fin exclusivo (jueves siguiente)
  };
}

function inDateRange(dateStr, start, end, endInclusive = true) {
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && endInclusive && dateStr > end) return false;
  if (end && !endInclusive && dateStr >= end) return false;
  return true;
}

/* ========== Normalización métodos pago ========= */
function normalizePayMethod(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "other";
  if (s.includes("efect")) return "cash";
  if (s.includes("ath")) return "ath";
  return "other";
}

/* ========== Catalogo de categorías (editable si existe UI) =========
   Si ya lo tienes en Parte 1/3, esto NO lo pisa. */
if (!Array.isArray(state.serviceCatalog)) {
  state.serviceCatalog = [
    // Ingresos principales
    { key: "Connect", label: "Connect", type: "income", commissionable: true },
    { key: "AAA", label: "AAA", type: "income", commissionable: true },
    { key: "Cops", label: "Cops", type: "income", commissionable: true },
    { key: "Enterprise", label: "Enterprise", type: "income", commissionable: true },
    { key: "Mapfre", label: "Mapfre", type: "income", commissionable: true },
    { key: "Credito", label: "Crédito (Privadas/Clientes)", type: "income", commissionable: true },
    { key: "Erika", label: "Erika (Privados AAA/Code Pola)", type: "income", commissionable: true },

    // Servicios adicionales / extras (ingresos)
    { key: "ATH-Mobile", label: "ATH Mobile (Servicio)", type: "income", commissionable: true },
    { key: "Salvamentos", label: "Salvamentos", type: "income", commissionable: true },
    { key: "OD-Connect", label: "OD (Connect)", type: "income", commissionable: true },
    { key: "Extracciones", label: "Extracciones", type: "income", commissionable: true },

    // Gastos
    { key: "Gasto", label: "Gasto", type: "expense", commissionable: false }
  ];
  saveState();
}

function getCatalogRecord(key) {
  const k = String(key || "").trim();
  return (state.serviceCatalog || []).find(x => String(x.key) === k) || null;
}

function isIncomeTicket(t) {
  const rec = getCatalogRecord(t.category);
  if (!rec) return true; // por defecto lo tratamos como ingreso
  return rec.type !== "expense";
}

function isCommissionable(t) {
  const rec = getCatalogRecord(t.category);
  if (!rec) return true;
  return !!rec.commissionable;
}

/* ========== Comisión / Retención ========= */
function getDriverRate(driverName) {
  const rec = (state.drivers || []).find(d => String(d.name || "").toLowerCase() === String(driverName || "").toLowerCase());
  if (rec && rec.rate != null) return Number(rec.rate) || 0;
  return Number(state.defaultRate) || 0;
}

function getRetentionRate() {
  return Number(state.retentionRate) || 0;
}

/* ========== Filtros (reusa los inputs de Parte 2/3) ========= */
function getFilteredForCaja() {
  const start = cajaStartInput?.value || "";
  const end = cajaEndInput?.value || "";
  let driver = cajaDriverSelect?.value || "";

  if (isDriver()) driver = state.session.driverName || "";

  return roleFilteredTickets(state.tickets).filter(t => {
    if (!inDateRange(t.date, start, end, true)) return false;
    if (driver && t.driver !== driver) return false;
    return true;
  });
}

function getFilteredForResumen() {
  const start = sumStartInput?.value || "";
  const end = sumEndInput?.value || "";
  let driver = sumDriverSelect?.value || "";

  if (isDriver()) driver = state.session.driverName || "";

  return roleFilteredTickets(state.tickets).filter(t => {
    if (!inDateRange(t.date, start, end, true)) return false;
    if (driver && t.driver !== driver) return false;
    return true;
  });
}

function getFilteredForComisiones() {
  const start = comiStartInput?.value || "";
  const end = comiEndInput?.value || "";
  let driver = comiDriverSelect?.value || "";

  if (isDriver()) driver = state.session.driverName || "";

  return roleFilteredTickets(state.tickets).filter(t => {
    if (!inDateRange(t.date, start, end, true)) return false;
    if (driver && t.driver !== driver) return false;
    return true;
  });
}

/* ========== Cálculo: Caja ========= */
function computeCajaTotalsUI() {
  if (!cajaTotalCashSpan || !cajaTotalAthSpan || !cajaTotalOtherSpan || !cajaTotalAllSpan) return;

  const list = getFilteredForCaja();

  let cash = 0, ath = 0, other = 0;

  list.forEach(t => {
    // Caja suma ingresos (si registras gastos en efectivo, se reflejará como monto negativo si así lo registras)
    const amt = Number(t.amount || 0);
    const bucket = normalizePayMethod(t.paymentMethod);

    if (bucket === "cash") cash += amt;
    else if (bucket === "ath") ath += amt;
    else other += amt;
  });

  const all = cash + ath + other;

  cajaTotalCashSpan.textContent = `$${cash.toFixed(2)}`;
  cajaTotalAthSpan.textContent = `$${ath.toFixed(2)}`;
  cajaTotalOtherSpan.textContent = `$${other.toFixed(2)}`;
  cajaTotalAllSpan.textContent = `$${all.toFixed(2)}`;
}

/* ========== Cálculo: Resumen por categoría ========= */
function renderResumenUI() {
  if (!sumTableBody || !sumGrandTotalSpan) return;

  const list = getFilteredForResumen();

  const map = new Map(); // key -> {count, miles, total}
  let grand = 0;

  list.forEach(t => {
    const cat = t.category || "Sin categoría";
    const miles = Number(t.miles || 0);
    const amt = Number(t.amount || 0);

    if (!map.has(cat)) map.set(cat, { category: cat, count: 0, miles: 0, total: 0 });
    const rec = map.get(cat);
    rec.count += 1;
    rec.miles += (isFinite(miles) ? miles : 0);
    rec.total += (isFinite(amt) ? amt : 0);

    grand += (isFinite(amt) ? amt : 0);
  });

  const rows = Array.from(map.values()).sort((a, b) => a.category.localeCompare(b.category));

  sumTableBody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.category}</td>
      <td>${r.count}</td>
      <td>${r.miles.toFixed(2)}</td>
      <td>$${r.total.toFixed(2)}</td>
    `;
    sumTableBody.appendChild(tr);
  });

  sumGrandTotalSpan.textContent = `$${grand.toFixed(2)}`;
}

/* ========== Cálculo: Comisiones por chofer =========
   - Base: suma de AMOUNT solo para ingresos commissionables
   - Comisión: base * rate%
   - Retención: comisión * retention%
   - Neto: comisión - retención
*/
function renderComisionesUI() {
  if (!comiTableBody || !comiGrandTotalSpan) return;

  const list = getFilteredForComisiones();

  const byDriver = {};
  let netGrand = 0;

  list.forEach(t => {
    const driver = t.driver || "Sin chofer";
    const amt = Number(t.amount || 0);

    // Solo ingresos commissionables
    if (!isIncomeTicket(t)) return;
    if (!isCommissionable(t)) return;

    const rate = getDriverRate(driver);
    const commission = (amt * rate) / 100;
    const reten = (commission * getRetentionRate()) / 100;
    const net = commission - reten;

    if (!byDriver[driver]) {
      byDriver[driver] = { driver, base: 0, rate, commission: 0, reten: 0, net: 0 };
    }
    byDriver[driver].base += amt;
    byDriver[driver].commission += commission;
    byDriver[driver].reten += reten;
    byDriver[driver].net += net;

    netGrand += net;
  });

  const rows = Object.values(byDriver).sort((a, b) => a.driver.localeCompare(b.driver));

  comiTableBody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.driver}</td>
      <td>$${r.base.toFixed(2)}</td>
      <td>${Number(r.rate || 0).toFixed(1)}%</td>
      <td>$${r.commission.toFixed(2)}</td>
      <td>$${r.reten.toFixed(2)}</td>
      <td>$${r.net.toFixed(2)}</td>
    `;
    comiTableBody.appendChild(tr);
  });

  comiGrandTotalSpan.textContent = `$${netGrand.toFixed(2)}`;
}

/* ========== Cuadre Jueves→Jueves (helper UI opcional) =========
   Si en algún lugar quieres auto-setear filtros por semana del servicio:
   usa getThuWeekRange(dateStr).
*/
function setFiltersToThuWeek(dateStr) {
  const { start, end } = getThuWeekRange(dateStr);
  // end es jueves siguiente (fin exclusivo). Para UI (inclusive), usamos el día anterior:
  const endDate = toDateUTC(end);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const endInclusive = toISODateUTC(endDate);

  if (sumStartInput) sumStartInput.value = start;
  if (sumEndInput) sumEndInput.value = endInclusive;

  if (comiStartInput) comiStartInput.value = start;
  if (comiEndInput) comiEndInput.value = endInclusive;

  if (cajaStartInput) cajaStartInput.value = start;
  if (cajaEndInput) cajaEndInput.value = endInclusive;
}

/* ========== Branding en cloud (opcional) ========= */
async function loadBrandingFromCloud() {
  if (!state.user) return;
  try {
    const snap = await brandingDocRef().get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.appName) state.appName = data.appName;
      if (data.footerText !== undefined) state.footerText = data.footerText;
      if (data.defaultRate !== undefined) state.defaultRate = Number(data.defaultRate) || state.defaultRate;
      if (data.retentionRate !== undefined) state.retentionRate = Number(data.retentionRate) || state.retentionRate;
      if (data.allowDriverEdit !== undefined) state.allowDriverEdit = !!data.allowDriverEdit;
      if (Array.isArray(data.serviceCatalog)) state.serviceCatalog = data.serviceCatalog;

      saveState();
      renderBranding();
      // si el index tiene un select de categorías, aquí podrías refrescarlo (si implementaste esa parte)
    }
  } catch (e) {
    console.error("Branding cloud error:", e);
  }
}

async function saveBrandingToCloud() {
  // Solo admin
  if (!isAdmin()) return alert("Solo admin.");
  if (!state.user) return alert("Conéctate con Google para guardar configuración.");

  try {
    const payload = {
      appName: state.appName || "Nexus Transport",
      footerText: state.footerText || "© 2025 Nexus Transport",
      defaultRate: Number(state.defaultRate) || 0,
      retentionRate: Number(state.retentionRate) || 0,
      allowDriverEdit: !!state.allowDriverEdit,
      serviceCatalog: Array.isArray(state.serviceCatalog) ? state.serviceCatalog : []
    };

    await brandingDocRef().set(payload, { merge: true });
    alert("Configuración guardada en Firebase.");
  } catch (e) {
    console.error("Save branding error:", e);
    alert("No se pudo guardar configuración.");
  }
}

/* ========== Firestore Listener ========= */
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
        snap.forEach(doc => arr.push(doc.data()));
        state.tickets = arr;
        saveState();

        // UI refresh
        renderServiceNumber();
        renderServicesTable();
        computeCajaTotalsUI();
        renderResumenUI();
        renderComisionesUI();
      },
      (err) => {
        console.error("onSnapshot error", err);

        // Mensaje claro para tu screenshot
        const msg = String(err?.message || "");
        if (msg.toLowerCase().includes("missing or insufficient permissions")) {
          alert("Firebase: permisos insuficientes. Revisa las Reglas de Firestore y que estés autenticada con Google.");
        } else {
          alert("Error sincronizando con Firebase.");
        }
      }
    );
}

/* ========== Google SignIn / SignOut ========= */
async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    state.user = result.user;
    saveState();
    updateUserUI();

    await loadBrandingFromCloud();
    startTicketsListener();

    showAppShell();
    applyRoleUI();
    setActivePage("dashboard");
  } catch (err) {
    console.error("Google SignIn error:", err);
    alert("No se pudo iniciar sesión con Google.");
  }
}

async function signOutAndReset() {
  try { await auth.signOut(); } catch (e) { console.error("signOut error:", e); }

  if (state.unsubscribeTickets) {
    state.unsubscribeTickets();
    state.unsubscribeTickets = null;
  }

  state.user = null;
  saveState();
  updateUserUI();

  // Reset session local (PIN)
  state.session = { role: null, driverName: "" };
  saveState();

  showPinScreen();
}

/* ========== Auth state listener ========= */
auth.onAuthStateChanged((user) => {
  state.user = user || null;
  saveState();
  updateUserUI();

  if (user) {
    startTicketsListener();
  } else {
    if (state.unsubscribeTickets) {
      state.unsubscribeTickets();
      state.unsubscribeTickets = null;
    }
  }
});

/* ========== Conectar botones Auth ========= */
if (googleSignInBtn) googleSignInBtn.addEventListener("click", signInWithGoogle);
if (logoutBtn) logoutBtn.addEventListener("click", signOutAndReset);

/* ========== Conectar guardar config cloud (si existe botón) =========
   Si en tu index existe un botón con id="saveBrandingBtn", lo conectamos.
*/
const saveBrandingBtn = document.getElementById("saveBrandingBtn");
if (saveBrandingBtn) {
  saveBrandingBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveBrandingToCloud();
  });
}

/* ========== Auto: al cambiar nombre app ========= */
if (appNameEditable) {
  appNameEditable.addEventListener("input", () => {
    if (!isAdmin()) return;
    state.appName = appNameEditable.textContent.trim() || "Nexus Transport";
    saveState();
    renderBranding();
  });
}

/* ========== Init Final ========= */
function init() {
  // Tu Parte 1/3 debe traer loadState() y state base.
  // Si no existiera, esto revienta, pero tu app ya lo tiene.
  loadState();

  // UI (Parte 2/3)
  initUIOnly();

  // Branding local
  renderBranding();

  // selects iniciales
  refreshAllDriverSelects();
  renderDriversTable();
  renderServicesTable(state.tickets);

  // Fechas por defecto (hoy)
  const today = new Date().toISOString().slice(0, 10);
  if (cajaStartInput) cajaStartInput.value = today;
  if (cajaEndInput) cajaEndInput.value = today;

  // Si quieres que por defecto el cuadre sea Jue→Jue del día de hoy:
  // setFiltersToThuWeek(today);

  // Cálculos iniciales
  computeCajaTotalsUI();
  renderResumenUI();
  renderComisionesUI();

  // PWA service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((err) => console.error("SW error", err));
  }
}

init();
