/*************************************************
 * app.js — Nexus Transport (COMPLETO)
 * Parte 1/4 — Firebase, Estado, Helpers base
 *************************************************/

/* ========== FIREBASE CONFIG (TUS APIs) ========== */
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
  pin: "058312",

  session: {
    role: null,        // "admin" | "driver"
    driverName: ""
  },

  appName: "Nexus Transport",
  footerText: "© 2026 Nexus Transport — Cuadres",

  defaultRate: 30,
  retentionRate: 10,
  allowDriverEdit: false,

  drivers: [
    { name: "Erika", pin: "1111", rate: 30 },
    { name: "Jose",  pin: "2222", rate: 25 }
  ],

  tickets: [],

  user: null,
  unsubscribeTickets: null
};

/* ========== STORAGE ========= */
function loadState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };

      if (!state.session) state.session = { role: null, driverName: "" };
      if (!Array.isArray(state.drivers)) state.drivers = [];
      if (!Array.isArray(state.tickets)) state.tickets = [];

      if (state.defaultRate == null) state.defaultRate = 30;
      if (state.retentionRate == null) state.retentionRate = 10;
      if (state.allowDriverEdit == null) state.allowDriverEdit = false;

      // fallback choferes
      if (!state.drivers.length) state.drivers = [{ name: "Erika", pin: "1111", rate: 30 }];
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

/* ========== HELPERS BASE ========= */
function normalizeName(s) {
  return String(s || "").trim();
}
function money(n) {
  const v = Number(n || 0);
  return isFinite(v) ? v : 0;
}
function milesNum(n) {
  const v = Number(n || 0);
  return isFinite(v) ? v : 0;
}
function isAdmin() {
  return state.session?.role === "admin";
}
function isDriver() {
  return state.session?.role === "driver";
}
function canEditTickets() {
  return isAdmin() || !!state.allowDriverEdit;
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
function getRetentionRate() {
  return Number(state.retentionRate) || 0;
}

/* ========= FECHAS: helpers ========= */
function inDateRange(dateStr, start, end, inclusive = true) {
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && inclusive && dateStr > end) return false;
  if (end && !inclusive && dateStr >= end) return false;
  return true;
}

/* Semana JUE→JUE: devuelve start (jueves) y endExclusive (jueves siguiente) */
function getThuWeekRange(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const THU = 4; // getDay(): 0 dom ... 4 jue
  const dow = d.getDay();

  let diff = dow - THU;
  if (diff < 0) diff += 7;

  const start = new Date(d);
  start.setDate(start.getDate() - diff);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return {
    start: start.toISOString().slice(0, 10),
    endExclusive: end.toISOString().slice(0, 10)
  };
}

function setFiltersToThuWeek(dateStr, inputs) {
  const { start, endExclusive } = getThuWeekRange(dateStr);
  const endInc = new Date(endExclusive + "T00:00:00");
  endInc.setDate(endInc.getDate() - 1);
  const endInclusive = endInc.toISOString().slice(0, 10);

  // inputs: {cajaStart,cajaEnd,sumStart,sumEnd,comiStart,comiEnd}
  if (inputs?.cajaStart) inputs.cajaStart.value = start;
  if (inputs?.cajaEnd) inputs.cajaEnd.value = endInclusive;
  if (inputs?.sumStart) inputs.sumStart.value = start;
  if (inputs?.sumEnd) inputs.sumEnd.value = endInclusive;
  if (inputs?.comiStart) inputs.comiStart.value = start;
  if (inputs?.comiEnd) inputs.comiEnd.value = endInclusive;
}
/*************************************************
 * app.js — Nexus Transport
 * Parte 2/4 — DOM refs + UI base + Branding + Selects
 *************************************************/

/* ========== DOM: SCREENS ========= */
const pinScreen  = document.getElementById("pinScreen");
const authScreen = document.getElementById("authScreen");
const appShell   = document.getElementById("appShell");

/* ========== PIN ========= */
const pinInput     = document.getElementById("pinInput");
const pinEnterBtn  = document.getElementById("pinEnterBtn");
const empNameInput = document.getElementById("empNameInput");
const empPinInput  = document.getElementById("empPinInput");
const empEnterBtn  = document.getElementById("empEnterBtn");
const pinError     = document.getElementById("pinError");

