// app.js — Nexus Transport (Firestore + PIN + Admin/Chofer + Cuadre Jueves→Jueves + PWA)

// ========== FIREBASE CONFIG (TU PROYECTO) ==========
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

// ========== ESTADO LOCAL ==========
const LOCAL_KEY = "nexus_transport_state_v1";

let state = {
  pin: "058312",
  session: { role: null, driverName: "" }, // admin | driver
  appName: "Nexus Transport",
  logoUrl: "",
  footerText: "© 2026 Nexus Transport — Cuadres",

  // Config según tu hoja: 37 millas => $148.00 => tarifa $4.00
  ratePerMile: 4.0,

  // Choferes (admin edita en Config)
  staff: [
    { name: "Adolfo", pin: "1111", active: true }
  ],

  tickets: [],
  user: null,
  unsubscribeTickets: null
};

let currentEditingNumber = null;

// ========== STORAGE ==========
function loadState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      if (!state.session) state.session = { role: null, driverName: "" };
      if (!Array.isArray(state.staff)) state.staff = [];
      if (typeof state.ratePerMile !== "number") state.ratePerMile = 4.0;
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

// ========== FIRESTORE REFS ==========
function ticketsCollectionRef() {
  return db.collection("transportTickets");
}

// ========== HELPERS ==========
function isAdmin() { return state.session?.role === "admin"; }
function isDriver() { return state.session?.role === "driver"; }
function normalizeName(s) { return String(s || "").trim(); }
function findStaffByName(name) {
  const n = normalizeName(name).toLowerCase();
  return (state.staff || []).find(x => normalizeName(x.name).toLowerCase() === n) || null;
}
function activeDrivers() {
  return (state.staff || []).filter(s => s.active !== false).map(s => s.name);
}
function money(n) {
  const x = Number(n || 0);
  return `$${x.toFixed(2)}`;
}
function toISO(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISO(d);
}
// Jueves anterior (inicio del cuadre)
function getThursdayForDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Dom, 4=Jue
  const backDiff = (day >= 4) ? (day - 4) : (day + 3);
  d.setDate(d.getDate() - backDiff);
  return toISO(d);
}

// ========== DOM ==========
const pinScreen = document.getElementById("pinScreen");
const authScreen = document.getElementById("authScreen");
const appShell = document.getElementById("appShell");

// PIN
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const pinEnterBtn = document.getElementById("pinEnterBtn");
const empNameInput = document.getElementById("empNameInput");
const empPinInput = document.getElementById("empPinInput");
const empEnterBtn = document.getElementById("empEnterBtn");

// AUTH
const googleSignInBtn = document.getElementById("googleSignInBtn");
const authBackToPinBtn = document.getElementById("authBackToPinBtn");

// TOPBAR
const appNameEditable = document.getElementById("appNameEditable");
const pinAppNameTitle = document.getElementById("pinAppName");
const userEmailSpan = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const appLogoImg = document.getElementById("appLogo");
const pinLogoImg = document.getElementById("pinLogo");
const footerTextSpan = document.getElementById("footerText");
const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const sessionSubtitle = document.getElementById("sessionSubtitle");

// PAGES
const pages = {
  dashboard: document.getElementById("page-dashboard"),
  historial: document.getElementById("page-historial"),
  cuadre: document.getElementById("page-cuadre"),
  config: document.getElementById("page-config")
};

// DASHBOARD
const ticketNumberInput = document.getElementById("ticketNumber");
const ticketDateInput = document.getElementById("ticketDate");
const driverSelect = document.getElementById("driverSelect");
const categorySelect = document.getElementById("category");
const paymentMethodSelect = document.getElementById("paymentMethod");

const connectBlock = document.getElementById("connectBlock");
const milesInput = document.getElementById("miles");
const engancheInput = document.getElementById("enganche");
const vialesInput = document.getElementById("viales");
const ratePerMileInput = document.getElementById("ratePerMile");
const totalConnectGruaInput = document.getElementById("totalConnectGrua");
const minus15ConnectInput = document.getElementById("minus15Connect");

const serviceDescInput = document.getElementById("serviceDesc");
const amountInput = document.getElementById("amount");

