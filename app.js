// app.js — Nexus Transport (Firestore, PIN, páginas + Caja + Resumen) + Admin/Chofer + Millas SIEMPRE manual

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
    role: null,       // "admin" | "driver"
    employeeName: "", // si es chofer
    driverName: ""    // chofer asociado
  },

  appName: "Nexus Transport",
  logoUrl: "",
  footerText: "© 2026 Nexus Transport — Cuadres",

  // Branding (cloud)
  pdfHeaderText: "",
  pdfFooterText: "",

  // Servicios
  services: [],

  // Choferes (editable en Config) + % descuento (de tu hoja: 0.30)
  // rate = % descuento/participación del chofer (ej 30 = 30% del total)
  staff: [
    { name: "Adolfo Mejia", pin: "1111", rate: 30 }
  ],
  defaultRate: 30,

  user: null,
  unsubscribeServices: null
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

      if (!Array.isArray(state.staff)) state.staff = [];
      if (!state.staff.length) {
        state.staff = [{ name: "Adolfo Mejia", pin: "1111", rate: 30 }];
      }
      if (!state.session) state.session = { role: null, employeeName: "", driverName: "" };
      if (state.defaultRate == null) state.defaultRate = 30;
      if (!Array.isArray(state.services)) state.services = [];
    }
  } catch (e) {
    console.error("Error leyendo localStorage", e);
  }
}