/* ========== AUTH ========= */
const googleSignInBtn   = document.getElementById("googleSignInBtn");
const authBackToPinBtn  = document.getElementById("authBackToPinBtn");

/* ========== TOPBAR ========= */
const appNameEditable = document.getElementById("appNameEditable");
const pinAppNameTitle = document.getElementById("pinAppName");
const userEmailSpan   = document.getElementById("userEmail");
const logoutBtn       = document.getElementById("logoutBtn");
const appLogoImg      = document.getElementById("appLogo");
const pinLogoImg      = document.getElementById("pinLogo");
const footerTextSpan  = document.getElementById("footerText");
const navButtons      = Array.from(document.querySelectorAll(".nav-btn"));
const sessionSubtitle = document.getElementById("sessionSubtitle");

/* ========== PAGES ========= */
const pages = {
  dashboard:  document.getElementById("page-dashboard"),
  historial:  document.getElementById("page-historial"),
  caja:       document.getElementById("page-caja"),
  resumen:    document.getElementById("page-resumen"),
  comisiones: document.getElementById("page-comisiones"),
  config:     document.getElementById("page-config")
};

/* ========== DASHBOARD ========= */
const serviceNumberInput  = document.getElementById("serviceNumber");
const serviceDateInput    = document.getElementById("serviceDate");
const driverSelect        = document.getElementById("driver");
const driverCustomInput   = document.getElementById("driverCustom");
const paymentMethodSelect = document.getElementById("paymentMethod");
const categorySelect      = document.getElementById("category");
const amountInput         = document.getElementById("amount");
const milesInput          = document.getElementById("miles");
const descriptionInput    = document.getElementById("description");
const notesInput          = document.getElementById("notes");
const newServiceBtn       = document.getElementById("newServiceBtn");
const saveServiceBtn      = document.getElementById("saveServiceBtn");
const formMessage         = document.getElementById("formMessage");

/* ========== HISTORIAL ========= */
const servicesTableBody    = document.getElementById("servicesTableBody");
const filterStartInput     = document.getElementById("filterStart");
const filterEndInput       = document.getElementById("filterEnd");
const filterDriverSelect   = document.getElementById("filterDriver");
const filterCategorySelect = document.getElementById("filterCategory");
const applyFilterBtn       = document.getElementById("applyFilterBtn");
const clearFilterBtn       = document.getElementById("clearFilterBtn");
const backupJsonBtn        = document.getElementById("backupJsonBtn");

/* ========== CAJA ========= */
const cajaStartInput      = document.getElementById("cajaStart");
const cajaEndInput        = document.getElementById("cajaEnd");
const cajaDriverSelect    = document.getElementById("cajaDriver");
const cajaApplyBtn        = document.getElementById("cajaApplyBtn");
const cajaClearBtn        = document.getElementById("cajaClearBtn");
const cajaTotalCashSpan   = document.getElementById("cajaTotalCash");
const cajaTotalAthSpan    = document.getElementById("cajaTotalAth");
const cajaTotalOtherSpan  = document.getElementById("cajaTotalOther");
const cajaTotalAllSpan    = document.getElementById("cajaTotalAll");

/* ========== RESUMEN ========= */
const sumStartInput       = document.getElementById("sumStart");
const sumEndInput         = document.getElementById("sumEnd");
const sumDriverSelect     = document.getElementById("sumDriver");
const sumApplyBtn         = document.getElementById("sumApplyBtn");
const sumClearBtn         = document.getElementById("sumClearBtn");
const sumTableBody        = document.getElementById("sumTableBody");
const sumGrandTotalSpan   = document.getElementById("sumGrandTotal");

/* ========== COMISIONES ========= */
const comiStartInput      = document.getElementById("comiStart");
const comiEndInput        = document.getElementById("comiEnd");
const comiDriverSelect    = document.getElementById("comiDriver");
const comiApplyBtn        = document.getElementById("comiApplyBtn");
const comiClearBtn        = document.getElementById("comiClearBtn");
const comiTableBody       = document.getElementById("comiTableBody");
const comiGrandTotalSpan  = document.getElementById("comiGrandTotal");

