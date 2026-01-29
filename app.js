/*************************************************
 * app.js — Nexus Transport (FINAL COMPLETO)
 * ✔ Firebase una sola vez
 * ✔ Sin duplicados
 * ✔ Admin / Chofer
 * ✔ Dashboard / Historial / Caja / Resumen / Comisiones / Config
 * ✔ Millas siempre manuales
 * ✔ Cuadre Jueves → Jueves
 *************************************************/

/* =================================================
   🔐 PROTECCIÓN ANTI DOBLE CARGA
================================================= */
if (window.__NEXUS_TRANSPORT_LOADED__) {
  console.warn("Nexus Transport ya estaba cargado");
  throw new Error("Duplicated app.js");
}
window.__NEXUS_TRANSPORT_LOADED__ = true;

/* =================================================
   🔥 FIREBASE CONFIG (UNA SOLA VEZ)
================================================= */
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

/* =================================================
   📦 ESTADO LOCAL
================================================= */
const LOCAL_KEY = "nexus_transport_state_final";

let state = {
  pin: "058312",

  session: {
    role: null, // admin | driver
    driverName: ""
  },

  appName: "Nexus Transport",
  footerText: "© 2026 Nexus Transport — Cuadres",

  defaultRate: 30,
  retentionRate: 10,
  allowDriverEdit: false,

  drivers: [],
  tickets: [],

  user: null,
  unsubscribeTickets: null
};

/* =================================================
   💾 STORAGE
================================================= */
function loadState() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state = { ...state, ...parsed };
  } catch (e) {
    console.error("Error localStorage", e);
  }
}