const newTicketBtn = document.getElementById("newTicketBtn");
const saveTicketBtn = document.getElementById("saveTicketBtn");
const formMessage = document.getElementById("formMessage");

// HISTORIAL
const ticketsTableBody = document.getElementById("ticketsTableBody");
const filterStartInput = document.getElementById("filterStart");
const filterEndInput = document.getElementById("filterEnd");
const filterDriverSelect = document.getElementById("filterDriver");
const filterCategorySelect = document.getElementById("filterCategory");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const backupJsonBtn = document.getElementById("backupJsonBtn");

// CUADRE
const cuadreDriverSelect = document.getElementById("cuadreDriver");
const cuadreThursdayInput = document.getElementById("cuadreThursday");
const cuadreApplyBtn = document.getElementById("cuadreApplyBtn");
const cuadreThisWeekBtn = document.getElementById("cuadreThisWeekBtn");
const cuadreTableBody = document.getElementById("cuadreTableBody");

// CASH CUADRE
const cashReciboInput = document.getElementById("cashRecibo");
const cashChoferInput = document.getElementById("cashChofer");
const gastosInput = document.getElementById("gastos");
const usoCashInput = document.getElementById("usoCash");
const pagoPeajeInput = document.getElementById("pagoPeaje");
const seDebeInput = document.getElementById("seDebe");
const enBolsaInput = document.getElementById("enBolsa");
const cashResultInput = document.getElementById("cashResult");
const cashCalcBtn = document.getElementById("cashCalcBtn");

// CONFIG
const adminArea = document.getElementById("adminArea");
const configRatePerMile = document.getElementById("configRatePerMile");
const newPinInput = document.getElementById("newPinInput");
const changePinBtn = document.getElementById("changePinBtn");
const pinChangeMessage = document.getElementById("pinChangeMessage");

const staffNameInput = document.getElementById("staffNameInput");
const staffPinInput = document.getElementById("staffPinInput");
const staffActiveInput = document.getElementById("staffActiveInput");
const addStaffBtn = document.getElementById("addStaffBtn");
const resetStaffBtn = document.getElementById("resetStaffBtn");
const staffTableBody = document.getElementById("staffTableBody");

// ========== VISTAS ==========
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

function setActivePage(pageName) {
  if (isDriver() && pageName === "config") pageName = "dashboard";

  Object.keys(pages).forEach(k => pages[k].classList.toggle("active-page", k === pageName));
  navButtons.forEach(btn => btn.classList.toggle("nav-btn-active", btn.getAttribute("data-page") === pageName));

  if (pageName === "cuadre") renderCuadre();
}

// ========== BRANDING ==========
function renderBranding() {
  appNameEditable.textContent = state.appName || "Nexus Transport";
  pinAppNameTitle.textContent = state.appName || "Nexus Transport";
  footerTextSpan.textContent = state.footerText || "© 2026 Nexus Transport — Cuadres";

  const logoSrc = (state.logoUrl && state.logoUrl.trim()) ? state.logoUrl.trim() : "./assets/logo.png";
  appLogoImg.src = logoSrc;
  pinLogoImg.src = logoSrc;

  configRatePerMile.value = Number(state.ratePerMile || 0).toFixed(2);
  ratePerMileInput.value = Number(state.ratePerMile || 0).toFixed(2);
}

function applyRoleUI() {
  const adminEls = Array.from(document.querySelectorAll(".nav-admin"));
  const adminNavBtns = Array.from(document.querySelectorAll(".nav-btn.nav-admin"));

  if (isAdmin()) {
    adminEls.forEach(el => (el.style.display = ""));
    adminNavBtns.forEach(btn => (btn.style.display = ""));
    if (adminArea) adminArea.style.display = "";
    if (sessionSubtitle) sessionSubtitle.textContent = "Modo Admin — Cuadre Jueves → Jueves";
    appNameEditable.contentEditable = "true";
  } else {
    adminEls.forEach(el => (el.style.display = "none"));
    adminNavBtns.forEach(btn => (btn.style.display = "none"));
    if (adminArea) adminArea.style.display = "none";
    if (sessionSubtitle) sessionSubtitle.textContent = `Chofer: ${state.session.driverName} — Cuadre Jueves → Jueves`;
    appNameEditable.contentEditable = "false";
  }

  refreshAllDriverSelects();
}