/* ========== CONFIG ========= */
const footerTextInput          = document.getElementById("footerTextInput");
const newPinInput              = document.getElementById("newPinInput");
const changePinBtn             = document.getElementById("changePinBtn");
const pinChangeMessage         = document.getElementById("pinChangeMessage");
const defaultRateInput         = document.getElementById("defaultRateInput");
const retentionRateInput       = document.getElementById("retentionRateInput");
const allowDriverEditCheckbox  = document.getElementById("allowDriverEdit");

/* ========== CONFIG: CHOFERES CRUD ========= */
const adminArea      = document.getElementById("adminArea");
const staffNameInput = document.getElementById("staffNameInput");
const staffPinInput  = document.getElementById("staffPinInput");
const staffRateInput = document.getElementById("staffRateInput");
const addStaffBtn    = document.getElementById("addStaffBtn");
const resetStaffBtn  = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

/* ========== UI: SHOW/HIDE ========= */
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

/* ========== NAV ========= */
function setActivePage(pageName) {
  if (isDriver() && !["dashboard", "historial"].includes(pageName)) pageName = "dashboard";

  Object.keys(pages).forEach(k => pages[k]?.classList.toggle("active-page", k === pageName));
  navButtons.forEach(btn => btn.classList.toggle("nav-btn-active", btn.getAttribute("data-page") === pageName));

  if (pageName === "caja") computeCajaTotals();
  if (pageName === "resumen") renderResumen();
  if (pageName === "comisiones") renderComisiones();
}

/* ========== UI ROLE ========= */
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
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — control total";
    if (adminArea) adminArea.style.display = "";
  } else {
    adminEls.forEach(el => el.style.display = "none");
    adminNavBtns.forEach(btn => btn.style.display = "none");
    if (driverCustomInput) {
      driverCustomInput.value = "";
      driverCustomInput.disabled = true;
      driverCustomInput.placeholder = "Solo admin";
    }
    if (sessionSubtitle) sessionSubtitle.textContent = `Chofer: ${state.session.driverName} — Cuadre Jue→Jue`;
    if (adminArea) adminArea.style.display = "none";

    const active = Object.keys(pages).find(k => pages[k]?.classList.contains("active-page")) || "dashboard";
    if (!["dashboard", "historial"].includes(active)) setActivePage("dashboard");
  }

  refreshAllDriverSelects();
}

/* ========== BRANDING ========= */
function renderBranding() {
  if (appNameEditable) appNameEditable.textContent = state.appName || "Nexus Transport";
  if (pinAppNameTitle) pinAppNameTitle.textContent = state.appName || "Nexus Transport";

  if (footerTextInput) footerTextInput.value = state.footerText || "";
  if (footerTextSpan) footerTextSpan.textContent = state.footerText || "";

  if (defaultRateInput) defaultRateInput.value = String(state.defaultRate ?? 30);
  if (retentionRateInput) retentionRateInput.value = String(state.retentionRate ?? 10);
  if (allowDriverEditCheckbox) allowDriverEditCheckbox.checked = !!state.allowDriverEdit;

  const logoSrc = "assets/logo.png";
  if (appLogoImg) appLogoImg.src = logoSrc;
  if (pinLogoImg) pinLogoImg.src = logoSrc;
}

function updateUserUI() {
  if (userEmailSpan) userEmailSpan.textContent = state.user?.email || "Sin conexión a Google";
}

/* ========== SELECTS: CHOFER ========= */
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

  if (Array.from(selectEl.options).some(o => o.value === current)) selectEl.value = current;
}

function refreshAllDriverSelects() {
  fillDriverSelect(driverSelect, { includeEmpty: true });
  fillDriverSelect(filterDriverSelect, { includeAll: true });
  fillDriverSelect(cajaDriverSelect, { includeAll: true });
  fillDriverSelect(sumDriverSelect, { includeAll: true });
  fillDriverSelect(comiDriverSelect, { includeAll: true });
}
/*************************************************
 * app.js — Nexus Transport
 * Parte 3/4 — Form, Historial, CRUD, Eventos
 *************************************************/