function saveState() {
  const copy = { ...state };
  delete copy.user;
  delete copy.unsubscribeServices;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

/* ========== FIRESTORE: REFERENCIAS ========== */
function servicesCollectionRef() {
  return db.collection("transportServices");
}
function brandingDocRef() {
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

// PIN Chofer
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

// pages
const pages = {
  dashboard: document.getElementById("page-dashboard"),
  historial: document.getElementById("page-historial"),
  caja: document.getElementById("page-caja"),
  config: document.getElementById("page-config"),
  resumen: document.getElementById("page-resumen")
};

// dashboard form
const serviceNumberInput = document.getElementById("serviceNumber");
const serviceDateInput = document.getElementById("serviceDate");
const driverSelect = document.getElementById("driver");
const driverCustomInput = document.getElementById("driverCustom");
const paymentMethodSelect = document.getElementById("paymentMethod");
const categorySelect = document.getElementById("category");
const descriptionInput = document.getElementById("description");
const milesInput = document.getElementById("miles"); // ✅ SIEMPRE
const amountInput = document.getElementById("amount");
const notesInput = document.getElementById("notes");

const newServiceBtn = document.getElementById("newServiceBtn");
const saveServiceBtn = document.getElementById("saveServiceBtn");
const formMessage = document.getElementById("formMessage");

// historial
const servicesTableBody = document.getElementById("servicesTableBody");
const filterStartInput = document.getElementById("filterStart");
const filterEndInput = document.getElementById("filterEnd");
const filterDriverSelect = document.getElementById("filterDriver");
const filterCategorySelect = document.getElementById("filterCategory");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const backupJsonBtn = document.getElementById("backupJsonBtn");

// caja
const cajaStartInput = document.getElementById("cajaStart");
const cajaEndInput = document.getElementById("cajaEnd");
const cajaDriverSelect = document.getElementById("cajaDriver");
const cajaApplyBtn = document.getElementById("cajaApplyBtn");
const cajaClearBtn = document.getElementById("cajaClearBtn");
const cajaTotalCashSpan = document.getElementById("cajaTotalCash");
const cajaTotalAthSpan = document.getElementById("cajaTotalAth");
const cajaTotalOtherSpan = document.getElementById("cajaTotalOther");
const cajaTotalAllSpan = document.getElementById("cajaTotalAll");

// resumen
const sumStartInput = document.getElementById("sumStart");
const sumEndInput = document.getElementById("sumEnd");
const sumDriverSelect = document.getElementById("sumDriver");
const sumApplyBtn = document.getElementById("sumApplyBtn");
const sumClearBtn = document.getElementById("sumClearBtn");
const sumTableBody = document.getElementById("sumTableBody");
const sumGrandTotal = document.getElementById("sumGrandTotal");

// config
const footerTextInput = document.getElementById("footerTextInput");
const newPinInput = document.getElementById("newPinInput");
const changePinBtn = document.getElementById("changePinBtn");
const pinChangeMessage = document.getElementById("pinChangeMessage");
const adminArea = document.getElementById("adminArea");

const staffNameInput = document.getElementById("staffNameInput");
const staffPinInput = document.getElementById("staffPinInput");
const addStaffBtn = document.getElementById("addStaffBtn");
const resetStaffBtn = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

/* ========== ROLE / PERMISOS ========== */
function isAdmin() { return state.session?.role === "admin"; }
function isDriver() { return state.session?.role === "driver"; }

/* ========== CHOFERES DINÁMICOS ========== */
function normalizeName(s) { return String(s || "").trim(); }
function staffNames() { return (state.staff || []).map(x => x.name).filter(Boolean); }

function findStaffByName(name) {
  const n = normalizeName(name).toLowerCase();
  return (state.staff || []).find(s => normalizeName(s.name).toLowerCase() === n) || null;
}

function getRateForDriver(driver) {
  const rec = findStaffByName(driver);
  if (rec && rec.rate != null) return Number(rec.rate) || 0;
  return Number(state.defaultRate) || 0;
}

/* ========== SELECTS ==========
   Admin: todos + "Seleccionar..."
   Chofer: solo el suyo */
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

  const names = staffNames();

  if (isDriver()) {
    const only = state.session.driverName || state.session.employeeName;
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

function refreshAllDriverSelects() {
  fillDriverSelect(driverSelect, { includeEmpty: true });
  fillDriverSelect(filterDriverSelect, { includeAll: true });
  fillDriverSelect(cajaDriverSelect, { includeAll: true });
  fillDriverSelect(sumDriverSelect, { includeAll: true });
}

/* ========== UI por rol ==========
   Chofer: solo Dashboard + Historial */
function applyRoleUI() {
  const adminEls = Array.from(document.querySelectorAll(".nav-admin"));
  const adminNavBtns = Array.from(document.querySelectorAll(".nav-btn.nav-admin"));

  if (isAdmin()) {
    adminEls.forEach(el => (el.style.display = ""));
    adminNavBtns.forEach(btn => (btn.style.display = ""));

    if (driverCustomInput) {
      driverCustomInput.disabled = false;
      driverCustomInput.placeholder = "Otro chofer (opcional)";
    }
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — control total";
    if (adminArea) adminArea.style.display = "";
    if (footerTextInput) footerTextInput.disabled = false;
    if (appNameEditable) appNameEditable.contentEditable = "true";
  } else {
    adminEls.forEach(el => (el.style.display = "none"));
    adminNavBtns.forEach(btn => (btn.style.display = "none"));

    if (driverCustomInput) {
      driverCustomInput.value = "";
      driverCustomInput.disabled = true;
      driverCustomInput.placeholder = "Solo admin";
    }
    if (sessionSubtitle) sessionSubtitle.textContent =
      `Chofer: ${state.session.employeeName} — Semana (Jue→Jue)`;

    if (adminArea) adminArea.style.display = "none";
    if (footerTextInput) footerTextInput.disabled = true;
    if (appNameEditable) appNameEditable.contentEditable = "false";

    // si estaba en admin tab, envía a dashboard
    const allowed = ["dashboard", "historial"];
    const active = Object.keys(pages).find(k => pages[k].classList.contains("active-page")) || "dashboard";
    if (!allowed.includes(active)) setActivePage("dashboard");
  }

  refreshAllDriverSelects();
}

/* ========== RENDER BRANDING ========== */
function renderBranding() {
  appNameEditable.textContent = state.appName || "Nexus Transport";
  pinAppNameTitle.textContent = state.appName || "Nexus Transport";

  const logoSrc = state.logoUrl && state.logoUrl.trim() !== "" ? state.logoUrl.trim() : "assets/logo.png";
  if (appLogoImg) appLogoImg.src = logoSrc;
  if (pinLogoImg) pinLogoImg.src = logoSrc;

  if (footerTextSpan) footerTextSpan.textContent = state.footerText || "© 2026 Nexus Transport — Cuadres";
  if (footerTextInput) footerTextInput.value = state.footerText || "© 2026 Nexus Transport — Cuadres";
}

/* ========== NUMERACIÓN ==========
   igual que Nexus Salon */
function nextServiceNumber() {
  if (!state.services.length) return 1;
  const max = state.services.reduce((m, s) => Math.max(m, Number(s.number || 0)), 0);
  return max + 1;
}
function renderServiceNumber() {
  serviceNumberInput.value = nextServiceNumber();
}

/* ========== FILTRO POR CHOFER ==========
   Chofer solo ve los suyos */
function roleFilteredServices(list) {
  if (!isDriver()) return list;
  const me = state.session.driverName || state.session.employeeName;
  return (list || []).filter(s => (s.driver || "") === me);
}

/* ========== TABLA HISTORIAL ========== */
function renderServicesTable(listOverride) {
  const base = listOverride || state.services;
  const list = roleFilteredServices(base);

  servicesTableBody.innerHTML = "";
  list
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.number || ""}</td>
        <td>${s.date || ""}</td>
        <td>${s.driver || ""}</td>
        <td>${s.category || ""}</td>
        <td>${s.paymentMethod || ""}</td>
        <td>${Number(s.miles || 0).toFixed(2)}</td>
        <td>$${Number(s.amount || 0).toFixed(2)}</td>
        <td>${(s.description || "").substring(0, 28)}</td>
        <td class="nav-admin">
          <button class="btn-table edit" data-action="edit" data-number="${s.number}">Editar</button>
          <button class="btn-table delete" data-action="delete" data-number="${s.number}">X</button>
        </td>
      `;
      servicesTableBody.appendChild(tr);
    });
}

/* ========== CAJA (admin) ==========
   Totales por método + filtro chofer */
function computeCajaTotals() {
  if (!isAdmin()) return;

  const start = cajaStartInput.value;
  const end = cajaEndInput.value;
  const driver = cajaDriverSelect?.value || "";

  let cash = 0, ath = 0, other = 0;

  state.services.forEach((s) => {
    if (!s.date) return;
    if (start && s.date < start) return;
    if (end && s.date > end) return;
    if (driver && s.driver !== driver) return;

    const amt = Number(s.amount || 0);
    const method = s.paymentMethod || "";

    if (method === "Cash") cash += amt;
    else if (method === "ATH Móvil") ath += amt;
    else other += amt;
  });

  const all = cash + ath + other;

  cajaTotalCashSpan.textContent = `$${cash.toFixed(2)}`;
  cajaTotalAthSpan.textContent = `$${ath.toFixed(2)}`;
  cajaTotalOtherSpan.textContent = `$${other.toFixed(2)}`;
  cajaTotalAllSpan.textContent = `$${all.toFixed(2)}`;
}

/* ========== RESUMEN (admin) ==========
   Agrupa por categoría: count, millas, total $ */
function getFilteredServicesForSummary() {
  if (!isAdmin()) return [];
  const start = sumStartInput?.value || "";
  const end = sumEndInput?.value || "";
  const driver = sumDriverSelect?.value || "";

  return state.services.filter((s) => {
    if (!s.date) return false;
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    if (driver && s.driver !== driver) return false;
    return true;
  });
}

function renderSummary() {
  if (!isAdmin()) return;
  if (!sumTableBody || !sumGrandTotal) return;

  const list = getFilteredServicesForSummary();
  const byCat = {};
  let grand = 0;

  list.forEach((s) => {
    const cat = s.category || "Sin categoría";
    const miles = Number(s.miles || 0);
    const amt = Number(s.amount || 0);

    if (!byCat[cat]) byCat[cat] = { cat, count: 0, miles: 0, total: 0 };
    byCat[cat].count += 1;
    byCat[cat].miles += miles;
    byCat[cat].total += amt;
    grand += amt;
  });

  const rows = Object.values(byCat).sort((a, b) => a.cat.localeCompare(b.cat));
  sumTableBody.innerHTML = "";

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.cat}</td>
      <td>${r.count}</td>
      <td>${r.miles.toFixed(2)}</td>
      <td>$${r.total.toFixed(2)}</td>
    `;
    sumTableBody.appendChild(tr);
  });

  sumGrandTotal.textContent = `$${grand.toFixed(2)}`;
}