// ========== SELECTS CHOFER ==========
function refreshAllDriverSelects() {
  const names = activeDrivers();
  const selects = [driverSelect, filterDriverSelect, cuadreDriverSelect];

  selects.forEach(sel => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = "";

    // dashboard no usa "Todos"
    if (sel !== driverSelect) {
      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "Todos";
      sel.appendChild(optAll);
    }

    names.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });

    if (sel === driverSelect && isDriver()) {
      sel.value = state.session.driverName;
      sel.disabled = true;
    } else if (sel === driverSelect) {
      sel.disabled = false;
      sel.value = names.includes(current) ? current : (names[0] || "");
    } else {
      sel.value = names.includes(current) ? current : "";
    }
  });
}

// ========== NUMERACIÓN ==========
function nextTicketNumber() {
  if (!state.tickets.length) return 1;
  const max = state.tickets.reduce((m, t) => Math.max(m, Number(t.number || 0)), 0);
  return max + 1;
}
function renderTicketNumber() {
  ticketNumberInput.value = nextTicketNumber();
}

// ========== CONNECT CÁLCULO ==========
function calcConnect() {
  const miles = Number(milesInput.value || 0);
  const eng = Number(engancheInput.value || 0);
  const via = Number(vialesInput.value || 0);
  const rate = Number(state.ratePerMile || 0);

  const milesAmount = miles * rate;
  const totalConnect = milesAmount + eng + via;
  const minus15 = totalConnect * 0.85;

  totalConnectGruaInput.value = totalConnect.toFixed(2);
  minus15ConnectInput.value = minus15.toFixed(2);
}

function toggleBlocks() {
  const cat = categorySelect.value;
  const isConnect = cat === "CONNECT";
  connectBlock.style.display = isConnect ? "" : "none";
  amountInput.disabled = isConnect;

  if (isConnect) {
    calcConnect();
    amountInput.value = "";
  }
}

// ========== FORM ==========
function resetFormForNewTicket() {
  const today = new Date();
  ticketDateInput.value = today.toISOString().slice(0, 10);
  categorySelect.value = "";
  paymentMethodSelect.value = "";
  serviceDescInput.value = "";
  milesInput.value = "";
  engancheInput.value = "";
  vialesInput.value = "";
  totalConnectGruaInput.value = "";
  minus15ConnectInput.value = "";
  amountInput.value = "";
  formMessage.textContent = "";
  currentEditingNumber = null;

  refreshAllDriverSelects();
  renderTicketNumber();
  toggleBlocks();
}

