/* =========================================================
   Nexus Transport PR — app.js COMPLETO
   ========================================================= */

(() => {
"use strict";

/* ================= FIREBASE ================= */
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
const db   = firebase.firestore();

/* ================= CONSTANTES ================= */
const C = {
  USERS:"users",
  INVITES:"invites",
  CLIENTS:"clients",
  SERVICES:"services",
  SETTINGS:"settings"
};

const DEFAULT_SETTINGS = {
  brand:"Nexus Transport PR",
  footer:"Resumen generado por Nexus Transport PR",
  connectPct:0.15,
  companyPct:0.30,
  retentionPct:0.10
};

/* ================= HELPERS ================= */
const $ = id => document.getElementById(id);
const $$ = q => Array.from(document.querySelectorAll(q));
const num = v => Number(v)||0;
const round2 = n => Math.round((n+Number.EPSILON)*100)/100;
const money = n => round2(n).toLocaleString("en-US",{style:"currency",currency:"USD"});
const todayISO = () => new Date().toISOString().slice(0,10);
const mondayOf = iso => {
  const d=new Date(iso+"T00:00");
  const day=d.getDay();
  d.setDate(d.getDate()-day+(day===0?-6:1));
  return d.toISOString().slice(0,10);
};

/* ================= ESTADO ================= */
const S = {
  user:null,
  profile:null,
  role:null,
  settings:{...DEFAULT_SETTINGS},
  clients:[],
  users:[]
};

/* ================= PANTALLAS ================= */
const showAuth=()=>{$("authScreen").classList.remove("hidden");$("pinScreen").classList.add("hidden");$("topbar").classList.add("hidden");$("app").classList.add("hidden");};
const showPin=()=>{$("authScreen").classList.add("hidden");$("pinScreen").classList.remove("hidden");$("topbar").classList.add("hidden");$("app").classList.add("hidden");};
const showApp=()=>{$("authScreen").classList.add("hidden");$("pinScreen").classList.add("hidden");$("topbar").classList.remove("hidden");$("app").classList.remove("hidden");};

/* ================= PIN ================= */
async function sha256(t){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
const pinHash=(uid,p)=>sha256(uid+":"+p);

/* ================= AUTH ================= */
auth.onAuthStateChanged(async user=>{
  if(!user){showAuth();return;}

  S.user=user;
  let uref=db.collection(C.USERS).doc(user.uid);
  let usnap=await uref.get();

  if(!usnap.exists){
    const inv=await db.collection(C.INVITES).doc(user.email).get();
    if(!inv.exists){alert("No autorizado");auth.signOut();return;}
    await uref.set({
      email:user.email,
      role:inv.data().role||"driver",
      pinHash:"",
      active:true
    });
  }

  usnap=await uref.get();
  S.profile=usnap.data();
  S.role=S.profile.role;

  $("whoLine").textContent=user.email;
  $("rolePill").textContent=S.role.toUpperCase();

  await loadSettings();
  await loadClients();
  if(S.role==="admin") await loadUsers();

  fillClients("qsClient");
  $("qsDate").value=todayISO();

  showPin();
});

/* ================= LOADERS ================= */
async function loadSettings(){
  const ref=db.collection(C.SETTINGS).doc("global");
  const s=await ref.get();
  if(!s.exists) await ref.set(DEFAULT_SETTINGS,{merge:true});
  S.settings={...DEFAULT_SETTINGS,...(await ref.get()).data()};
  $("brandName").textContent=S.settings.brand;
}
async function loadClients(){
  const s=await db.collection(C.CLIENTS).get();
  S.clients=s.docs.map(d=>({id:d.id,...d.data()}));
}
async function loadUsers(){
  const s=await db.collection(C.USERS).get();
  S.users=s.docs.map(d=>({uid:d.id,...d.data()}));
}

/* ================= UI ================= */
function fillClients(id){
  const el=$(id); if(!el) return;
  el.innerHTML=`<option value="">—</option>`+
    S.clients.filter(c=>c.active!==false)
    .map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
}
function setView(v){
  $$(".view").forEach(x=>x.classList.remove("active"));
  $("view-"+v).classList.add("active");
  $$(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelector(`.tab[data-view="${v}"]`).classList.add("active");
}

/* ================= PIN ACTIONS ================= */
$("btnPinConfirm").onclick=async()=>{
  const p=$("pinInput").value;
  if(await pinHash(S.user.uid,p)!==S.profile.pinHash){alert("PIN incorrecto");return;}
  afterEnter();
};
$("btnPinSet").onclick=async()=>{
  const p1=$("pinNew").value,p2=$("pinNew2").value;
  if(p1!==p2||p1.length<4){alert("PIN inválido");return;}
  await db.collection(C.USERS).doc(S.user.uid).update({pinHash:await pinHash(S.user.uid,p1)});
  afterEnter();
};

/* ================= AFTER ENTER ================= */
async function afterEnter(){
  showApp();
  setView("dashboard");
  refreshDashboard();
}

/* ================= DASHBOARD ================= */
async function refreshDashboard(){
  const week=mondayOf(todayISO());
  const q=await db.collection(C.SERVICES)
    .where("date",">=",week).get();

  let miles=0,services=0,driverNet=0,company=0;

  q.docs.forEach(d=>{
    const s=d.data();
    miles+=num(s.miles);
    services++;
    driverNet+=num(s.driverNet);
    company+=num(s.companyAmt);
  });

  $("kpiWeekRange").textContent="Semana desde "+week;
  $("kpiWeekMiles").textContent=round2(miles);
  $("kpiWeekServices").textContent=services;
  $("kpiWeekDriverNet").textContent=money(driverNet);
  $("kpiWeekCompany").textContent=money(company);

  renderRecent(q.docs);
}

/* ================= QUICK SAVE ================= */
$("btnQuickSave").onclick=async()=>{
  const d=$("qsDate").value;
  const c=$("qsClient").value;
  const m=num($("qsMiles").value);
  if(!d||!c||!m){alert("Datos incompletos");return;}

  const client=S.clients.find(x=>x.id===c);
  const gross=m*client.rate;
  const connect=client.connect?gross*S.settings.connectPct:0;
  const company=gross*S.settings.companyPct;
  const retention=gross*S.settings.retentionPct;
  const driver=gross-connect-company-retention;

  await db.collection(C.SERVICES).add({
    date:d,
    clientId:c,
    miles:m,
    gross,
    connectAmt:connect,
    companyAmt:company,
    retentionAmt:retention,
    driverNet:driver,
    driverUid:S.user.uid,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });

  $("qsMiles").value="";
  refreshDashboard();
};

/* ================= RECENT ================= */
function renderRecent(docs){
  $("dashRecent").innerHTML=docs.slice(-10).reverse().map(d=>{
    const s=d.data();
    const c=S.clients.find(x=>x.id===s.clientId);
    return `<tr>
      <td>${s.date}</td>
      <td>${c?.name||"—"}</td>
      <td class="num">${s.miles}</td>
      <td class="num">${money(s.gross)}</td>
      <td class="num">${money(s.driverNet)}</td>
      <td class="num">${S.role==="admin"?`<button data-del="${d.id}">🗑</button>`:""}</td>
    </tr>`;
  }).join("");
}

/* ================= DELEGACIÓN ================= */
document.addEventListener("click",async e=>{
  const del=e.target.closest("[data-del]");
  if(del&&S.role==="admin"){
    if(confirm("Borrar servicio?")){
      await db.collection(C.SERVICES).doc(del.dataset.del).delete();
      refreshDashboard();
    }
  }
  const tab=e.target.closest(".tab[data-view]");
  if(tab) setView(tab.dataset.view);
  if(e.target.id==="btnLogout") auth.signOut();
  if(e.target.id==="btnGoogleLogin") auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
});

/* ================= INIT ================= */
showAuth();

})();