/* ========== CONFIG: STAFF (CRUD) ==========
   Ahora incluye rate (% participación) */
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
        <td>${String(s.pin || "")}</td>
        <td>${Number(s.rate ?? state.defaultRate).toFixed(1)}%</td>
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

  // rate lo pedimos por prompt simple para no tocar tu index aún (si luego quieres, lo ponemos en UI)
  let rate = state.defaultRate;
  const asked = prompt("¿% participación/Descuento del chofer? (ej: 30)", String(state.defaultRate));
  if (asked != null && asked.trim() !== "") {
    const n = Number(asked);
    if (!isFinite(n) || n < 0 || n > 100) return alert("El % debe estar entre 0 y 100.");
    rate = n;
  }

  if (!name) return alert("Escribe el nombre del chofer.");
  if (!pin || pin.length < 4) return alert("El PIN debe tener al menos 4 dígitos.");

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
  refreshAllDriverSelects();
  resetStaffForm();
}

function resetStaffForm() {
  if (!staffNameInput) return;
  staffNameInput.value = "";
  staffPinInput.value = "";
}

/* ========== FILTROS HISTORIAL ==========
   Admin: normal
   Chofer: fuerza su nombre */
function getFilteredServices() {
  const start = filterStartInput?.value || "";
  const end = filterEndInput?.value || "";

  let driver = filterDriverSelect?.value || "";
  if (isDriver()) driver = state.session.driverName || state.session.employeeName || "";

  const cat = filterCategorySelect?.value || "";

  return state.services.filter((s) => {
    if (!s.date) return false;
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    if (driver && s.driver !== driver) return false;
    if (cat && s.category !== cat) return false;
    return true;
  });
}

