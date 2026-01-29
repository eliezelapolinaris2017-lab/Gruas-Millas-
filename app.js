/* =========================================================
   Nexus Transport PR — app.js (PRO FIX)
   - Delegación global de clicks: tabs + recargar + salir
   - Firebase Auth (Google) + Firestore (v8)
   - PIN (hash SHA-256)
   - Roles: admin / driver
   - Fix: buildInvoice completo + Driver PDF + CSV + deleteMany
   ========================================================= */

(() => {
  "use strict";

  const NTPR_APP_VERSION = "2.3.0-PRO-FIX";

  /* =========================
     0) Firebase Config
  ========================= */
  const firebaseConfig = {
    apiKey: "AIzaSyDGoSNKi1wapE1SpHxTc8wNZGGkJ2nQj7s",
    authDomain: "nexus-transport-2887b.firebaseapp.com",
    projectId: "nexus-transport-2887b",
    storageBucket: "nexus-transport-2887b.firebasestorage.app",
    messagingSenderId: "972915419764",
    appId: "1:972915419764:web:7d61dfb03bbe56df867f21"
  };

  if (!window.firebase) {
    alert("Firebase SDK no cargó. Revisa los <script> en index.html.");
    return;
  }
  if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db   = firebase.firestore();

  console.log("NTPR_APP_VERSION:", NTPR_APP_VERSION);
  console.log("Firebase inicializado:", firebaseConfig.projectId);

  /* =========================
     1) Helpers
  ========================= */
  const $  = (id)=>document.getElementById(id);
  const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

  const num = (v)=> {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n)=> Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const money = (n)=> round2(n).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const todayISO = ()=> new Date().toISOString().slice(0,10);

  const mondayOf = (iso)=>{
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0,10);
  };

  const escapeHtml = (s)=> String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function toast(msg){ alert(msg); }

  function csvEscape(v){
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
    return s;
  }

  function downloadText(filename, text, mime="text/plain"){
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* =========================
     2) Cache
  ========================= */
  const CACHE = {
    SETTINGS: "ntpr.settings.cache.v1",
    CLIENTS:  "ntpr.clients.cache.v1",
    USERS:    "ntpr.users.cache.v1"
  };
  const loadJSON = (k, fb)=>{
    try{ const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; }
  };
  const saveJSON = (k, v)=> localStorage.setItem(k, JSON.stringify(v));

  /* =========================
     3) Collections
  ========================= */
  const C = {
    USERS: "users",
    INVITES: "invites",
    CLIENTS: "clients",
    SERVICES: "services",
    SETTINGS: "settings" // doc "global"
  };

  /* =========================
     4) Defaults
  ========================= */
  const DEFAULT_SETTINGS = {
    brand: "Nexus Transport PR",
    footer: "Resumen generado por Nexus Transport PR",
    connectPct: 0.15,
    companyPct: 0.30,
    retentionPct: 0.10
  };

  /* =========================
     5) State
  ========================= */
  const S = {
    user: null,
    profile: null,
    role: null,

    settings: { ...DEFAULT_SETTINGS },
    clients: [],
    users: [],

    selectedUserUid: null,
    selectedClientId: null,
    _adminSvcRows: []
  };

  /* =========================
     6) Crypto (PIN Hash)
  ========================= */
  async function sha256Hex(text){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  }
  async function pinHash(uid, pin){
    return sha256Hex(`${uid}:${String(pin || "")}`);
  }

  /* =========================
     7) UI Core
  ========================= */
  function setView(name){
    $$(".view").forEach(v=>v.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");

    $$(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("active");
  }

  function setShell(authenticated){
    const top = $("topbar");
    const app = $("app");
    if (top) top.hidden = !authenticated;
    if (app) app.hidden = false; // login vive aquí
    if (!authenticated) setView("login");
  }

  function setAdminTabsVisible(isAdmin){
    const ids = ["tabAdminUsers","tabAdminClients","tabAdminServices","tabAdminClose","tabAdminInvoices","tabAdminSettings"];
    ids.forEach(id => { const el = $(id); if (el) el.style.display = isAdmin ? "" : "none"; });
  }

  /* =========================
     8) ✅ EVENT DELEGATION
  ========================= */
  document.addEventListener("click", async (e)=>{
    const tab = e.target.closest?.(".tab[data-view]");
    if (tab){
      const v = tab.dataset.view;
      if (!v) return;

      if (!S.user){ setView("login"); return; }
      const isAdminView = v.startsWith("admin");
      if (isAdminView && S.role !== "admin") return;

      setView(v);
      await refreshView(v);
      return;
    }

    if (e.target.closest?.("#btnReload")){
      location.reload();
      return;
    }

    if (e.target.closest?.("#btnLogout")){
      auth.signOut();
      return;
    }

    if (e.target.closest?.("#btnGoogleLogin")){
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      return;
    }

    if (e.target.closest?.("#btnPinConfirm")){
      await onPinConfirm();
      return;
    }

    if (e.target.closest?.("#btnPinSet")){
      await onPinSet();
      return;
    }

    if (e.target.closest?.("#btnQuickSave")){
      await quickSave();
      return;
    }
    if (e.target.closest?.("#btnQuickClear")){
      if ($("qsMiles")) $("qsMiles").value = "";
      if ($("qsNote")) $("qsNote").value = "";
      if ($("quickPreview")) $("quickPreview").textContent = "—";
      return;
    }

    if (e.target.closest?.("#btnDrvFilter")){
      await renderDriverHistory();
      return;
    }
    if (e.target.closest?.("#btnDrvPDF")){
      await driverPDF();
      return;
    }

    if (e.target.closest?.("#btnSvcFilter")){
      await renderServicesAdmin();
      return;
    }
    if (e.target.closest?.("#btnSvcCSV")){
      await exportServicesCSV();
      return;
    }
    if (e.target.closest?.("#btnSvcDeleteMany")){
      await deleteManyServices();
      return;
    }

    if (e.target.closest?.("#btnBuildWeekly")){
      await buildWeekly(false);
      return;
    }
    if (e.target.closest?.("#btnWeeklyPDF")){
      await buildWeekly(true);
      return;
    }

    if (e.target.closest?.("#btnBuildInvoice")){
      await buildInvoice(false);
      return;
    }
    if (e.target.closest?.("#btnInvoicePDF")){
      await buildInvoice(true);
      return;
    }

    if (e.target.closest?.("#btnInviteUser")){
      await inviteUser();
      return;
    }
    if (e.target.closest?.("#btnResetPin")){
      await resetPin();
      return;
    }

    if (e.target.closest?.("#btnSaveClient")){
      await saveClient();
      return;
    }
    if (e.target.closest?.("#btnClearClient")){
      prefillClientForm(null);
      return;
    }

    if (e.target.closest?.("#btnSaveSettings")){
      await saveSettings();
      return;
    }
    if (e.target.closest?.("#btnWipeCache")){
      localStorage.removeItem(CACHE.SETTINGS);
      localStorage.removeItem(CACHE.CLIENTS);
      localStorage.removeItem(CACHE.USERS);
      toast("Cache local limpiado ✅");
      return;
    }

    const delDash = e.target.closest?.("[data-del]");
    if (delDash && S.role==="admin"){
      const id = delDash.getAttribute("data-del");
      if (!id) return;
      if (!confirm("Borrar servicio?")) return;
      await db.collection(C.SERVICES).doc(id).delete();
      await refreshAll();
      return;
    }

    const pickUser = e.target.closest?.("[data-pick-user]");
    if (pickUser && S.role==="admin"){
      S.selectedUserUid = pickUser.getAttribute("data-pick-user");
      toast(`Usuario seleccionado: ${S.selectedUserUid}`);
      return;
    }

    const editClientBtn = e.target.closest?.("[data-edit-client]");
    if (editClientBtn && S.role==="admin"){
      const id = editClientBtn.getAttribute("data-edit-client");
      const c = S.clients.find(x=>x.id===id);
      prefillClientForm(c);
      return;
    }

    const delOne = e.target.closest?.("[data-del-one]");
    if (delOne && S.role==="admin"){
      const id = delOne.getAttribute("data-del-one");
      if (!confirm("Borrar servicio?")) return;
      await db.collection(C.SERVICES).doc(id).delete();
      await renderServicesAdmin();
      return;
    }
  });

  /* =========================
     9) Fill selects
  ========================= */
  function fillClients(selectId){
    const el = $(selectId);
    if (!el) return;

    const list = S.clients.filter(c=>c.active !== false).slice()
      .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));

    el.innerHTML = `<option value="">—</option>` + list.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
  }

  function fillDrivers(selectId){
    const el = $(selectId);
    if (!el) return;

    const list = S.users.filter(u=>u.role==="driver" && u.active !== false).slice()
      .sort((a,b)=>String(a.email||"").localeCompare(String(b.email||"")));

    el.innerHTML = `<option value="">—</option>` + list.map(u =>
      `<option value="${u.uid}">${escapeHtml(u.email || u.uid)}</option>`
    ).join("");
  }

  /* =========================
     10) Load data
  ========================= */
  async function ensureGlobalSettings(){
    const ref = db.collection(C.SETTINGS).doc("global");
    const snap = await ref.get();
    if (snap.exists) return;
    await ref.set({ ...DEFAULT_SETTINGS, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
  }

  async function loadSettings(force=false){
    if (!force) { S.settings = { ...DEFAULT_SETTINGS, ...(loadJSON(CACHE.SETTINGS, {})) }; return; }
    await ensureGlobalSettings();
    const snap = await db.collection(C.SETTINGS).doc("global").get();
    S.settings = { ...DEFAULT_SETTINGS, ...(snap.data()||{}) };
    saveJSON(CACHE.SETTINGS, S.settings);
  }

  async function ensureMinimumClients(){
    const snap = await db.collection(C.CLIENTS).limit(1).get();
    if (!snap.empty) return;

    const batch = db.batch();
    const defaults = [
      { name:"Connect", rate: 1.00, connect:true,  active:true },
      { name:"Dealer",  rate: 1.00, connect:false, active:true },
      { name:"Privado", rate: 1.00, connect:false, active:true },
      { name:"AAA",     rate: 1.00, connect:false, active:true }
    ];
    defaults.forEach(c=>{
      const doc = db.collection(C.CLIENTS).doc();
      batch.set(doc, { ...c, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  }

  async function loadClients(force=false){
    if (!force) { S.clients = loadJSON(CACHE.CLIENTS, []); return; }
    await ensureMinimumClients();
    const snap = await db.collection(C.CLIENTS).get();
    S.clients = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    saveJSON(CACHE.CLIENTS, S.clients);
  }

  async function loadUsers(force=false){
    if (!force) { S.users = loadJSON(CACHE.USERS, []); return; }
    const snap = await db.collection(C.USERS).get();
    S.users = snap.docs.map(d=>({ uid:d.id, ...d.data() }));
    saveJSON(CACHE.USERS, S.users);
  }

  /* =========================
     11) Settings form
  ========================= */
  function prefillSettingsForm(){
    if ($("brandName")) $("brandName").textContent = S.settings.brand || DEFAULT_SETTINGS.brand;
    if ($("setBrand")) $("setBrand").value = S.settings.brand ?? DEFAULT_SETTINGS.brand;
    if ($("setConnect")) $("setConnect").value = S.settings.connectPct ?? DEFAULT_SETTINGS.connectPct;
    if ($("setCompany")) $("setCompany").value = S.settings.companyPct ?? DEFAULT_SETTINGS.companyPct;
    if ($("setRetention")) $("setRetention").value = S.settings.retentionPct ?? DEFAULT_SETTINGS.retentionPct;
    if ($("setFooter")) $("setFooter").value = S.settings.footer ?? DEFAULT_SETTINGS.footer;
  }

  /* =========================
     12) Auth flow
  ========================= */
  auth.onAuthStateChanged(async (user)=>{
    if ($("pinError")) $("pinError").textContent = "";
    if ($("pinSetError")) $("pinSetError").textContent = "";

    if (!user){
      S.user=null; S.profile=null; S.role=null;
      setShell(false);
      if ($("loginMsg")) $("loginMsg").textContent = "Inicia sesión con Google";
      return;
    }

    S.user = user;
    setShell(true);
    setView("login");

    if ($("loginMsg")) $("loginMsg").textContent = "Google OK. Validando acceso...";

    const uref = db.collection(C.USERS).doc(user.uid);
    const usnap = await uref.get();

    if (!usnap.exists){
      const email = (user.email || "").toLowerCase();
      if (!email) { if ($("loginMsg")) $("loginMsg").textContent = "Email no disponible."; return; }

      const inv = await db.collection(C.INVITES).doc(email).get();
      if (!inv.exists){ if ($("loginMsg")) $("loginMsg").textContent = "No autorizado. Admin debe invitar tu email."; return; }

      const invData = inv.data() || {};
      if (invData.active === false){ if ($("loginMsg")) $("loginMsg").textContent = "Invitación inactiva."; return; }

      await uref.set({
        email,
        displayName: user.displayName || "",
        role: invData.role || "driver",
        active: invData.active !== false,
        pinHash: "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });

      if ($("loginMsg")) $("loginMsg").textContent = "Usuario creado. Ahora crea tu PIN.";
    }

    const fresh = await uref.get();
    S.profile = fresh.data();
    S.role = S.profile.role || "driver";

    if ($("whoLine")) $("whoLine").textContent = `${S.profile.email || user.email || "—"}`;
    if ($("rolePill")) $("rolePill").textContent = (S.role || "—").toUpperCase();

    setAdminTabsVisible(S.role === "admin");

    await loadSettings(true);
    await loadClients(true);
    if (S.role === "admin") await loadUsers(true);

    fillClients("qsClient");
    fillClients("sClient");
    fillClients("invClient");
    fillDrivers("sDriver");
    fillDrivers("wkDriver");

    if ($("qsDate")) $("qsDate").value = todayISO();
    if ($("sWeek")) $("sWeek").value = mondayOf(todayISO());
    if ($("wkStart")) $("wkStart").value = mondayOf(todayISO());
    if ($("invWeek")) $("invWeek").value = mondayOf(todayISO());

    prefillSettingsForm();

    if (!S.profile.pinHash){
      if ($("loginMsg")) $("loginMsg").textContent = "Crea tu PIN (primera vez) y entra.";
    } else {
      if ($("loginMsg")) $("loginMsg").textContent = "Confirma tu PIN para entrar.";
    }
  });

  /* =========================
     13) PIN actions
  ========================= */
  async function onPinConfirm(){
    if ($("pinError")) $("pinError").textContent = "";
    if (!S.user || !S.profile) return;

    const pin = ($("pinInput")?.value || "").trim();
    if (!pin) { if ($("pinError")) $("pinError").textContent = "PIN requerido."; return; }

    const actual = await pinHash(S.user.uid, pin);
    if (actual !== (S.profile.pinHash || "")) {
      if ($("pinError")) $("pinError").textContent = "PIN incorrecto.";
      return;
    }
    await afterEnter();
  }

  async function onPinSet(){
    if ($("pinSetError")) $("pinSetError").textContent = "";
    if (!S.user) return;

    const p1 = ($("pinNew")?.value || "").trim();
    const p2 = ($("pinNew2")?.value || "").trim();
    if (!p1 || !p2) { if ($("pinSetError")) $("pinSetError").textContent = "Completa ambos campos."; return; }
    if (p1 !== p2) { if ($("pinSetError")) $("pinSetError").textContent = "PIN no coincide."; return; }
    if (p1.length < 4) { if ($("pinSetError")) $("pinSetError").textContent = "PIN mínimo 4 dígitos."; return; }

    const h = await pinHash(S.user.uid, p1);
    await db.collection(C.USERS).doc(S.user.uid).set({
      pinHash: h,
      pinUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    const fresh = await db.collection(C.USERS).doc(S.user.uid).get();
    S.profile = fresh.data();
    S.role = S.profile.role || "driver";

    toast("PIN guardado ✅");
    await afterEnter();
  }

  async function afterEnter(){
    if (!S.user) return;

    await loadSettings(true);
    await loadClients(true);
    if (S.role === "admin") await loadUsers(true);

    fillClients("qsClient");
    fillClients("sClient");
    fillClients("invClient");
    fillDrivers("sDriver");
    fillDrivers("wkDriver");

    prefillSettingsForm();

    setShell(true);
    setView("dashboard");
    await refreshAll();
  }

  /* =========================
     14) Calculation
  ========================= */
  function calc(miles, client){
    const m = round2(num(miles));
    const rate = round2(num(client.rate));

    const bruto = round2(m * rate);
    const connectAdj = client.connect ? round2(bruto * num(S.settings.connectPct)) : 0;

    const netSplit = round2(bruto - connectAdj);
    const company = round2(netSplit * num(S.settings.companyPct));
    const driverGross = round2(netSplit - company);
    const retention = round2(driverGross * num(S.settings.retentionPct));
    const driverNet = round2(driverGross - retention);

    return { m, rate, bruto, connectAdj, netSplit, company, driverGross, retention, driverNet };
  }

  /* =========================
     15) Quick Save
  ========================= */
  async function quickSave(){
    if (!S.user || !S.profile) return toast("Primero inicia sesión.");

    const dateISO = $("qsDate")?.value || todayISO();
    const clientId = $("qsClient")?.value || "";
    const miles = num($("qsMiles")?.value);
    const note = ($("qsNote")?.value || "").trim();

    if (!clientId) return toast("Selecciona cliente.");
    if (miles <= 0) return toast("Millas deben ser > 0.");

    const client = S.clients.find(c=>c.id===clientId && c.active !== false);
    if (!client) return toast("Cliente inválido.");

    const weekISO = mondayOf(dateISO);
    const r = calc(miles, client);

    const dayKey = `${S.user.uid}|${dateISO}|${clientId}|${r.m}`;
    const dup = await db.collection(C.SERVICES).where("dayKey","==",dayKey).limit(1).get();
    if (!dup.empty) return toast("Duplicado detectado (mismo día/cliente/millas).");

    await db.collection(C.SERVICES).add({
      dayKey, dateISO, weekISO,
      driverUid: S.user.uid,
      driverEmail: (S.profile.email || S.user.email || ""),
      driverName: (S.profile.displayName || S.user.displayName || ""),
      clientId: client.id,
      clientName: client.name,
      clientRate: r.rate,
      clientConnect: !!client.connect,
      miles: r.m,
      bruto: r.bruto,
      connectAdj: r.connectAdj,
      netSplit: r.netSplit,
      company: r.company,
      driverGross: r.driverGross,
      retention: r.retention,
      driverNet: r.driverNet,
      note,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if ($("qsMiles")) $("qsMiles").value = "";
    if ($("qsNote")) $("qsNote").value = "";
    if ($("quickPreview")) $("quickPreview").textContent = "Guardado ✅";
    await refreshAll();
  }

  /* =========================
     16) Dashboard
  ========================= */
  async function queryWeekServices(weekISO){
    if (!S.user) return [];
    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (S.role !== "admin") q = q.where("driverUid","==",S.user.uid);
    const snap = await q.get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function renderDashboard(){
    if (!S.user) { setView("login"); return; }

    const wk = mondayOf(todayISO());
    if ($("kpiWeekRange")) $("kpiWeekRange").textContent = `Semana desde ${wk}`;

    const list = await queryWeekServices(wk);
    const miles = round2(list.reduce((a,s)=>a+num(s.miles),0));
    const driverNet = round2(list.reduce((a,s)=>a+num(s.driverNet),0));
    const company = round2(list.reduce((a,s)=>a+num(s.company),0));

    if ($("kpiWeekMiles")) $("kpiWeekMiles").textContent = miles.toFixed(1);
    if ($("kpiWeekServices")) $("kpiWeekServices").textContent = String(list.length);
    if ($("kpiWeekDriverNet")) $("kpiWeekDriverNet").textContent = money(driverNet);
    if ($("kpiWeekCompany")) $("kpiWeekCompany").textContent = money(company);

    const tb = $("dashRecent");
    if (!tb) return;

    tb.innerHTML = list.slice(0,20).map(s=>`
      <tr>
        <td>${escapeHtml(s.dateISO||"")}</td>
        <td>${escapeHtml(s.clientName||"")}</td>
        <td class="num">${round2(s.miles||0)}</td>
        <td class="num">${money(s.bruto||0)}</td>
        <td class="num">${money(s.driverNet||0)}</td>
        <td class="num">${S.role==="admin" ? `<button class="btn danger" data-del="${s.id}">X</button>` : ""}</td>
      </tr>
    `).join("");
  }

  /* =========================
     17) Driver History + PDF
  ========================= */
  async function queryMyRange(fromISO, toISO){
    if (!S.user) return [];
    let q = db.collection(C.SERVICES)
      .where("driverUid","==",S.user.uid)
      .where("dateISO",">=",fromISO)
      .where("dateISO","<=",toISO);

    const snap = await q.get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  function renderDriverTableHead(mode){
    const head = $("drvHead");
    if (!head) return;
    if (mode==="week"){
      head.innerHTML = `<tr><th>Semana</th><th class="num">Servicios</th><th class="num">Millas</th><th class="num">Neto</th></tr>`;
    } else if (mode==="month"){
      head.innerHTML = `<tr><th>Mes</th><th class="num">Servicios</th><th class="num">Millas</th><th class="num">Neto</th></tr>`;
    } else {
      head.innerHTML = `<tr><th>Fecha</th><th>Cliente</th><th class="num">Millas</th><th class="num">Neto</th></tr>`;
    }
  }

  function groupByWeek(rows){
    const map = new Map();
    rows.forEach(r=>{
      const k = r.weekISO || mondayOf(r.dateISO);
      const cur = map.get(k) || { k, count:0, miles:0, net:0 };
      cur.count += 1;
      cur.miles += num(r.miles);
      cur.net   += num(r.driverNet);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a,b)=> (a.k < b.k ? 1 : -1));
  }

  function groupByMonth(rows){
    const map = new Map();
    rows.forEach(r=>{
      const k = String(r.dateISO||"").slice(0,7);
      const cur = map.get(k) || { k, count:0, miles:0, net:0 };
      cur.count += 1;
      cur.miles += num(r.miles);
      cur.net   += num(r.driverNet);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a,b)=> (a.k < b.k ? 1 : -1));
  }

  async function renderDriverHistory(){
    if (!S.user) { setView("login"); return []; }

    const from = $("drvFrom")?.value || "1900-01-01";
    const to   = $("drvTo")?.value || todayISO();
    const mode = $("drvGroup")?.value || "none";

    const rows = await queryMyRange(from, to);
    renderDriverTableHead(mode);

    const body = $("drvBody");
    if (!body) return rows;

    if (mode==="week"){
      const g = groupByWeek(rows);
      body.innerHTML = g.map(x=>`
        <tr>
          <td>${escapeHtml(x.k)}</td>
          <td class="num">${x.count}</td>
          <td class="num">${round2(x.miles).toFixed(1)}</td>
          <td class="num">${money(x.net)}</td>
        </tr>
      `).join("");
    } else if (mode==="month"){
      const g = groupByMonth(rows);
      body.innerHTML = g.map(x=>`
        <tr>
          <td>${escapeHtml(x.k)}</td>
          <td class="num">${x.count}</td>
          <td class="num">${round2(x.miles).toFixed(1)}</td>
          <td class="num">${money(x.net)}</td>
        </tr>
      `).join("");
    } else {
      body.innerHTML = rows.map(r=>`
        <tr>
          <td>${escapeHtml(r.dateISO)}</td>
          <td>${escapeHtml(r.clientName||"")}</td>
          <td class="num">${round2(r.miles||0).toFixed(1)}</td>
          <td class="num">${money(r.driverNet||0)}</td>
        </tr>
      `).join("");
    }
    return rows;
  }

  async function driverPDF(){
    if (!S.user) return toast("Primero inicia sesión.");
    const rows = await renderDriverHistory();

    if (!window.jspdf) return toast("jsPDF no cargó.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });

    const from = $("drvFrom")?.value || "1900-01-01";
    const to   = $("drvTo")?.value || todayISO();
    const mode = $("drvGroup")?.value || "none";

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`${S.settings.brand} — Historial Chofer`, 40, 50);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Chofer: ${S.profile?.email || S.user.email || ""}`, 40, 70);
    doc.text(`Rango: ${from} a ${to} | Vista: ${mode}`, 40, 84);

    let y = 110;
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.text("Fecha", 40, y);
    doc.text("Cliente", 140, y);
    doc.text("Millas", 420, y, { align: "right" });
    doc.text("Neto", 520, y, { align: "right" });
    y += 12;
    doc.setFont("helvetica","normal");

    const limit = 38;
    const slice = rows.slice(0, limit);
    slice.forEach(r=>{
      doc.text(String(r.dateISO||""), 40, y);
      doc.text(String(r.clientName||"").slice(0,28), 140, y);
      doc.text(String(round2(r.miles||0).toFixed(1)), 420, y, { align: "right" });
      doc.text(String(money(r.driverNet||0)), 520, y, { align: "right" });
      y += 12;
    });

    if (rows.length > limit){
      doc.text(`(Mostrando ${limit} de ${rows.length} registros)`, 40, y+10);
    }

    doc.save(`historial_chofer_${from}_${to}.pdf`);
  }

  /* =========================
     18) Admin
  ========================= */
  async function renderUsers(){
    if (S.role !== "admin") return;
    await loadUsers(true);
    const tb = $("usersTable");
    if (!tb) return;

    tb.innerHTML = S.users.slice().sort((a,b)=>String(a.email||"").localeCompare(String(b.email||""))).map(u=>`
      <tr>
        <td>${escapeHtml(u.email||"")}</td>
        <td>${escapeHtml(u.role||"")}</td>
        <td>${u.active !== false ? "Sí":"No"}</td>
        <td>${escapeHtml(u.uid)}</td>
        <td>${u.pinHash ? "OK":"—"}</td>
        <td><button class="btn" data-pick-user="${u.uid}">Seleccionar</button></td>
      </tr>
    `).join("");

    fillDrivers("sDriver");
    fillDrivers("wkDriver");
  }

  async function inviteUser(){
    if (S.role !== "admin") return;

    const email = ($("uEmail")?.value || "").trim().toLowerCase();
    const role = $("uRole")?.value || "driver";
    const active = (($("uActive")?.value || "true") === "true");
    const note = ($("uNote")?.value || "").trim();

    if (!email || !email.includes("@")) return toast("Email inválido.");

    await db.collection(C.INVITES).doc(email).set({
      email, role, active, note,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    toast("Invitación guardada ✅");
    if ($("uEmail")) $("uEmail").value = "";
    if ($("uNote")) $("uNote").value = "";
    await renderUsers();
  }

  async function resetPin(){
    if (S.role !== "admin") return;
    if (!S.selectedUserUid) return toast("Selecciona un usuario primero.");

    if (!confirm("Reset PIN: el usuario tendrá que crear PIN nuevo al entrar. ¿Seguro?")) return;

    await db.collection(C.USERS).doc(S.selectedUserUid).set({
      pinHash: "",
      pinResetAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    toast("PIN reseteado ✅");
    await renderUsers();
  }

  function prefillClientForm(c){
    if ($("cName")) $("cName").value = c?.name || "";
    if ($("cRate")) $("cRate").value = c?.rate ?? "";
    if ($("cConnect")) $("cConnect").value = c?.connect ? "yes":"no";
    if ($("cActive")) $("cActive").value = (c?.active !== false) ? "true":"false";
    S.selectedClientId = c?.id || null;
  }

  async function renderClients(){
    if (S.role !== "admin") return;
    await loadClients(true);

    fillClients("qsClient");
    fillClients("sClient");
    fillClients("invClient");

    const tb = $("clientsTable");
    if (!tb) return;

    const list = S.clients.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
    tb.innerHTML = list.map(c=>`
      <tr>
        <td>${escapeHtml(c.name||"")}</td>
        <td class="num">${money(c.rate||0)}</td>
        <td>${c.connect ? "Sí":"No"}</td>
        <td>${c.active !== false ? "Sí":"No"}</td>
        <td><button class="btn" data-edit-client="${c.id}">Editar</button></td>
      </tr>
    `).join("");
  }

  async function saveClient(){
    if (S.role !== "admin") return;

    const name = ($("cName")?.value || "").trim();
    const rate = round2(num($("cRate")?.value));
    const connect = (($("cConnect")?.value || "no") === "yes");
    const active = (($("cActive")?.value || "true") === "true");

    if (!name) return toast("Nombre requerido.");
    if (rate <= 0) return toast("Tarifa debe ser > 0.");

    if (S.selectedClientId){
      await db.collection(C.CLIENTS).doc(S.selectedClientId).set({
        name, rate, connect, active,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
    } else {
      await db.collection(C.CLIENTS).add({
        name, rate, connect, active,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    prefillClientForm(null);
    toast("Cliente guardado ✅");
    await renderClients();
  }

  async function queryServicesAdmin(){
    const week = $("sWeek")?.value || "";
    const driverUid = $("sDriver")?.value || "";
    const clientId = $("sClient")?.value || "";

    let q = db.collection(C.SERVICES);
    if (week) q = q.where("weekISO","==",week);
    if (driverUid) q = q.where("driverUid","==",driverUid);
    if (clientId) q = q.where("clientId","==",clientId);

    const snap = await q.get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function renderServicesAdmin(){
    if (S.role !== "admin") return;

    const rows = await queryServicesAdmin();
    const tb = $("servicesTable");
    if (!tb) return;

    tb.innerHTML = rows.map(r=>`
      <tr>
        <td><input type="checkbox" data-pick-svc="${r.id}"></td>
        <td>${escapeHtml(r.dateISO||"")}</td>
        <td>${escapeHtml(r.driverEmail||"")}</td>
        <td>${escapeHtml(r.clientName||"")}</td>
        <td class="num">${round2(r.miles||0).toFixed(1)}</td>
        <td class="num">${money(r.bruto||0)}</td>
        <td class="num">${money(r.connectAdj||0)}</td>
        <td class="num">${money(r.company||0)}</td>
        <td class="num">${money(r.retention||0)}</td>
        <td class="num">${money(r.driverNet||0)}</td>
        <td><button class="btn danger" data-del-one="${r.id}">X</button></td>
      </tr>
    `).join("");

    S._adminSvcRows = rows;
  }

  async function exportServicesCSV(){
    if (S.role !== "admin") return;
    if (!S._adminSvcRows?.length) await renderServicesAdmin();

    const rows = S._adminSvcRows || [];
    if (!rows.length) return toast("No hay datos para exportar.");

    const header = [
      "dateISO","weekISO","driverEmail","clientName","miles","bruto","connectAdj","company","retention","driverNet","note"
    ];

    const lines = [header.join(",")];
    rows.forEach(r=>{
      lines.push(header.map(k=>csvEscape(r[k])).join(","));
    });

    const week = $("sWeek")?.value || "all";
    downloadText(`services_${week}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  async function deleteManyServices(){
    if (S.role !== "admin") return;

    const checks = $$(`[data-pick-svc]`).filter(x=>x.checked);
    if (!checks.length) return toast("No seleccionaste servicios.");

    if (!confirm(`Vas a borrar ${checks.length} servicios. ¿Seguro?`)) return;

    const batch = db.batch();
    checks.forEach(ch=>{
      const id = ch.getAttribute("data-pick-svc");
      if (id) batch.delete(db.collection(C.SERVICES).doc(id));
    });
    await batch.commit();

    toast("Borrados ✅");
    await renderServicesAdmin();
    await renderDashboard();
  }

  async function weeklyData(weekISO, driverUid){
    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (driverUid) q = q.where("driverUid","==",driverUid);
    const snap = await q.get();
    return snap.docs.map(d=>d.data());
  }

  function totals(rows){
    return {
      count: rows.length,
      miles: round2(rows.reduce((a,s)=>a+num(s.miles),0)),
      bruto: round2(rows.reduce((a,s)=>a+num(s.bruto),0)),
      connectAdj: round2(rows.reduce((a,s)=>a+num(s.connectAdj),0)),
      company: round2(rows.reduce((a,s)=>a+num(s.company),0)),
      retention: round2(rows.reduce((a,s)=>a+num(s.retention),0)),
      driverNet: round2(rows.reduce((a,s)=>a+num(s.driverNet),0)),
    };
  }

  async function buildWeekly(exportPdf){
    if (S.role !== "admin") return;
    const weekISO = $("wkStart")?.value || mondayOf(todayISO());
    const driverUid = $("wkDriver")?.value || "";
    const rows = await weeklyData(weekISO, driverUid);
    const t = totals(rows);

    const who = driverUid
      ? (S.users.find(u=>u.uid===driverUid)?.email || driverUid)
      : "TODOS";

    const box = $("weeklyBox");
    if (box){
      box.innerHTML = `
        <h3>${escapeHtml(S.settings.brand)} — Cierre</h3>
        <div class="muted">Semana: <b>${escapeHtml(weekISO)}</b> • Chofer: <b>${escapeHtml(who)}</b></div>
        <div class="hr"></div>
        <div class="row"><span>Servicios</span><b>${t.count}</b></div>
        <div class="row"><span>Millas</span><b>${t.miles.toFixed(1)}</b></div>
        <div class="row"><span>Bruto</span><b>${money(t.bruto)}</b></div>
        <div class="row"><span>Ajuste Connect</span><b>-${money(t.connectAdj)}</b></div>
        <div class="row"><span>Empresa</span><b>${money(t.company)}</b></div>
        <div class="row"><span>Retención</span><b>-${money(t.retention)}</b></div>
        <div class="row"><span><b>Neto chofer</b></span><b>${money(t.driverNet)}</b></div>
        <div class="hr"></div>
        <div class="muted">${escapeHtml(S.settings.footer||"")}</div>
      `;
    }

    if (!exportPdf) return;

    if (!window.jspdf) return toast("jsPDF no cargó.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });
    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`${S.settings.brand} — Cierre Semanal`, 40, 50);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Semana: ${weekISO} | Chofer: ${who}`, 40, 70);
    doc.text(`Servicios: ${t.count}`, 40, 100);
    doc.text(`Millas: ${t.miles.toFixed(1)}`, 40, 114);
    doc.text(`Bruto: ${money(t.bruto)}`, 40, 128);
    doc.text(`Empresa: ${money(t.company)}`, 40, 142);
    doc.text(`Retención: -${money(t.retention)}`, 40, 156);
    doc.text(`Neto chofer: ${money(t.driverNet)}`, 40, 170);
    doc.save(`cierre_${weekISO}.pdf`);
  }

  async function invoiceData(weekISO, clientId){
    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (clientId) q = q.where("clientId","==",clientId);
    const snap = await q.get();
    return snap.docs.map(d=>d.data()).sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function buildInvoice(exportPdf){
    if (S.role !== "admin") return;

    const weekISO = $("invWeek")?.value || mondayOf(todayISO());
    const clientId = $("invClient")?.value || "";
    if (!clientId) return toast("Selecciona cliente.");

    const client = S.clients.find(c=>c.id===clientId);
    const rows = await invoiceData(weekISO, clientId);

    const bruto = round2(rows.reduce((a,s)=>a+num(s.bruto),0));
    const connectAdj = (client?.connect) ? round2(bruto * num(S.settings.connectPct)) : 0;
    const total = round2(bruto - connectAdj);

    const box = $("invoiceBox");
    if (box){
      box.innerHTML = `
        <h3>Factura — ${escapeHtml(S.settings.brand)}</h3>
        <div class="muted">Cliente: <b>${escapeHtml(client?.name||"")}</b> • Semana: <b>${escapeHtml(weekISO)}</b></div>
        <div class="hr"></div>
        <div class="row"><span>Servicios</span><b>${rows.length}</b></div>
        <div class="row"><span>Total Bruto</span><b>${money(bruto)}</b></div>
        ${(client?.connect) ? `<div class="row"><span>Ajuste Connect</span><b>-${money(connectAdj)}</b></div>` : ""}
        <div class="row"><span><b>Total a facturar</b></span><b>${money(total)}</b></div>
        <div class="hr"></div>
        <div class="muted">${escapeHtml(S.settings.footer||"")}</div>
      `;
    }

    if (!exportPdf) return;

    if (!window.jspdf) return toast("jsPDF no cargó.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`Factura — ${S.settings.brand}`, 40, 50);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Cliente: ${client?.name||""} | Semana: ${weekISO}`, 40, 70);

    doc.text(`Servicios: ${rows.length}`, 40, 100);
    doc.text(`Total bruto: ${money(bruto)}`, 40, 114);
    if (client?.connect) doc.text(`Ajuste Connect: -${money(connectAdj)}`, 40, 128);
    doc.setFont("helvetica","bold");
    doc.text(`Total a facturar: ${money(total)}`, 40, 148);
    doc.setFont("helvetica","normal");
    doc.text(`${S.settings.footer||""}`, 40, 170);

    doc.save(`factura_${weekISO}_${(client?.name||"cliente").replaceAll(" ","_")}.pdf`);
  }

  async function saveSettings(){
    if (S.role !== "admin") return;

    const brand = ($("setBrand")?.value || "").trim() || DEFAULT_SETTINGS.brand;
    const connectPct = num($("setConnect")?.value);
    const companyPct = num($("setCompany")?.value);
    const retentionPct = num($("setRetention")?.value);
    const footer = ($("setFooter")?.value || "").trim() || DEFAULT_SETTINGS.footer;

    await db.collection(C.SETTINGS).doc("global").set({
      brand, connectPct, companyPct, retentionPct, footer,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    await loadSettings(true);
    prefillSettingsForm();
    toast("Settings guardados ✅");
    await refreshAll();
  }

  /* =========================
     19) Refresh
  ========================= */
  async function refreshAll(){
    if (!S.user) { setView("login"); return; }

    await loadSettings(true);
    await loadClients(true);
    if (S.role === "admin") await loadUsers(true);

    fillClients("qsClient");
    fillClients("sClient");
    fillClients("invClient");
    fillDrivers("sDriver");
    fillDrivers("wkDriver");

    prefillSettingsForm();

    await renderDashboard();

    if (S.role === "admin"){
      await renderUsers();
      await renderClients();
      await renderServicesAdmin();
    } else {
      await renderDriverHistory();
    }
  }

  async function refreshView(view){
    if (!S.user) { setView("login"); return; }

    if (view === "dashboard") return renderDashboard();
    if (view === "driver") return renderDriverHistory();
    if (view === "adminUsers") return renderUsers();
    if (view === "adminClients") return renderClients();
    if (view === "adminServices") return renderServicesAdmin();
    if (view === "adminClose") return buildWeekly(false);
    if (view === "adminInvoices") return buildInvoice(false);
    if (view === "adminSettings") return prefillSettingsForm();
  }

  // Boot
  setShell(false);
})();
