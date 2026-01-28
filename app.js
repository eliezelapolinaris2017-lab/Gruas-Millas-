/* ============================================================
   NEXUS TRANSPORT PR — app.js (PROYECTO COMPLETO)
   - Google Auth + PIN
   - Roles: admin / driver
   - Firestore backend
   - Clientes dinámicos (tarifa por milla)
   - Chofer SOLO entra millas
   - Cálculo automático (Connect, %, retención)
   - Historial semanal / por rango
   - Dashboard + Reportes
   ============================================================ */

"use strict";

/* =========================
   FIREBASE INIT
========================= */
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROJECT.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

/* =========================
   HELPERS
========================= */
const $ = id => document.getElementById(id);

const money = n => `$${Number(n||0).toFixed(2)}`;

const todayISO = () => new Date().toISOString().slice(0,10);

const mondayOf = (iso) => {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0,10);
};

async function hashPin(uid, pin){
  const enc = new TextEncoder().encode(uid + ":" + pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* =========================
   GLOBAL STATE
========================= */
let currentUser = null;
let currentProfile = null;
let cachedClients = [];

/* =========================
   AUTH
========================= */
$("btnGoogleLogin").onclick = () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider);
};

auth.onAuthStateChanged(async user => {
  if(!user) return;
  currentUser = user;

  const snap = await db.collection("users").doc(user.uid).get();
  if(!snap.exists){
    $("loginMsg").textContent = "Usuario no autorizado";
    return;
  }
  currentProfile = snap.data();
  $("loginMsg").textContent = "PIN requerido";
});

/* =========================
   PIN CONFIRM
========================= */
$("btnPinConfirm").onclick = async () => {
  if(!currentUser || !currentProfile) return;

  const pin = $("pinInput").value;
  const hash = await hashPin(currentUser.uid, pin);

  if(hash !== currentProfile.pinHash){
    alert("PIN incorrecto");
    return;
  }

  $("view-login").style.display = "none";
  $("mainNav").style.display = "flex";
  $("kpiRole").textContent = currentProfile.role.toUpperCase();

  showView("dashboard");

  if(currentProfile.role === "driver"){
    $("tabAdmin").style.display = "none";
    loadDriver();
  } else {
    loadAdmin();
  }

  loadDashboard();
};

/* =========================
   LOGOUT
========================= */
$("btnLogout").onclick = async () => {
  await auth.signOut();
  location.reload();
};

/* =========================
   NAVIGATION
========================= */
document.querySelectorAll(".tab[data-view]").forEach(btn=>{
  btn.onclick = ()=> showView(btn.dataset.view);
});

function showView(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  const el = $(`view-${view}`);
  if(el) el.classList.add("active");
}

/* =========================
   DASHBOARD
========================= */
async function loadDashboard(){
  const week = mondayOf(todayISO());

  let q = db.collection("services")
    .where("weekStartISO","==",week);

  if(currentProfile.role === "driver"){
    q = q.where("uid","==",currentUser.uid);
  }

  const snap = await q.get();

  let miles=0, net=0;
  snap.forEach(d=>{
    miles += d.data().millas;
    net   += d.data().driverNet;
  });

  $("kpiWeekMiles").textContent = miles.toFixed(1);
  $("kpiWeekServices").textContent = snap.size;
  $("kpiWeekNet").textContent = money(net);

  const tbody = $("dashboardRecent");
  tbody.innerHTML = "";
  snap.docs.slice(0,10).forEach(d=>{
    const s = d.data();
    tbody.innerHTML += `
      <tr>
        <td>${s.fechaISO}</td>
        <td>${s.clientNombre}</td>
        <td>${s.driverName || "—"}</td>
        <td class="num">${s.millas}</td>
        <td class="num">${money(s.driverNet)}</td>
      </tr>`;
  });
}

/* =========================
   LOAD CLIENTS
========================= */
async function loadClients(){
  const snap = await db.collection("clients").where("activo","==",true).get();
  cachedClients = snap.docs.map(d=>({id:d.id, ...d.data()}));
}

