/* =========================================================
   Nexus Transport PR — app.js (LITE PRO)
   - 3 archivos y corre: index + styles + app
   - Firebase Auth Google + Firestore (v8)
   - PIN (SHA-256) + roles (admin/driver)
   - Dashboard + Quick Save + Driver History
   ========================================================= */

(() => {
  "use strict";

  const VERSION = "3.0.0-LITE";

  /* =========================
     0) Firebase Config (tu config)
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

  console.log("Nexus Transport", VERSION, firebaseConfig.projectId);

  /* =========================
     1) DOM + helpers
  ========================= */
  const $ = (id)=>document.getElementById(id);
  const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

  const num = (v)=> {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n)=> Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const money = (n)=> round2(n).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const todayISO = ()=> new Date().toISOString().slice(0,10);

  const escapeHtml = (s)=> String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function toast(msg){ alert(msg); }

  function mondayOf(iso){
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    return d.toISOString().slice(0,10);
  }

  function daysAgoISO(n){
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0,10);
  }

  /* =========================
     2) Firestore Collections
  ========================= */
  const C = {
    USERS: "users",
    INVITES: "invites",
    CLIENTS: "clients",
    SERVICES: "services",
    SETTINGS: "settings" // doc global
  };

  const DEFAULT_SETTINGS = {
    brand: "Nexus Transport PR",
    footer: "Resumen generado por Nexus Transport PR",
    connectPct: 0.15,
    companyPct: 0.30,
    retentionPct: 0.10
  };

  /* =========================
     3) State
  ========================= */
  const S = {
    user: null,
    profile: null,
    role: null,
    settings: { ...DEFAULT_SETTINGS },
    clients: [],
    _entered: false
  };

  /* =========================
     4) Crypto PIN
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
     5) UI: views & shell
  ========================= */
  function setView(name){
    $$(".view").forEach(v=>v.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");

    $$(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("active");
  }

  function setTopbarVisible(on){
    const top = $("topbar");
    if (top) top.hidden = !on;
  }

  function setAdminTabsVisible(isAdmin){
    $$(".adminOnly").forEach(el => el.style.display = isAdmin ? "" : "none");
  }

  function fillClients(selectId){
    const el = $(selectId);
    if (!el) return;
    const list = S.clients
      .filter(c => c.active !== false)
      .slice()
      .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
    el.innerHTML = `<option value="">—</option>` + list.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
  }

  /* =========================
     6) Load settings/clients (mínimo)
  ========================= */
  async function ensureGlobalSettings(){
    const ref = db.collection(C.SETTINGS).doc("global");
    const snap = await ref.get();
    if (snap.exists) return;
    await ref.set({ ...DEFAULT_SETTINGS, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
  }

  async function loadSettings(){
    await ensureGlobalSettings();
    const snap = await db.collection(C.SETTINGS).doc("global").get();
    S.settings = { ...DEFAULT_SETTINGS, ...(snap.data()||{}) };
    if ($("brandName")) $("brandName").textContent = S.settings.brand || DEFAULT_SETTINGS.brand;
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

  async function loadClients(){
    await ensureMinimumClients();
    const snap = await db.collection(C.CLIENTS).get();
    S.clients = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    fillClients("qsClient");
  }

  /* =========================
     7) Business calc (misma lógica)
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
     8) Services queries
  ========================= */
  async function queryWeekServices(weekISO){
    if (!S.user) return [];
    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (S.role !== "admin") q = q.where("driverUid","==",S.user.uid);
    const snap = await q.get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function queryMyRange(fromISO, toISO){
    if (!S.user) return [];
    const snap = await db.collection(C.SERVICES)
      .where("driverUid","==",S.user.uid)
      .where("dateISO",">=",fromISO)
      .where("dateISO","<=",toISO)
      .get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  /* =========================
     9) Render: Dashboard + Driver
  ========================= */
  async function renderDashboard(){
    if (!S.user) return;

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
        <td class="num">${round2(s.miles||0).toFixed(1)}</td>
        <td class="num">${money(s.bruto||0)}</td>
        <td class="num">${money(s.driverNet||0)}</td>
        <td class="num">${S.role==="admin" ? `<button class="btn danger" data-del="${s.id}">X</button>` : ""}</td>
      </tr>
    `).join("");
  }

  async function renderDriverHistory(){
    if (!S.user) return;

    const from = $("drvFrom")?.value || daysAgoISO(90);
    const to   = $("drvTo")?.value || todayISO();

    const rows = await queryMyRange(from, to);

    const body = $("drvBody");
    if (body){
      body.innerHTML = rows.map(r=>`
        <tr>
          <td>${escapeHtml(r.dateISO||"")}</td>
          <td>${escapeHtml(r.clientName||"")}</td>
          <td class="num">${round2(r.miles||0).toFixed(1)}</td>
          <td class="num">${money(r.driverNet||0)}</td>
        </tr>
      `).join("");
    }

    const miles = round2(rows.reduce((a,s)=>a+num(s.miles),0));
    const net = round2(rows.reduce((a,s)=>a+num(s.driverNet),0));
    if ($("drvTotals")) $("drvTotals").textContent = `Total: ${rows.length} servicios • ${miles.toFixed(1)} millas • Neto ${money(net)}`;
  }

  /* =========================
     10) Quick Save (chofer)
  ========================= */
  async function quickSave(){
    if (!S.user || !S.profile || !S._entered) return toast("Primero entra con PIN.");

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
    if (!dup.empty) return toast("Duplicado detectado.");

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

    await renderDashboard();
  }

  /* =========================
     11) PIN actions
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
    S._entered = true;
    setTopbarVisible(true);

    setAdminTabsVisible(S.role === "admin");

    await loadSettings();
    await loadClients();

    if ($("qsDate")) $("qsDate").value = todayISO();
    if ($("drvFrom")) $("drvFrom").value = daysAgoISO(90);
    if ($("drvTo")) $("drvTo").value = todayISO();

    // Default view
    setView("dashboard");
    await renderDashboard();
  }

  /* =========================
     12) Auth flow
  ========================= */
  auth.onAuthStateChanged(async (user)=>{
    // reset UI state
    S.user = null; S.profile = null; S.role = null; S._entered = false;
    if ($("pinError")) $("pinError").textContent = "";
    if ($("pinSetError")) $("pinSetError").textContent = "";
    if ($("quickPreview")) $("quickPreview").textContent = "—";

    if (!user){
      setTopbarVisible(false);
      setAdminTabsVisible(false);
      setView("login");
      if ($("loginMsg")) $("loginMsg").textContent = "Inicia sesión con Google";
      if ($("whoLine")) $("whoLine").textContent = "—";
      if ($("rolePill")) $("rolePill").textContent = "—";
      return;
    }

    S.user = user;
    setView("login");
    if ($("loginMsg")) $("loginMsg").textContent = "Google OK. Validando acceso...";

    const uref = db.collection(C.USERS).doc(user.uid);
    const usnap = await uref.get();

    // Create user from invite if missing
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

    // topbar aún no, hasta PIN
    setTopbarVisible(false);
    setAdminTabsVisible(false);

    // setup dates
    if ($("qsDate")) $("qsDate").value = todayISO();
    if ($("drvFrom")) $("drvFrom").value = daysAgoISO(90);
    if ($("drvTo")) $("drvTo").value = todayISO();

    await loadSettings();
    await loadClients();

    if (!S.profile.pinHash){
      if ($("loginMsg")) $("loginMsg").textContent = "Crea tu PIN (primera vez) y entra.";
    } else {
      if ($("loginMsg")) $("loginMsg").textContent = "Confirma tu PIN para entrar.";
    }
  });

  /* =========================
     13) Delegación de eventos (botones siempre responden)
  ========================= */
  document.addEventListener("click", async (e)=>{
    const tab = e.target.closest?.(".tab[data-view]");
    if (tab){
      const v = tab.dataset.view;
      if (!v) return;

      if (!S.user) return setView("login");
      const isAdminView = v.startsWith("admin");
      if (isAdminView && S.role !== "admin") return;

      setView(v);
      if (!S._entered) return; // no entra sin PIN

      if (v === "dashboard") await renderDashboard();
      if (v === "driver") await renderDriverHistory();
      return;
    }

    if (e.target.closest?.("#btnReload")) return location.reload();

    if (e.target.closest?.("#btnLogout")) {
      await auth.signOut();
      return;
    }

    if (e.target.closest?.("#btnGoogleLogin")) {
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      return;
    }

    if (e.target.closest?.("#btnPinConfirm")) {
      await onPinConfirm();
      return;
    }

    if (e.target.closest?.("#btnPinSet")) {
      await onPinSet();
      return;
    }

    if (e.target.closest?.("#btnQuickSave")) {
      await quickSave();
      return;
    }

    if (e.target.closest?.("#btnQuickClear")) {
      if ($("qsMiles")) $("qsMiles").value = "";
      if ($("qsNote")) $("qsNote").value = "";
      if ($("quickPreview")) $("quickPreview").textContent = "—";
      return;
    }

    if (e.target.closest?.("#btnDrvFilter")) {
      if (!S._entered) return toast("Entra con PIN primero.");
      await renderDriverHistory();
      return;
    }

    const delDash = e.target.closest?.("[data-del]");
    if (delDash && S.role === "admin" && S._entered){
      const id = delDash.getAttribute("data-del");
      if (!id) return;
      if (!confirm("Borrar servicio?")) return;
      await db.collection(C.SERVICES).doc(id).delete();
      await renderDashboard();
      return;
    }
  });

  // Boot
  setView("login");
})();