/* ========== BACKUP JSON (admin) ========== */
function downloadBackupJson() {
  if (!isAdmin()) return alert("Solo admin puede crear backup.");
  const list = getFilteredServices();
  if (!list.length) return alert("No hay datos para exportar con el filtro actual.");

  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nexus-transport-services.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  // chofer: solo dashboard/historial
  if (isDriver() && !["dashboard", "historial"].includes(pageName)) pageName = "dashboard";

  Object.keys(pages).forEach((name) => {
    pages[name].classList.toggle("active-page", name === pageName);
  });

  navButtons.forEach((btn) => {
    const target = btn.getAttribute("data-page");
    btn.classList.toggle("nav-btn-active", target === pageName);
  });

  if (pageName === "caja") computeCajaTotals();
  if (pageName === "resumen") renderSummary();
}

/* ========== LOGIN ==========
   Admin: pin maestro
   Chofer: nombre + pin */
function handleAdminPinEnter() {
  const v = (pinInput.value || "").trim();
  if (!v) return (pinError.textContent = "Ingrese el PIN admin.");
  if (v === state.pin) {
    state.session = { role: "admin", employeeName: "", driverName: "" };
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

  const rec = findStaffByName(name);
  if (!rec) {
    pinError.textContent = "Chofer no existe (crearlo en Configuración).";
    return;
  }
  if (String(rec.pin) !== pin) {
    pinError.textContent = "PIN de chofer incorrecto.";
    return;
  }

  state.session = { role: "driver", employeeName: rec.name, driverName: rec.name };
  saveState();
  pinError.textContent = "";
  showAuthScreen();
}

/* ========== FIRESTORE LISTEN + AUTH ==========
   Sync servicios */
function startServicesListener() {
  if (state.unsubscribeServices) {
    state.unsubscribeServices();
    state.unsubscribeServices = null;
  }

  state.unsubscribeServices = servicesCollectionRef()
    .orderBy("number", "asc")
    .onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((doc) => arr.push(doc.data()));
        state.services = arr;
        saveState();

        renderServiceNumber();
        renderServicesTable();
        computeCajaTotals();
        renderSummary();
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
    startServicesListener();

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

  if (state.unsubscribeServices) {
    state.unsubscribeServices();
    state.unsubscribeServices = null;
  }

  state.user = null;
  userEmailSpan.textContent = "Sin conexión a Google";
  state.session = { role: null, employeeName: "", driverName: "" };
  saveState();
  showPinScreen();
}

auth.onAuthStateChanged((user) => {
  state.user = user || null;
  if (user) {
    userEmailSpan.textContent = user.email || "";
    startServicesListener();
  } else {
    userEmailSpan.textContent = "Sin conexión a Google";
    if (state.unsubscribeServices) {
      state.unsubscribeServices();
      state.unsubscribeServices = null;
    }
  }
});

/* ========== DASHBOARD: SERVICIOS ========== */
function resetFormForNewService() {
  const today = new Date();
  serviceDateInput.value = today.toISOString().slice(0, 10);

  if (isDriver()) {
    driverSelect.value = state.session.driverName || "";
    driverCustomInput.value = "";
  } else {
    driverSelect.value = "";
    driverCustomInput.value = "";
  }

  paymentMethodSelect.value = "";
  categorySelect.value = "";
  descriptionInput.value = "";
  milesInput.value = "";      // ✅ siempre editable
  amountInput.value = "";
  notesInput.value = "";

  serviceNumberInput.value = nextServiceNumber();
  formMessage.textContent = "";
  currentEditingNumber = null;
}

function collectServiceFromForm() {
  const number = Number(serviceNumberInput.value || 0);
  const date = serviceDateInput.value;

  // chofer: fijo
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
  const description = (descriptionInput.value || "").trim();

  // ✅ Millas SIEMPRE (Connect y NO Connect)
  const miles = Number(milesInput.value || 0);
  if (!isFinite(miles) || miles < 0) throw new Error("Las millas deben ser un número válido (0 o mayor).");

  const amount = Number(amountInput.value || 0);
  if (!isFinite(amount) || amount < 0) throw new Error("El monto debe ser un número válido (0 o mayor).");

  const notes = (notesInput.value || "").trim();

  if (!number || !date || !driver || !paymentMethod || !category) {
    throw new Error("Faltan campos requeridos.");
  }

  return {
    number,
    date,
    driver,
    paymentMethod,
    category,
    description,
    miles,      // ✅ guardado siempre
    amount,
    notes,
    // para cálculos (tu hoja)
    driverRate: getRateForDriver(driver), // snapshot del % por si cambia luego
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function saveService() {
  if (!state.user) {
    formMessage.textContent = "Conéctate con Google antes de guardar servicios.";
    return;
  }
  if (!state.session?.role) {
    formMessage.textContent = "Inicia sesión (admin o chofer) primero.";
    return;
  }

  try {
    const service = collectServiceFromForm();
    const docId = String(service.number);

    await servicesCollectionRef().doc(docId).set(service, { merge: true });

    formMessage.textContent = currentEditingNumber
      ? "Servicio actualizado correctamente."
      : "Servicio guardado y sincronizado con Firebase.";

    currentEditingNumber = null;
    resetFormForNewService();
  } catch (err) {
    console.error("Error guardando servicio", err);
    formMessage.textContent = err.message || "Error al guardar el servicio.";
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
      if (data.footerText !== undefined) state.footerText = data.footerText;
      saveState();
      renderBranding();
    }
  } catch (e) {
    console.error("Error cargando branding", e);
  }
}

async function saveBrandingToCloud() {
  if (!state.user) return alert("Conéctate con Google para guardar branding.");
  try {
    const payload = {
      appName: state.appName,
      logoUrl: state.logoUrl || "",
      footerText: state.footerText || ""
    };
    await brandingDocRef().set(payload, { merge: true });
  } catch (e) {
    console.error("Error guardando branding", e);
    alert("Error al guardar branding.");
  }
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

/* ========== EVENTOS ==========
   Login */
pinEnterBtn.addEventListener("click", handleAdminPinEnter);
pinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleAdminPinEnter(); });

empEnterBtn.addEventListener("click", handleDriverEnter);
empPinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleDriverEnter(); });

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
  // opcional: guardar en nube cuando quieras (no automático)
});