let currentEditingNumber = null;

/* ========== NUMERACIÓN ========= */
function nextServiceNumber() {
  if (!state.tickets.length) return 1;
  const max = state.tickets.reduce((m, t) => Math.max(m, Number(t.number || 0)), 0);
  return max + 1;
}
function renderServiceNumber() {
  if (serviceNumberInput) serviceNumberInput.value = nextServiceNumber();
}

/* ========== FORM RESET ========= */
function resetFormForNewService() {
  const today = new Date().toISOString().slice(0, 10);
  if (serviceDateInput) serviceDateInput.value = today;

  if (isDriver()) {
    if (driverSelect) driverSelect.value = state.session.driverName || "";
    if (driverCustomInput) driverCustomInput.value = "";
  } else {
    if (driverSelect) driverSelect.value = "";
    if (driverCustomInput) driverCustomInput.value = "";
  }

  if (paymentMethodSelect) paymentMethodSelect.value = "";
  if (categorySelect) categorySelect.value = "";
  if (amountInput) amountInput.value = "";
  if (milesInput) milesInput.value = "";
  if (descriptionInput) descriptionInput.value = "";
  if (notesInput) notesInput.value = "";

  renderServiceNumber();
  if (formMessage) formMessage.textContent = "";
  currentEditingNumber = null;
}

/* ========== COLLECT ========= */
function collectServiceFromForm() {
  const number = Number(serviceNumberInput?.value || 0);
  const date = serviceDateInput?.value || "";

  let driver = "";
  if (isDriver()) {
    driver = state.session.driverName || "";
  } else {
    const pre = driverSelect?.value || "";
    const custom = (driverCustomInput?.value || "").trim();
    driver = custom || pre || "";
  }

  const paymentMethod = paymentMethodSelect?.value || "";
  const category = categorySelect?.value || "";
  const amount = money(amountInput?.value);
  const miles = milesNum(milesInput?.value);
  const description = (descriptionInput?.value || "").trim();
  const notes = (notesInput?.value || "").trim();

  if (!number || !date || !driver || !paymentMethod || !category) {
    throw new Error("Completa: Fecha, Chofer, Método y Categoría.");
  }
  if (amount < 0) throw new Error("Monto inválido.");
  if (miles < 0) throw new Error("Millas inválidas.");

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

/* ========== FILTROS HISTORIAL ========= */
function roleFilteredTickets(list) {
  if (!isDriver()) return list || [];
  const me = state.session.driverName;
  return (list || []).filter(t => (t.driver || "") === me);
}

function getFilteredTickets() {
  const start = filterStartInput?.value || "";
  const end = filterEndInput?.value || "";
  let driver = filterDriverSelect?.value || "";
  const cat = filterCategorySelect?.value || "";

  if (isDriver()) driver = state.session.driverName || "";

  return roleFilteredTickets(state.tickets).filter(t => {
    if (!inDateRange(t.date, start, end, true)) return false;
    if (driver && t.driver !== driver) return false;
    if (cat && t.category !== cat) return false;
    return true;
  });
}

/* ========== RENDER TABLA ========= */
function renderServicesTable(listOverride) {
  if (!servicesTableBody) return;

  const base = listOverride || state.tickets;
  const list = roleFilteredTickets(base);

  servicesTableBody.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.number || ""}</td>
        <td>${t.date || ""}</td>
        <td>${t.driver || ""}</td>
        <td>${t.category || ""}</td>
        <td>${t.paymentMethod || ""}</td>
        <td>${milesNum(t.miles).toFixed(2)}</td>
        <td>$${money(t.amount).toFixed(2)}</td>
        <td>${(t.description || "").substring(0, 40)}</td>
        <td class="nav-admin" style="${canEditTickets() ? "" : "display:none"}">
          <button class="btn-table edit" data-action="edit" data-number="${t.number}">Editar</button>
          <button class="btn-table delete" data-action="delete" data-number="${t.number}">X</button>
        </td>
      `;
      servicesTableBody.appendChild(tr);
    });
}

/* ========== CRUD CHOFERES ========= */
function renderDriversTable() {
  if (!staffTableBody) return;
  staffTableBody.innerHTML = "";

  (state.drivers || [])
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)))
    .forEach(d => {
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
  if (staffNameInput) staffNameInput.value = "";
  if (staffPinInput) staffPinInput.value = "";
  if (staffRateInput) staffRateInput.value = "";
}

function addOrUpdateDriver() {
  if (!isAdmin()) return;

  const name = normalizeName(staffNameInput?.value);
  const pin = String(staffPinInput?.value || "").trim();
  const rate = Number(staffRateInput?.value || 0);

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

/* ========== CONFIG: PIN ADMIN ========= */
function changeAdminPin() {
  if (!isAdmin()) return alert("Solo admin.");
  const newPin = String(newPinInput?.value || "").trim();
  if (!newPin || newPin.length < 4) {
    if (pinChangeMessage) pinChangeMessage.textContent = "El PIN debe tener al menos 4 dígitos.";
    return;
  }
  state.pin = newPin;
  saveState();
  if (pinChangeMessage) pinChangeMessage.textContent = "PIN actualizado.";
  if (newPinInput) newPinInput.value = "";
}

/* ========== BACKUP ========= */
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

/* ========== EDIT/DELETE ========= */
function editService(number) {
  const t = state.tickets.find(x => Number(x.number) === Number(number));
  if (!t) return;

  currentEditingNumber = Number(number);

  serviceNumberInput.value = t.number;
  serviceDateInput.value = t.date;

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
  amountInput.value = money(t.amount);
  milesInput.value = milesNum(t.miles);
  descriptionInput.value = t.description || "";
  notesInput.value = t.notes || "";

  formMessage.textContent = `Editando servicio #${t.number}`;
  setActivePage("dashboard");
}

