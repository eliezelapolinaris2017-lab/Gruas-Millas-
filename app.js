/* =========================================================
   Nexus Transport PR — app.js FINAL
   Auth Google + PIN
   Roles: admin / driver
   Driver: solo escribe
   Admin: controla todo
   Firestore + jsPDF
   ========================================================= */

"use strict";

/* ===============================
   Firebase Init (NO imports)
   =============================== */
const firebaseConfig = {
  apiKey: "AIzaSyAouzcePuYPfGBajbqFFotTNNr_gx_XCYQ",
  authDomain: "nexus-auto-pro-2026.firebaseapp.com",
  projectId: "nexus-auto-pro-2026",
  storageBucket: "nexus-auto-pro-2026.firebasestorage.app",
  messagingSenderId: "308014641424",
  appId: "1:308014641424:web:edf18eb89168f9b5eeb595"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ===============================
   Utils
   =============================== */
const $ = (id)=>document.getElementById(id);
const num = (v)=>Number(v)||0;
const round2 = (n)=>Math.round((n+Number.EPSILON)*100)/100;
const money = (n)=>round2(n).toLocaleString("en-US",{style:"currency",currency:"USD"});

function hashPIN(email, pin){
  return btoa(email.toLowerCase() + ":" + pin);
}

function mondayOf(d){
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day===0?-6:1);
  x.setDate(diff);
  return x.toISOString().slice(0,10);
}

/* ===============================
   Global State
   =============================== */
let currentUser = null;
let userData = null;
let clients = [];

/* ===============================
   Auth
   =============================== */
$("btnGoogleLogin")?.addEventListener("click", ()=>{
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider);
});

$("btnLogout")?.addEventListener("click", ()=>auth.signOut());

auth.onAuthStateChanged(async (user)=>{
  if(!user){
    $("view-login").style.display="block";
    $("mainNav").style.display="none";
    return;
  }

  currentUser = user;
  const ref = await db.collection("users").doc(user.uid).get();

  if(!ref.exists){
    alert("Usuario no autorizado");
    auth.signOut();
    return;
  }

  userData = ref.data();
  if(!userData.active){
    alert("Usuario inactivo");
    auth.signOut();
    return;
  }

  $("view-login").style.display="none";
  $("mainNav").style.display="flex";
  $("kpiRole").textContent = userData.role;

  if(userData.role==="driver"){
    $("tabAdmin").style.display="none";
  }

  loadClients();
  loadDashboard();
});

/* ===============================
   PIN Check
   =============================== */
$("btnPinConfirm")?.addEventListener("click", async ()=>{
  const pin = $("pinInput").value.trim();
  if(!pin) return alert("PIN requerido");

  const h = hashPIN(currentUser.email, pin);
  if(h !== userData.pinHash){
    alert("PIN incorrecto");
    auth.signOut();
    return;
  }

  showView("dashboard");
});

/* ===============================
   Navigation
   =============================== */
document.querySelectorAll(".tab[data-view]").forEach(btn=>{
  btn.addEventListener("click", ()=>showView(btn.dataset.view));
});

function showView(v){
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  $(`view-${v}`).classList.add("active");
  document.querySelector(`.tab[data-view="${v}"]`)?.classList.add("active");
}

/* ===============================
   Clients
   =============================== */
async function loadClients(){
  const snap = await db.collection("clients").get();
  clients = snap.docs.map(d=>({id:d.id,...d.data()}));

  const sel = $("drvClient");
  if(sel){
    sel.innerHTML = `<option value="">—</option>` +
      clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
  }

  renderAdminClients();
}

$("btnAddClient")?.addEventListener("click", async ()=>{
  if(userData.role!=="admin") return;
  const name = $("admClientName").value.trim();
  const rate = num($("admClientRate").value);
  const connect = $("admClientConnect").checked;
  if(!name || !rate) return;

  await db.collection("clients").add({
    name, rate, connect
  });

  $("admClientName").value="";
  $("admClientRate").value="";
  $("admClientConnect").checked=false;
  loadClients();
});

function renderAdminClients(){
  const tb = $("adminClients");
  if(!tb) return;
  tb.innerHTML = clients.map(c=>`
    <tr>
      <td>${c.name}</td>
      <td class="num">${money(c.rate)}</td>
      <td>${c.connect?"✔":"—"}</td>
    </tr>
  `).join("");
}

/* ===============================
   Driver — Save Service
   =============================== */
$("btnDrvSave")?.addEventListener("click", async ()=>{
  if(userData.role!=="driver") return;

  const clientId = $("drvClient").value;
  const miles = num($("drvMiles").value);
  if(!clientId || !miles) return alert("Datos incompletos");

  const client = clients.find(c=>c.id===clientId);
  const bruto = round2(miles * client.rate);
  const connectAdj = client.connect ? round2(bruto * 0.15) : 0;
  const neto = round2(bruto - connectAdj);
  const company = round2(neto * 0.30);
  const driverGross = round2(neto - company);
  const retention = round2(driverGross * 0.10);
  const driverNet = round2(driverGross - retention);

  await db.collection("services").add({
    date: new Date().toISOString().slice(0,10),
    week: mondayOf(new Date()),
    driverUid: currentUser.uid,
    driverEmail: currentUser.email,
    clientId,
    miles,
    bruto,
    connectAdj,
    neto,
    driverNet,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  $("drvMiles").value="";
  loadDashboard();
});

/* ===============================
   Dashboard
   =============================== */
async function loadDashboard(){
  const wk = mondayOf(new Date());
  let q = db.collection("services").where("week","==",wk);

  if(userData.role==="driver"){
    q = q.where("driverUid","==",currentUser.uid);
  }

  const snap = await q.get();
  const list = snap.docs.map(d=>d.data());

  $("kpiWeekMiles").textContent =
    round2(list.reduce((a,s)=>a+num(s.miles),0));

  $("kpiWeekServices").textContent = list.length;

  $("kpiWeekNet").textContent =
    money(list.reduce((a,s)=>a+num(s.driverNet),0));

  const tb = $("dashboardRecent");
  if(tb){
    tb.innerHTML = list.slice(-10).reverse().map(s=>`
      <tr>
        <td>${s.date}</td>
        <td>${clients.find(c=>c.id===s.clientId)?.name||""}</td>
        <td>${s.driverEmail}</td>
        <td class="num">${s.miles}</td>
        <td class="num">${money(s.driverNet)}</td>
      </tr>
    `).join("");
  }
}

/* ===============================
   Weekly PDF (Admin)
   =============================== */
$("btnExportPDF")?.addEventListener("click", async ()=>{
  if(userData.role!=="admin") return;

  const wk = $("admWeekStart").value;
  if(!wk) return;

  const snap = await db.collection("services").where("week","==",wk).get();
  const list = snap.docs.map(d=>d.data());

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y=10;

  pdf.text("Nexus Transport PR — Cierre Semanal",10,y); y+=10;

  list.forEach(s=>{
    pdf.text(
      `${s.date} | ${s.driverEmail} | ${money(s.driverNet)}`,
      10,y
    );
    y+=8;
    if(y>270){ pdf.addPage(); y=10; }
  });

  pdf.save(`cierre_${wk}.pdf`);
});