if (footerTextInput) {
  footerTextInput.addEventListener("input", () => {
    if (!isAdmin()) return;
    state.footerText = footerTextInput.value.trim();
    saveState();
    renderBranding();
  });
}

/* Config */
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
      staffPinInput.value = rec.pin;
      alert(`Este chofer tiene ${Number(rec.rate ?? state.defaultRate).toFixed(1)}%`);
      return;
    }

    if (action === "delete") {
      const ok = confirm(`¿Eliminar chofer "${rec.name}"?`);
      if (!ok) return;

      state.staff = (state.staff || []).filter(s => normalizeName(s.name).toLowerCase() !== normalizeName(rec.name).toLowerCase());
      saveState();
      renderStaffTable();
      refreshAllDriverSelects();
      resetStaffForm();
    }
  });
}

/* Dashboard */
newServiceBtn.addEventListener("click", (e) => { e.preventDefault(); resetFormForNewService(); });
saveServiceBtn.addEventListener("click", (e) => { e.preventDefault(); saveService(); });

/* Historial filtros */
applyFilterBtn.addEventListener("click", () => { renderServicesTable(getFilteredServices()); });
clearFilterBtn.addEventListener("click", () => {
  filterStartInput.value = "";
  filterEndInput.value = "";
  filterCategorySelect.value = "";
  if (!isDriver()) filterDriverSelect.value = "";
  renderServicesTable();
});