async function deleteService(number) {
  if (!state.user) return alert("Conéctate con Google para eliminar.");
  const ok = confirm(`¿Eliminar el servicio #${number}?`);
  if (!ok) return;
  await ticketsCollectionRef().doc(String(number)).delete();
}

/* ========== SAVE SERVICE ========= */
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
    await ticketsCollectionRef().doc(String(ticket.number)).set(ticket, { merge: true });

    formMessage.textContent = currentEditingNumber ? "Servicio actualizado." : "Servicio guardado y sincronizado.";
    currentEditingNumber = null;
    resetFormForNewService();
  } catch (err) {
    console.error(err);
    formMessage.textContent = err.message || "Error al guardar.";
  }
}

/* ========== EVENTS ========= */
function wireUIEvents() {
  // nav
  navButtons.forEach(btn => btn.addEventListener("click", () => setActivePage(btn.getAttribute("data-page"))));

  // dashboard
  if (newServiceBtn) newServiceBtn.addEventListener("click", (e) => { e.preventDefault(); resetFormForNewService(); });
  if (saveServiceBtn) saveServiceBtn.addEventListener("click", (e) => { e.preventDefault(); saveService(); });

  // historial
  if (applyFilterBtn) applyFilterBtn.addEventListener("click", () => renderServicesTable(getFilteredTickets()));
  if (clearFilterBtn) clearFilterBtn.addEventListener("click", () => {
    if (filterStartInput) filterStartInput.value = "";
    if (filterEndInput) filterEndInput.value = "";
    if (!isDriver() && filterDriverSelect) filterDriverSelect.value = "";
    if (filterCategorySelect) filterCategorySelect.value = "";
    renderServicesTable();
  });

  if (backupJsonBtn) backupJsonBtn.addEventListener("click", downloadBackupJson);

  // config
  if (changePinBtn) changePinBtn.addEventListener("click", (e) => { e.preventDefault(); changeAdminPin(); });

  if (footerTextInput) footerTextInput.addEventListener("input", () => {
    if (!isAdmin()) return;
    state.footerText = footerTextInput.value || state.footerText;
    saveState();
    if (footerTextSpan) footerTextSpan.textContent = state.footerText;
  });

  if (defaultRateInput) defaultRateInput.addEventListener("input", () => {
    if (!isAdmin()) return;
    const v = Number(defaultRateInput.value || 0);
    if (!isFinite(v) || v < 0 || v > 100) return;
    state.defaultRate = v;
    saveState();
  });

  if (retentionRateInput) retentionRateInput.addEventListener("input", () => {
    if (!isAdmin()) return;
    const v = Number(retentionRateInput.value || 0);
    if (!isFinite(v) || v < 0 || v > 100) return;
    state.retentionRate = v;
    saveState();
  });

  if (allowDriverEditCheckbox) allowDriverEditCheckbox.addEventListener("change", () => {
    if (!isAdmin()) return;
    state.allowDriverEdit = !!allowDriverEditCheckbox.checked;
    saveState();
    renderServicesTable();
  });

  // choferes crud
  if (addStaffBtn) addStaffBtn.addEventListener("click", (e) => { e.preventDefault(); addOrUpdateDriver(); });
  if (resetStaffBtn) resetStaffBtn.addEventListener("click", (e) => { e.preventDefault(); resetDriverForm(); });

  if (staffTableBody) {
    staffTableBody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-driver-action]");
      if (!btn || !isAdmin()) return;

      const action = btn.dataset.driverAction;
      const name = btn.dataset.driverName;
      const rec = findDriverByName(name);
      if (!rec) return;

      if (action === "edit") {
        staffNameInput.value = rec.name;
        staffPinInput.value = rec.pin;
        staffRateInput.value = rec.rate;
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

  // edit/delete en historial
  if (servicesTableBody) {
    servicesTableBody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      if (!canEditTickets()) return;

      const action = btn.dataset.action;
      const number = Number(btn.dataset.number);
      if (!number) return;

      if (action === "edit") editService(number);
      if (action === "delete") await deleteService(number);
    });
  }
}
/*************************************************
 * app.js — Nexus Transport
 * Parte 4/4 — Init final, seguridad y arranque
 *************************************************/