function collectTicketFromForm() {
  const number = Number(ticketNumberInput.value || 0);
  const date = ticketDateInput.value;
  const driver = isDriver() ? state.session.driverName : driverSelect.value;

  const category = categorySelect.value;
  const paymentMethod = paymentMethodSelect.value;
  const serviceDesc = (serviceDescInput.value || "").trim();

  if (!number || !date || !driver || !category || !paymentMethod) {
    throw new Error("Faltan campos requeridos (fecha, chofer, categoría, método).");
  }

  let miles = 0, enganche = 0, viales = 0;
  let milesAmount = 0, totalConnectGrua = 0, minus15Connect = 0;
  let amount = Number(amountInput.value || 0);

  if (category === "CONNECT") {
    miles = Number(milesInput.value || 0);
    enganche = Number(engancheInput.value || 0);
    viales = Number(vialesInput.value || 0);
    const rate = Number(state.ratePerMile || 0);

    milesAmount = miles * rate;
    totalConnectGrua = milesAmount + enganche + viales;
    minus15Connect = totalConnectGrua * 0.85;

    // En tu hoja el neto que entra al "Total" es "-15% Connect"
    amount = minus15Connect;
  } else {
    if (!isFinite(amount) || amount < 0) throw new Error("Monto inválido.");
  }

  return {
    number,
    date,
    driver,
    category,
    paymentMethod,
    serviceDesc,

    // connect detalles
    miles,
    milesAmount,
    enganche,
    viales,
    ratePerMile: Number(state.ratePerMile || 0),
    totalConnectGrua,
    minus15Connect,

    amount,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function saveTicket() {
  if (!state.user) {
    formMessage.textContent = "Conéctate con Google antes de guardar.";
    return;
  }
  if (!state.session?.role) {
    formMessage.textContent = "Inicia sesión (admin o chofer) primero.";
    return;
  }

  try {
    const ticket = collectTicketFromForm();
    await ticketsCollectionRef().doc(String(ticket.number)).set(ticket, { merge: true });

    formMessage.textContent = currentEditingNumber ? "Servicio actualizado." : "Servicio guardado y sincronizado.";
    currentEditingNumber = null;
    resetFormForNewTicket();
  } catch (err) {
    console.error("Error guardando", err);
    formMessage.textContent = err.message || "Error al guardar.";
  }
}

// ========== FILTROS ==========
function roleFilteredTickets(list) {
  if (!isDriver()) return list;
  return (list || []).filter(t => (t.driver || "") === state.session.driverName);
}

function getFilteredTickets() {
  const start = filterStartInput?.value || "";
  const end = filterEndInput?.value || "";
  const cat = filterCategorySelect?.value || "";

  let drv = filterDriverSelect?.value || "";
  if (isDriver()) drv = state.session.driverName;

  return roleFilteredTickets(state.tickets).filter((t) => {
    if (!t.date) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (drv && t.driver !== drv) return false;
    if (cat && t.category !== cat) return false;
    return true;
  });
}

// ========== RENDER HISTORIAL ==========
function renderTicketsTable(listOverride) {
  const list = roleFilteredTickets(listOverride || state.tickets)
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0));

  ticketsTableBody.innerHTML = "";
  list.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.number || ""}</td>
      <td>${t.date || ""}</td>
      <td>${t.driver || ""}</td>
      <td>${t.category || ""}</td>
      <td>${t.category === "CONNECT" ? Number(t.miles || 0).toFixed(2) : ""}</td>
      <td>${t.paymentMethod || ""}</td>
      <td>${money(t.amount || 0)}</td>
      <td class="nav-admin">
        <button class="btn-table edit" data-action="edit" data-number="${t.number}">Editar</button>
        <button class="btn-table delete" data-action="delete" data-number="${t.number}">X</button>
      </td>
    `;
    ticketsTableBody.appendChild(tr);
  });
}

// ========== CUADRE (SEGÚN TU HOJA) ==========
function getCuadreRange() {
  const anyDate = cuadreThursdayInput.value || toISO(new Date());
  const th = getThursdayForDate(anyDate);
  const nextTh = addDaysISO(th, 7);
  return { start: th, end: nextTh }; // end exclusivo (date < end)
}

function ticketsInRangeForDriver(driver, startISO, endISO) {
  return roleFilteredTickets(state.tickets).filter((t) => {
    if (!t.date) return false;
    if (t.date < startISO) return false;
    if (t.date >= endISO) return false;
    if (driver && t.driver !== driver) return false;
    return true;
  });
}

function renderCuadre() {
  const driver = isDriver() ? state.session.driverName : (cuadreDriverSelect.value || "");
  const { start, end } = getCuadreRange();
  const list = ticketsInRangeForDriver(driver, start, end);

  // Totales EXACTO como tu hoja
  const totals = {
    // Connect
    milesQty: 0,
    milesAmount: 0,
    enganche: 0,
    vialesConnect: 0,
    totalConnectGrua: 0,
    minus15Connect: 0,

    // Bloque principal
    cash: 0,
    creditos: 0,
    mapfre: 0,

    // Otros (bloque abajo)
    viales: 0, // viales SOLO (si lo usan aparte)
    cops: 0,
    ath: 0,
    pagina: 0,
    salvamentos: 0,
    od: 0,
    extraccion: 0,
    enterprise: 0,
    aaa: 0,
    erika: 0
  };

  list.forEach((t) => {
    const amt = Number(t.amount || 0);

    // método cash (como tu hoja)
    if (t.paymentMethod === "Efectivo") totals.cash += amt;

    // por categoría
    switch (t.category) {
      case "CONNECT":
        totals.milesQty += Number(t.miles || 0);
        totals.milesAmount += Number(t.milesAmount || 0);
        totals.enganche += Number(t.enganche || 0);
        totals.vialesConnect += Number(t.viales || 0);
        totals.totalConnectGrua += Number(t.totalConnectGrua || 0);
        totals.minus15Connect += Number(t.minus15Connect || 0);
        break;

      case "CREDITOS": totals.creditos += amt; break;
      case "MAPFRE": totals.mapfre += amt; break;

      case "VIALES_SOLO": totals.viales += amt; break;
      case "COPS": totals.cops += amt; break;
      case "ATH_MOVIL": totals.ath += amt; break;
      case "PAGINA": totals.pagina += amt; break;
      case "SALVAMENTOS": totals.salvamentos += amt; break;
      case "OD_CONNECT": totals.od += amt; break;
      case "EXTRACCIONES": totals.extraccion += amt; break;
      case "ENTERPRISE": totals.enterprise += amt; break;
      case "AAA": totals.aaa += amt; break;
      case "ERIKA_CODE_POLA": totals.erika += amt; break;
    }
  });

  // Total general de la hoja:
  // Total = (-15% Connect) + Cash + Créditos + Mapfre + (Viales + Cops + Ath + Página + Salvamentos + OD + Extracción + Enterprise + AAA + Erika)
  const totalGeneral =
    totals.minus15Connect +
    totals.cash +
    totals.creditos +
    totals.mapfre +
    totals.viales +
    totals.cops +
    totals.ath +
    totals.pagina +
    totals.salvamentos +
    totals.od +
    totals.extraccion +
    totals.enterprise +
    totals.aaa +
    totals.erika;

  // Fórmulas hoja:
  // Descuento .30 = Total * 0.30
  // Retencion 10% = Descuento * 0.10
  // Total a pagar = Descuento - Retencion
  const descuento30 = totalGeneral * 0.30;
  const retencion10 = descuento30 * 0.10;
  const totalPagar = descuento30 - retencion10;

  const rows = [
    { k: "Chofer", v: driver || "Todos" },
    { k: "Rango (Jueves→Jueves)", v: `${start} → ${addDaysISO(end, -1)}` },

    { k: "Millas", v: `${totals.milesQty.toFixed(2)}  |  ${money(totals.milesAmount)}` },
    { k: "Enganche Connect", v: money(totals.enganche) },
    { k: "Viales (Connect)", v: money(totals.vialesConnect) },
    { k: "Total Connect Grua", v: money(totals.totalConnectGrua) },
    { k: "-15% Connect", v: money(totals.minus15Connect) },

    { k: "Cash", v: money(totals.cash) },
    { k: "Créditos", v: money(totals.creditos) },
    { k: "Mapfre", v: money(totals.mapfre) },

    { k: "Viales (otros)", v: money(totals.viales) },
    { k: "COPS", v: money(totals.cops) },
    { k: "ATH Móvil", v: money(totals.ath) },
    { k: "Página", v: money(totals.pagina) },
    { k: "Salvamentos", v: money(totals.salvamentos) },
    { k: "OD (Connect)", v: money(totals.od) },
    { k: "Extracción", v: money(totals.extraccion) },
    { k: "Enterprise", v: money(totals.enterprise) },
    { k: "AAA", v: money(totals.aaa) },
    { k: "ERIKA CODE POLA / AAA", v: money(totals.erika) },

    { k: "TOTAL", v: money(totalGeneral) },
    { k: "Descuento .30", v: money(descuento30) },
    { k: "Retención 10%", v: money(retencion10) },
    { k: "Total a pagar", v: money(totalPagar) }
  ];

  cuadreTableBody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.k}</td><td>${r.v}</td>`;
    cuadreTableBody.appendChild(tr);
  });

  if (sessionSubtitle) {
    const who = isDriver() ? `Chofer: ${state.session.driverName}` : "Modo Admin";
    sessionSubtitle.textContent = `${who} — Cuadre ${start} → ${addDaysISO(end, -1)}`;
  }
}