/* Caja (admin) */
if (cajaApplyBtn) cajaApplyBtn.addEventListener("click", () => computeCajaTotals());
if (cajaClearBtn) cajaClearBtn.addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);
  cajaStartInput.value = today;
  cajaEndInput.value = today;
  if (cajaDriverSelect) cajaDriverSelect.value = "";
  computeCajaTotals();
});

/* Resumen (admin) */
if (sumApplyBtn) sumApplyBtn.addEventListener("click", () => renderSummary());
if (sumClearBtn) sumClearBtn.addEventListener("click", () => {
  if (!isAdmin()) return;
  sumStartInput.value = "";
  sumEndInput.value = "";
  sumDriverSelect.value = "";
  renderSummary();
});

/* Export */
if (backupJsonBtn) backupJsonBtn.addEventListener("click", downloadBackupJson);

/* Editar / eliminar (admin only) */
servicesTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  if (!isAdmin()) return;

  const action = btn.dataset.action;
  const number = Number(btn.dataset.number);
  if (!number) return;

  const service = state.services.find((s) => Number(s.number) === number);
  if (!service) return;

  if (action === "edit") {
    currentEditingNumber = number;

    serviceNumberInput.value = service.number;
    serviceDateInput.value = service.date;
    descriptionInput.value = service.description || "";
    milesInput.value = service.miles ?? 0; // ✅ carga millas
    amountInput.value = service.amount ?? 0;
    notesInput.value = service.notes || "";

    // Chofer (admin)
    refreshAllDriverSelects();
    driverSelect.value = service.driver || "";
    driverCustomInput.value = "";

    paymentMethodSelect.value = service.paymentMethod || "";
    categorySelect.value = service.category || "";

    formMessage.textContent = `Editando servicio #${service.number}`;
    setActivePage("dashboard");
  }

  if (action === "delete") {
    if (!state.user) return alert("Conéctate con Google para eliminar.");

    const ok = confirm(`¿Eliminar el servicio #${number}? Esta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      await servicesCollectionRef().doc(String(number)).delete();
    } catch (err) {
      console.error("Error eliminando servicio", err);
      alert("No se pudo eliminar el servicio.");
    }
  }
});

/* ========== INIT + PWA ========== */
function init() {
  loadState();
  renderBranding();

  // selects dinámicos
  refreshAllDriverSelects();
  renderStaffTable();

  renderServiceNumber();
  renderServicesTable(state.services);

  // caja: por defecto hoy
  const today = new Date().toISOString().slice(0, 10);
  if (cajaStartInput) cajaStartInput.value = today;
  if (cajaEndInput) cajaEndInput.value = today;
  computeCajaTotals();

  resetFormForNewService();
  setActivePage("dashboard");
  showPinScreen();

  // PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.error("SW error", err));
  }
}

init();