/* ========== PROTECCIÓN ANTI-DUPLICADO ==========
   Evita que el script se ejecute 2 veces por error
*/
if (window.__NEXUS_TRANSPORT_LOADED__) {
  console.warn("Nexus Transport ya estaba cargado. Abortando segunda ejecución.");
  throw new Error("Duplicated app.js execution");
}
window.__NEXUS_TRANSPORT_LOADED__ = true;

/* ========== INIT FINAL ==========
   ÚNICO punto de arranque de la app
*/
function initApp() {
  try {
    // 1️⃣ Estado local
    loadState();

    // 2️⃣ UI base (DOM + eventos)
    initUIOnly();

    // 3️⃣ Branding local
    renderBranding();

    // 4️⃣ Selects / tablas
    refreshAllDriverSelects();
    renderDriversTable();
    renderServicesTable(state.tickets);

    // 5️⃣ Fechas por defecto (HOY)
    const today = new Date().toISOString().slice(0, 10);

    if (cajaStartInput) cajaStartInput.value = today;
    if (cajaEndInput) cajaEndInput.value = today;

    if (sumStartInput) sumStartInput.value = today;
    if (sumEndInput) sumEndInput.value = today;

    if (comiStartInput) comiStartInput.value = today;
    if (comiEndInput) comiEndInput.value = today;

    // 6️⃣ Cálculos iniciales
    computeCajaTotalsUI();
    renderResumenUI();
    renderComisionesUI();

    // 7️⃣ Vista inicial
    showPinScreen();

    console.log("Nexus Transport listo");
  } catch (err) {
    console.error("Error crítico al iniciar la app:", err);
    alert("Error crítico al iniciar Nexus Transport.");
  }
}

/* ========== FIREBASE AUTH STATE ==========
   Listener ÚNICO
*/
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

/* ========== BOTONES AUTH ========= */
if (googleSignInBtn) googleSignInBtn.addEventListener("click", signInWithGoogle);
if (logoutBtn) logoutBtn.addEventListener("click", signOutAndReset);

/* ========== BRANDING LIVE ========= */
if (appNameEditable) {
  appNameEditable.addEventListener("input", () => {
    if (!isAdmin()) return;
    state.appName = appNameEditable.textContent.trim() || "Nexus Transport";
    saveState();
    renderBranding();
  });
}

/* ========== SERVICE WORKER ========= */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

/* ========== ARRANQUE ========= */
initApp();