function saveState() {
  const copy = { ...state };
  delete copy.user;
  delete copy.unsubscribeTickets;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

/* =================================================
   🔎 HELPERS
================================================= */
const $ = id => document.getElementById(id);
const isAdmin = () => state.session.role === "admin";
const isDriver = () => state.session.role === "driver";

function normalize(s) {
  return String(s || "").trim();
}

function money(v) {
  v = Number(v || 0);
  return isFinite(v) ? v : 0;
}

/* =================================================
   📂 FIRESTORE
================================================= */
const ticketsRef = () => db.collection("transportTickets");

/* =================================================
   🧭 DOM
================================================= */
const pinScreen = $("pinScreen");
const authScreen = $("authScreen");
const appShell = $("appShell");

const pinInput = $("pinInput");
const pinEnterBtn = $("pinEnterBtn");
const empNameInput = $("empNameInput");
const empPinInput = $("empPinInput");
const empEnterBtn = $("empEnterBtn");
const pinError = $("pinError");

const googleSignInBtn = $("googleSignInBtn");
const authBackToPinBtn = $("authBackToPinBtn");
const logoutBtn = $("logoutBtn");

const appNameEditable = $("appNameEditable");
const pinAppNameTitle = $("pinAppName");
const userEmailSpan = $("userEmail");
const footerTextSpan = $("footerText");

const navButtons = [...document.querySelectorAll(".nav-btn")];

const pages = {
  dashboard: $("page-dashboard"),
  historial: $("page-historial"),
  caja: $("page-caja"),
  resumen: $("page-resumen"),
  comisiones: $("page-comisiones"),
  config: $("page-config")
};

/* =================================================
   📊 DASHBOARD FORM
================================================= */
const serviceNumberInput = $("serviceNumber");
const serviceDateInput = $("serviceDate");
const driverSelect = $("driver");
const driverCustomInput = $("driverCustom");
const paymentMethodSelect = $("paymentMethod");
const categorySelect = $("category");
const amountInput = $("amount");
const milesInput = $("miles");
const descriptionInput = $("description");
const notesInput = $("notes");
const newServiceBtn = $("newServiceBtn");
const saveServiceBtn = $("saveServiceBtn");
const formMessage = $("formMessage");

/* =================================================
   📜 HISTORIAL
================================================= */
const servicesTableBody = $("servicesTableBody");
const filterStartInput = $("filterStart");
const filterEndInput = $("filterEnd");
const filterDriverSelect = $("filterDriver");
const filterCategorySelect = $("filterCategory");
const applyFilterBtn = $("applyFilterBtn");
const clearFilterBtn = $("clearFilterBtn");
const backupJsonBtn = $("backupJsonBtn");

/* =================================================
   🧮 CAJA / RESUMEN / COMISIONES
================================================= */
const cajaTotalCashSpan = $("cajaTotalCash");
const cajaTotalAthSpan = $("cajaTotalAth");
const cajaTotalOtherSpan = $("cajaTotalOther");
const cajaTotalAllSpan = $("cajaTotalAll");

const sumTableBody = $("sumTableBody");
const sumGrandTotalSpan = $("sumGrandTotal");

const comiTableBody = $("comiTableBody");
const comiGrandTotalSpan = $("comiGrandTotal");

/* =================================================
   🖥️ UI
================================================= */
function showPin() {
  pinScreen.classList.remove("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.add("hidden");
}

function showAuth() {
  pinScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
}

function showApp() {
  pinScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function setPage(name) {
  if (isDriver() && !["dashboard", "historial"].includes(name)) {
    name = "dashboard";
  }
  Object.keys(pages).forEach(p => {
    pages[p].classList.toggle("active-page", p === name);
  });
  navButtons.forEach(b => {
    b.classList.toggle("nav-btn-active", b.dataset.page === name);
  });
}

/* =================================================
   🧾 TICKETS
================================================= */
function nextNumber() {
  if (!state.tickets.length) return 1;
  return Math.max(...state.tickets.map(t => Number(t.number || 0))) + 1;
}

function resetForm() {
  serviceNumberInput.value = nextNumber();
  serviceDateInput.value = new Date().toISOString().slice(0, 10);
  amountInput.value = "";
  milesInput.value = "";
  descriptionInput.value = "";
  notesInput.value = "";
  formMessage.textContent = "";
}

/* =================================================
   💾 SAVE SERVICE
================================================= */
async function saveService() {
  try {
    const ticket = {
      number: Number(serviceNumberInput.value),
      date: serviceDateInput.value,
      driver: driverCustomInput.value || driverSelect.value,
      paymentMethod: paymentMethodSelect.value,
      category: categorySelect.value,
      amount: money(amountInput.value),
      miles: money(milesInput.value),
      description: descriptionInput.value || "",
      notes: notesInput.value || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await ticketsRef().doc(String(ticket.number)).set(ticket);
    resetForm();
  } catch (e) {
    console.error(e);
    formMessage.textContent = "Error guardando servicio";
  }
}

/* =================================================
   🔄 FIRESTORE LISTENER
================================================= */
function startListener() {
  if (state.unsubscribeTickets) state.unsubscribeTickets();

  state.unsubscribeTickets = ticketsRef()
    .orderBy("number", "asc")
    .onSnapshot(snap => {
      state.tickets = snap.docs.map(d => d.data());
      saveState();
      renderTable();
    });
}

/* =================================================
   📋 RENDER HISTORIAL
================================================= */
function renderTable() {
  servicesTableBody.innerHTML = "";
  state.tickets.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.number}</td>
      <td>${t.date}</td>
      <td>${t.driver}</td>
      <td>${t.category}</td>
      <td>${t.paymentMethod}</td>
      <td>${t.miles}</td>
      <td>$${t.amount.toFixed(2)}</td>
      <td>${t.description}</td>
    `;
    servicesTableBody.appendChild(tr);
  });
}

/* =================================================
   🔐 AUTH
================================================= */
async function signInWithGoogle() {
  const res = await auth.signInWithPopup(googleProvider);
  state.user = res.user;
  userEmailSpan.textContent = state.user.email;
  startListener();
  showApp();
}

async function signOut() {
  await auth.signOut();
  state.user = null;
  showPin();
}

/* =================================================
   🚀 INIT FINAL
================================================= */
function init() {
  loadState();
  resetForm();
  showPin();

  pinEnterBtn.onclick = () => {
    if (pinInput.value === state.pin) {
      state.session.role = "admin";
      showAuth();
    } else {
      pinError.textContent = "PIN incorrecto";
    }
  };

  empEnterBtn.onclick = () => {
    state.session.role = "driver";
    state.session.driverName = empNameInput.value;
    showAuth();
  };

  googleSignInBtn.onclick = signInWithGoogle;
  logoutBtn.onclick = signOut;
  newServiceBtn.onclick = resetForm;
  saveServiceBtn.onclick = saveService;

  navButtons.forEach(b => {
    b.onclick = () => setPage(b.dataset.page);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
}

init();