// ========== CASH CUADRE ==========
function calcCash() {
  const cashRecibo = Number(cashReciboInput.value || 0);
  const cashChofer = Number(cashChoferInput.value || 0);
  const gastos = Number(gastosInput.value || 0);
  const usoCash = Number(usoCashInput.value || 0);
  const pagoPeaje = Number(pagoPeajeInput.value || 0);
  const seDebe = Number(seDebeInput.value || 0);
  const enBolsa = Number(enBolsaInput.value || 0);

  const recibido = cashRecibo + cashChofer;
  const neto = recibido - gastos - usoCash - pagoPeaje - seDebe;
  const dif = neto - enBolsa;

  const ok = Math.abs(dif) < 0.01;
  cashResultInput.value = ok
    ? `✅ Cuadra. Neto ${money(neto)}`
    : `⚠️ No cuadra. Neto ${money(neto)} | Diferencia ${money(dif)}`;
}

// ========== CONFIG: STAFF CRUD ==========
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
        <td>${s.active === false ? "No" : "Sí"}</td>
        <td>
          <button class="btn-table edit" data-staff-action="edit" data-staff-name="${normalizeName(s.name)}">Editar</button>
          <button class="btn-table delete" data-staff-action="delete" data-staff-name="${normalizeName(s.name)}">X</button>
        </td>
      `;
      staffTableBody.appendChild(tr);
    });
}

function resetStaffForm() {
  staffNameInput.value = "";
  staffPinInput.value = "";
  staffActiveInput.value = "true";
}

function addOrUpdateStaff() {
  if (!isAdmin()) return;

  const name = normalizeName(staffNameInput.value);
  const pin = String(staffPinInput.value || "").trim();
  const active = staffActiveInput.value === "true";

  if (!name) return alert("Escribe el nombre del chofer.");
  if (!pin || pin.length < 4) return alert("El PIN debe tener al menos 4 dígitos.");

  const existing = findStaffByName(name);
  if (existing) {
    existing.name = name;
    existing.pin = pin;
    existing.active = active;
  } else {
    state.staff.push({ name, pin, active });
  }

  saveState();
  renderStaffTable();
  refreshAllDriverSelects();
  resetStaffForm();
}

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

// ========== BACKUP ==========
function downloadBackupJson() {
  if (!isAdmin()) return alert("Solo admin puede crear backup.");

  const list = getFilteredTickets();
  if (!list.length) return alert("No hay servicios con el filtro actual.");

  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transportTickets-backup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========== LOGIN ==========
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

  if (!name || !pin) return (pinError.textContent = "Chofer: escribe Nombre y PIN.");

  const rec = findStaffByName(name);
  if (!rec || rec.active === false) return (pinError.textContent = "Chofer no existe o está inactivo.");
  if (String(rec.pin) !== pin) return (pinError.textContent = "PIN de chofer incorrecto.");

  state.session = { role: "driver", driverName: rec.name };
  saveState();
  pinError.textContent = "";
  showAuthScreen();
}

// ========== AUTH + FIRESTORE ==========
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
        if (pages.cuadre.classList.contains("active-page")) renderCuadre();
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
  state.session = { role: null, driverName: "" };
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

// ========== EVENTOS ==========
pinEnterBtn.addEventListener("click", handleAdminPinEnter);
pinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleAdminPinEnter(); });

empEnterBtn.addEventListener("click", handleDriverEnter);
empPinInput.addEventListener("keyup", (e) => { if (e.key === "Enter") handleDriverEnter(); });

googleSignInBtn.addEventListener("click", signInWithGoogle);
authBackToPinBtn.addEventListener("click", showPinScreen);
logoutBtn.addEventListener("click", signOutAndReset);

// NAV
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => setActivePage(btn.getAttribute("data-page")));
});

// APP NAME
appNameEditable.addEventListener("input", () => {
  if (!isAdmin()) return;
  state.appName = appNameEditable.textContent.trim() || "Nexus Transport";
  saveState();
  renderBranding();
});

// CONFIG rate/mile
configRatePerMile.addEventListener("input", () => {
  if (!isAdmin()) return;
  const v = Number(configRatePerMile.value || 0);
  state.ratePerMile = isFinite(v) && v >= 0 ? v : state.ratePerMile;
  saveState();
  renderBranding();
  calcConnect();
});

changePinBtn.addEventListener("click", (e) => {
  e.preventDefault();
  changePin();
});

// Staff CRUD
addStaffBtn.addEventListener("click", (e) => { e.preventDefault(); addOrUpdateStaff(); });
resetStaffBtn.addEventListener("click", (e) => { e.preventDefault(); resetStaffForm(); });

if (staffTableBody) {
  staffTableBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-staff-action]");
    if (!btn || !isAdmin()) return;

    const action = btn.dataset.staffAction;
    const name = btn.dataset.staffName;
    const rec = findStaffByName(name);
    if (!rec) return;

    if (action === "edit") {
      staffNameInput.value = rec.name;
      staffPinInput.value = rec.pin;
      staffActiveInput.value = (rec.active === false) ? "false" : "true";
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

// Dashboard
categorySelect.addEventListener("change", toggleBlocks);
milesInput.addEventListener("input", calcConnect);
engancheInput.addEventListener("input", calcConnect);
vialesInput.addEventListener("input", calcConnect);

newTicketBtn.addEventListener("click", (e) => { e.preventDefault(); resetFormForNewTicket(); });
saveTicketBtn.addEventListener("click", (e) => { e.preventDefault(); saveTicket(); });

// Historial filtros
applyFilterBtn.addEventListener("click", () => renderTicketsTable(getFilteredTickets()));
clearFilterBtn.addEventListener("click", () => {
  filterStartInput.value = "";
  filterEndInput.value = "";
  filterCategorySelect.value = "";
  if (!isDriver()) filterDriverSelect.value = "";
  renderTicketsTable();
});

// Backup
backupJsonBtn.addEventListener("click", downloadBackupJson);

// Cuadre
cuadreApplyBtn.addEventListener("click", () => renderCuadre());
cuadreThisWeekBtn.addEventListener("click", () => {
  cuadreThursdayInput.value = toISO(new Date());
  renderCuadre();
});

// Cash
cashCalcBtn.addEventListener("click", () => calcCash());

// Editar / eliminar (admin only)
ticketsTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  if (!isAdmin()) return;

  const action = btn.dataset.action;
  const number = Number(btn.dataset.number);
  if (!number) return;

  const ticket = state.tickets.find(t => Number(t.number) === number);
  if (!ticket) return;

  if (action === "edit") {
    currentEditingNumber = number;

    ticketNumberInput.value = ticket.number;
    ticketDateInput.value = ticket.date;
    if (!isDriver()) driverSelect.value = ticket.driver || "";
    categorySelect.value = ticket.category || "";
    paymentMethodSelect.value = ticket.paymentMethod || "";
    serviceDescInput.value = ticket.serviceDesc || "";

    milesInput.value = ticket.miles || "";
    engancheInput.value = ticket.enganche || "";
    vialesInput.value = ticket.viales || "";

    toggleBlocks();
    calcConnect();

    if (ticket.category !== "CONNECT") amountInput.value = Number(ticket.amount || 0).toFixed(2);

    formMessage.textContent = `Editando servicio #${ticket.number}`;
    setActivePage("dashboard");
  }

  if (action === "delete") {
    if (!state.user) return alert("Conéctate con Google para eliminar.");
    const ok = confirm(`¿Eliminar el servicio #${number}?`);
    if (!ok) return;
    try {
      await ticketsCollectionRef().doc(String(number)).delete();
    } catch (err) {
      console.error("Error eliminando", err);
      alert("No se pudo eliminar.");
    }
  }
});

// ========== INIT + PWA ==========
function init() {
  loadState();
  renderBranding();

  refreshAllDriverSelects();
  renderStaffTable();

  renderTicketNumber();
  renderTicketsTable(state.tickets);

  resetFormForNewTicket();
  setActivePage("dashboard");
  showPinScreen();

  // PWA (IMPORTANTE: ruta correcta)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js")
      .catch((err) => console.error("SW error", err));
  }
}

init();