/* =========================
   DRIVER MODULE
========================= */
async function loadDriver(){
  await loadClients();

  $("tabDriver").style.display = "inline-block";

  // fill clients
  $("drvClient").innerHTML = cachedClients
    .map(c=>`<option value="${c.id}">${c.nombre}</option>`).join("");

  $("btnDrvSave").onclick = async () => {
    const miles = Number($("drvMiles").value);
    if(!miles) return alert("Millas requeridas");

    const client = cachedClients.find(c=>c.id===$("drvClient").value);

    const bruto = miles * client.tarifaMilla;
    const afterConnect = client.aplicaConnect ? bruto * 0.85 : bruto;
    const empresa = afterConnect * 0.30;
    const driverGross = afterConnect - empresa;
    const retention = driverGross * 0.10;
    const driverNet = driverGross - retention;

    await db.collection("services").add({
      uid: currentUser.uid,
      driverName: currentProfile.displayName,
      clientId: client.id,
      clientNombre: client.nombre,
      fechaISO: todayISO(),
      weekStartISO: mondayOf(todayISO()),
      millas,
      tarifaMilla: client.tarifaMilla,
      montoBruto: bruto,
      connectAdjust: bruto - afterConnect,
      empresaShare: empresa,
      retention,
      driverNet,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert("Servicio registrado");
    $("drvMiles").value="";
    loadDriverHistory();
    loadDashboard();
  };

  $("btnDrvFilter").onclick = loadDriverHistory;
  loadDriverHistory();
}

async function loadDriverHistory(){
  const from = $("drvFromDate").value || "1900-01-01";
  const to   = $("drvToDate").value || todayISO();

  const q = db.collection("services")
    .where("uid","==",currentUser.uid)
    .where("fechaISO",">=",from)
    .where("fechaISO","<=",to);

  const snap = await q.get();
  const tbody = $("driverHistory");
  tbody.innerHTML="";

  snap.forEach(d=>{
    const s=d.data();
    tbody.innerHTML += `
      <tr>
        <td>${s.fechaISO}</td>
        <td>${s.clientNombre}</td>
        <td class="num">${s.millas}</td>
        <td class="num">${money(s.driverNet)}</td>
      </tr>`;
  });
}

/* =========================
   ADMIN MODULE
========================= */
async function loadAdmin(){
  $("tabAdmin").style.display = "inline-block";
  await loadClients();
  renderAdminClients();

  $("btnAddClient").onclick = async ()=>{
    const name = $("admClientName").value.trim();
    const rate = Number($("admClientRate").value);
    if(!name || !rate) return alert("Datos incompletos");

    await db.collection("clients").add({
      nombre: name,
      tarifaMilla: rate,
      aplicaConnect: $("admClientConnect").checked,
      activo: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    $("admClientName").value="";
    $("admClientRate").value="";
    $("admClientConnect").checked=false;

    await loadClients();
    renderAdminClients();
  };

  $("btnBuildWeekly").onclick = buildWeeklyReport;
}

function renderAdminClients(){
  const tb = $("adminClients");
  tb.innerHTML = cachedClients.map(c=>`
    <tr>
      <td>${c.nombre}</td>
      <td class="num">${money(c.tarifaMilla)}</td>
      <td>${c.aplicaConnect ? "Sí" : "No"}</td>
    </tr>
  `).join("");
}

/* =========================
   WEEKLY REPORT
========================= */
async function buildWeeklyReport(){
  const week = $("admWeekStart").value || mondayOf(todayISO());

  const snap = await db.collection("services")
    .where("weekStartISO","==",week).get();

  let bruto=0, empresa=0, chofer=0;
  snap.forEach(d=>{
    bruto += d.data().montoBruto;
    empresa += d.data().empresaShare;
    chofer += d.data().driverNet;
  });

  $("adminWeeklyReport").innerHTML = `
    <h3>Cierre semanal</h3>
    <div class="row"><span>Semana</span><b>${week}</b></div>
    <div class="row"><span>Bruto</span><b>${money(bruto)}</b></div>
    <div class="row"><span>Empresa</span><b>${money(empresa)}</b></div>
    <div class="row"><span>Choferes</span><b>${money(chofer)}</b></div>
  `;
}
