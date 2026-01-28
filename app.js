/* =========================================================
   Nexus Transport PR — app.js (PRODUCCIÓN) ✅ FULL FIX
   - Firebase Auth (Google) + Firestore
   - PIN (hash SHA-256)
   - Roles: admin / driver
   - Driver: solo escribe + ve su historial
   - Admin: usuarios, clientes, settings, servicios, cierres, facturar + PDFs
   - Cálculo: Connect -15% | Empresa 30% | Retención chofer
   - jsPDF ALWAYS
   - FIX REAL:
     * No queries/render antes de PIN (S.entered)
     * Nunca toca S.user.uid si es null
     * Tabs bloqueados hasta entrar
     * No rompe si faltan elementos en HTML
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     0) Firebase Config (TUYO)
  ========================= */
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

  /* =========================
     1) Helpers
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

  const mondayOf = (iso)=>{
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay(); // 0 Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0,10);
  };

  const escapeHtml = (s)=> String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function toast(msg){ alert(msg); }

  // Guards (NO CRASH)
  const hasAuth = ()=> !!(S.user && S.user.uid);
  const hasProfile = ()=> !!(S.profile && S.role);
  const isEntered = ()=> !!S.entered; // pasó PIN
  const canUseApp = ()=> hasAuth() && hasProfile() && isEntered();

  /* =========================
     2) Cache Keys
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
     3) Firestore Collections
  ========================= */
  const C = {
    USERS: "users",
    INVITES: "invites",
    CLIENTS: "clients",
    SERVICES: "services",
    SETTINGS: "settings"
  };

  /* =========================
     4) Default Settings
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

    entered: false,

    settings: { ...DEFAULT_SETTINGS },
    clients: [],
    users: [],

    selectedUserUid: null,
    selectedClientId: null,
    _adminSvcRows: []
  };

  /* =========================
     6) Crypto (PIN Hash)
     hash = sha256(uid + ":" + pin)
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
     7) UI Navigation / Shell
  ========================= */
  function setView(name){
    $$(".view").forEach(v=>v.classList.remove("active"));
    const target = $(`view-${name}`);
    if (target) target.classList.add("active");

    $$(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("active");
  }

  function setAdminTabsVisible(isAdmin){
    const ids = ["tabAdminUsers","tabAdminClients","tabAdminServices","tabAdminClose","tabAdminInvoices","tabAdminSettings"];
    ids.forEach(id => { const el = $(id); if (el) el.style.display = isAdmin ? "" : "none"; });
  }

  function setNavEnabled(enabled){
    // tabs se bloquean hasta PIN
    $$("#navTabs .tab[data-view]").forEach(btn=>{
      btn.style.pointerEvents = enabled ? "" : "none";
      btn.style.opacity = enabled ? "" : "0.55";
    });
  }

  // Tabs click (seguro)
  $("navTabs")?.addEventListener("click", async (e)=>{
    const btn = e.target?.closest?.(".tab[data-view]");
    if (!btn) return;
    const v = btn.dataset.view;
    if (!v) return;

    // NO permite navegar si no entró
    if (!canUseApp()){
      setView("login");
      return;
    }

    const isAdminView = v.startsWith("admin");
    if (isAdminView && S.role !== "admin") return;

    setView(v);
    await refreshView(v);
  });

  /* =========================
     8) Fill Selects
  ========================= */
  function fillClients(selectId){
    const el = $(selectId);
    if (!el) return;
    const list = S.clients
      .filter(c=>c.active !== false)
      .slice()
      .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
    el.innerHTML = `<option value="">—</option>` + list.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
  }

  function fillDrivers(selectId){
    const el = $(selectId);
    if (!el) return;
    const list = S.users
      .filter(u=>u.role==="driver" && u.active !== false)
      .slice()
      .sort((a,b)=>String(a.email||"").localeCompare(String(b.email||"")));
    el.innerHTML = `<option value="">—</option>` + list.map(u =>
      `<option value="${u.uid}">${escapeHtml(u.email || u.uid)}</option>`
    ).join("");
  }

  /* =========================
     9) Settings / Clients / Users Load
  ========================= */
  async function ensureGlobalSettings(){
    const ref = db.collection(C.SETTINGS).doc("global");
    const snap = await ref.get();
    if (snap.exists) return;
    await ref.set({
      ...DEFAULT_SETTINGS,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }

  async function loadSettings(force=false){
    if (!force) {
      S.settings = { ...DEFAULT_SETTINGS, ...(loadJSON(CACHE.SETTINGS, {})) };
      return;
    }
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
    if (!force) {
      S.clients = loadJSON(CACHE.CLIENTS, []);
      return;
    }
    await ensureMinimumClients();
    const snap = await db.collection(C.CLIENTS).get();
    S.clients = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    saveJSON(CACHE.CLIENTS, S.clients);
  }

  async function loadUsers(force=false){
    if (!force) {
      S.users = loadJSON(CACHE.USERS, []);
      return;
    }
    const snap = await db.collection(C.USERS).get();
    S.users = snap.docs.map(d=>({ uid:d.id, ...d.data() }));
    saveJSON(CACHE.USERS, S.users);
  }

  /* =========================
     10) Auth + Bootstrap
  ========================= */
  $("btnGoogleLogin")?.addEventListener("click", async ()=>{
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  });
  $("btnLogout")?.addEventListener("click", ()=>auth.signOut());
  $("btnReload")?.addEventListener("click", ()=>location.reload());

  auth.onAuthStateChanged(async (user)=>{
    // reset hard
    S.entered = false;
    setNavEnabled(false);

    if ($("pinError")) $("pinError").textContent = "";
    if ($("pinSetError")) $("pinSetError").textContent = "";
    if ($("loginMsg")) $("loginMsg").textContent = "—";

    if (!user){
      S.user=null; S.profile=null; S.role=null;
      setView("login");
      return;
    }

    S.user = user;
    setView("login");
    if ($("loginMsg")) $("loginMsg").textContent = "Google OK. Validando acceso...";

    try{
      const uref = db.collection(C.USERS).doc(user.uid);
      const usnap = await uref.get();

      if (!usnap.exists){
        const email = (user.email || "").toLowerCase();
        if (!email) {
          if ($("loginMsg")) $("loginMsg").textContent = "Email no disponible. Reintenta.";
          return;
        }

        const inv = await db.collection(C.INVITES).doc(email).get();
        if (!inv.exists){
          if ($("loginMsg")) $("loginMsg").textContent = "No autorizado. Admin debe invitar tu email.";
          return;
        }

        const invData = inv.data() || {};
        if (invData.active === false){
          if ($("loginMsg")) $("loginMsg").textContent = "Invitación inactiva.";
          return;
        }

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

      const fresh = await db.collection(C.USERS).doc(user.uid).get();
      S.profile = fresh.data() || {};
      S.role = S.profile.role || "driver";

      if ($("whoLine")) $("whoLine").textContent = `${S.profile.email || user.email || "—"}`;
      if ($("rolePill")) $("rolePill").textContent = (S.role || "—").toUpperCase();

      setAdminTabsVisible(S.role === "admin");

      await loadSettings(true);
      await loadClients(true);
      if (S.role === "admin") await loadUsers(true);

      // Prefill selects/login defaults (safe)
      fillClients("qsClient");
      fillClients("sClient");
      fillClients("invClient");
      fillDrivers("sDriver");
      fillDrivers("wkDriver");

      if ($("qsDate")) $("qsDate").value = todayISO();
      if ($("drvFrom") && !$("drvFrom").value) $("drvFrom").value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
      if ($("drvTo") && !$("drvTo").value) $("drvTo").value = todayISO();
      if ($("sWeek")) $("sWeek").value = mondayOf(todayISO());
      if ($("wkStart")) $("wkStart").value = mondayOf(todayISO());
      if ($("invWeek")) $("invWeek").value = mondayOf(todayISO());

      prefillSettingsForm();

      if (!S.profile.pinHash){
        if ($("loginMsg")) $("loginMsg").textContent = "Crea tu PIN (primera vez) y entra.";
      } else {
        if ($("loginMsg")) $("loginMsg").textContent = "Confirma tu PIN para entrar.";
      }
    } catch (err){
      console.error(err);
      if ($("loginMsg")) $("loginMsg").textContent = `Error validando acceso: ${err?.message || err}`;
      setNavEnabled(false);
      S.entered = false;
    }
  });

  /* =========================
     11) PIN actions
  ========================= */
  $("btnPinConfirm")?.addEventListener("click", async ()=>{
    if ($("pinError")) $("pinError").textContent = "";
    if (!hasAuth() || !hasProfile()) return;

    const pin = ($("pinInput")?.value || "").trim();
    if (!pin) { if ($("pinError")) $("pinError").textContent = "PIN requerido."; return; }

    const actual = await pinHash(S.user.uid, pin);
    if (actual !== (S.profile.pinHash || "")) {
      if ($("pinError")) $("pinError").textContent = "PIN incorrecto.";
      return;
    }

    await afterEnter();
  });

  $("btnPinSet")?.addEventListener("click", async ()=>{
    if ($("pinSetError")) $("pinSetError").textContent = "";
    if (!hasAuth()) return;

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
    S.profile = fresh.data() || {};
    S.role = S.profile.role || "driver";

    toast("PIN guardado ✅");
    await afterEnter();
  });

  async function afterEnter(){
    S.entered = true;
    setNavEnabled(true);

    await loadSettings(true);
    await loadClients(true);
    if (S.role === "admin") await loadUsers(true);

    fillClients("qsClient");
    fillClients("sClient");
    fillClients("invClient");
    fillDrivers("sDriver");
    fillDrivers("wkDriver");

    prefillSettingsForm();

    setView("dashboard");
    await refreshAll();
  }

  /* =========================
     12) Engine de cálculo
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
     13) Quick Save (Driver write)
  ========================= */
  $("btnQuickSave")?.addEventListener("click", async ()=>{
    if (!canUseApp()) { setView("login"); return; }

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
      dayKey,
      dateISO,
      weekISO,

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
  });

  $("btnQuickClear")?.addEventListener("click", ()=>{
    if ($("qsMiles")) $("qsMiles").value = "";
    if ($("qsNote")) $("qsNote").value = "";
    if ($("quickPreview")) $("quickPreview").textContent = "—";
  });

  ["qsClient","qsMiles"].forEach(id=>{
    $(id)?.addEventListener("input", ()=>{
      const cid = $("qsClient")?.value || "";
      const miles = num($("qsMiles")?.value);
      const client = S.clients.find(c=>c.id===cid);
      if (!client || miles<=0){ if ($("quickPreview")) $("quickPreview").textContent = "—"; return; }
      const r = calc(miles, client);
      if ($("quickPreview")) $("quickPreview").textContent =
        `Bruto ${money(r.bruto)} | Adj Connect ${money(r.connectAdj)} | Neto chofer ${money(r.driverNet)} | Empresa ${money(r.company)}`;
    });
  });

  /* =========================
     14) Dashboard render (role-aware)
  ========================= */
  async function queryWeekServices(weekISO){
    if (!canUseApp()) return [];
    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (S.role !== "admin") q = q.where("driverUid","==",S.user.uid);
    const snap = await q.get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function renderDashboard(){
    if (!canUseApp()) return;

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

    if (S.role==="admin"){
      tb.querySelectorAll("[data-del]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const id = btn.getAttribute("data-del");
          if (!confirm("Borrar servicio?")) return;
          await db.collection(C.SERVICES).doc(id).delete();
          await refreshAll();
        });
      });
    }
  }

  /* =========================
     15) Driver history + PDF
  ========================= */
  async function queryMyRange(fromISO, toISO){
    if (!canUseApp()) return [];
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
    if (!canUseApp()) return [];

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

  $("btnDrvFilter")?.addEventListener("click", ()=>renderDriverHistory());

  $("btnDrvPDF")?.addEventListener("click", async ()=>{
    if (!canUseApp()) return;
    const rows = await renderDriverHistory();
    const from = $("drvFrom")?.value || "—";
    const to   = $("drvTo")?.value || "—";

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });
    const mx = 40;
    let y = 50;

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(S.settings.brand, mx, y); y+=18;

    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Historial chofer: ${(S.profile.email||S.user.email||"")}`, mx, y); y+=14;
    doc.text(`Rango: ${from} → ${to}`, mx, y); y+=18;

    doc.setFont("helvetica","bold"); doc.text("Detalle", mx, y); y+=14;
    doc.setFont("helvetica","normal");

    const line = (t)=>{
      doc.text(t, mx, y);
      y+=12;
      if (y>740){ doc.addPage(); y=50; }
    };

    rows.slice().reverse().forEach(r=>{
      line(`${r.dateISO} | ${r.clientName} | ${round2(r.miles).toFixed(1)} mi | Neto: ${money(r.driverNet)}`);
    });

    y+=10;
    doc.setFontSize(9);
    doc.text(S.settings.footer || "", mx, y);

    doc.save(`historial_${(S.profile.email||"chofer").replaceAll("@","_")}.pdf`);
  });

  /* =========================
     16) Admin: Users (invites + reset PIN)
  ========================= */
  async function renderUsers(){
    if (!canUseApp() || S.role !== "admin") return;

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

    tb.querySelectorAll("[data-pick-user]").forEach(b=>{
      b.addEventListener("click", ()=>{
        S.selectedUserUid = b.getAttribute("data-pick-user");
        toast(`Usuario seleccionado: ${S.selectedUserUid}`);
      });
    });

    fillDrivers("sDriver");
    fillDrivers("wkDriver");
  }

  $("btnInviteUser")?.addEventListener("click", async ()=>{
    if (!canUseApp() || S.role !== "admin") return;

    const email = ($("uEmail")?.value || "").trim().toLowerCase();
    const role = $("uRole")?.value || "driver";
    const active = ($("uActive")?.value || "true") === "true";
    const note = ($("uNote")?.value || "").trim();

    if (!email || !email.includes("@")) return toast("Email inválido.");

    await db.collection(C.INVITES).doc(email).set({
      email, role, active, note,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    toast("Invitación guardada ✅");
    if ($("uEmail")) $("uEmail").value = "";
    if ($("uNote")) $("uNote").value = "";
  });

  $("btnResetPin")?.addEventListener("click", async ()=>{
    if (!canUseApp() || S.role !== "admin") return;
    if (!S.selectedUserUid) return toast("Selecciona un usuario primero.");

    if (!confirm("Reset PIN: el usuario tendrá que crear PIN nuevo al entrar. ¿Seguro?")) return;

    await db.collection(C.USERS).doc(S.selectedUserUid).set({
      pinHash: "",
      pinResetAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    toast("PIN reseteado ✅");
    await renderUsers();
  });

  /* =========================
     17) Admin: Clients CRUD
  ========================= */
  function prefillClientForm(c){
    if ($("cName")) $("cName").value = c?.name || "";
    if ($("cRate")) $("cRate").value = c?.rate ?? "";
    if ($("cConnect")) $("cConnect").value = c?.connect ? "yes":"no";
    if ($("cActive")) $("cActive").value = (c?.active !== false) ? "true":"false";
    S.selectedClientId = c?.id || null;
  }

  async function renderClients(){
    if (!canUseApp() || S.role !== "admin") return;

    await loadClients(true);
    saveJSON(CACHE.CLIENTS, S.clients);

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

    tb.querySelectorAll("[data-edit-client]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const id = b.getAttribute("data-edit-client");
        const c = S.clients.find(x=>x.id===id);
        prefillClientForm(c);
      });
    });
  }

  $("btnSaveClient")?.addEventListener("click", async ()=>{
    if (!canUseApp() || S.role !== "admin") return;

    const name = ($("cName")?.value || "").trim();
    const rate = round2(num($("cRate")?.value));
    const connect = ($("cConnect")?.value || "no") === "yes";
    const active = ($("cActive")?.value || "true") === "true";

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
  });

  $("btnClearClient")?.addEventListener("click", ()=>prefillClientForm(null));

  /* =========================
     18) Admin: Services Table + CSV + Delete many
  ========================= */
  async function queryServicesAdmin(){
    if (!canUseApp() || S.role !== "admin") return [];

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
    if (!canUseApp() || S.role !== "admin") return;

    const rows = await queryServicesAdmin();
    S._adminSvcRows = rows;

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

    tb.querySelectorAll("[data-del-one]").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const id = b.getAttribute("data-del-one");
        if (!confirm("Borrar servicio?")) return;
        await db.collection(C.SERVICES).doc(id).delete();
        await renderServicesAdmin();
      });
    });
  }

  $("btnSvcFilter")?.addEventListener("click", ()=>renderServicesAdmin());

  $("btnSvcCSV")?.addEventListener("click", ()=>{
    if (!canUseApp() || S.role !== "admin") return;

    const rows = S._adminSvcRows || [];
    const header = ["dateISO","driverEmail","clientName","miles","bruto","connectAdj","company","retention","driverNet","note"];
    const out = [header.join(",")].concat(rows.map(r=> header.map(k=>{
      const v = (r[k] ?? "");
      return String(v).replaceAll(","," ");
    }).join(",")));

    const blob = new Blob([out.join("\n")], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "services_export.csv";
    a.click();
  });

  $("btnSvcDeleteMany")?.addEventListener("click", async ()=>{
    if (!canUseApp() || S.role !== "admin") return;

    const ids = Array.from(document.querySelectorAll("[data-pick-svc]"))
      .filter(x=>x.checked)
      .map(x=>x.getAttribute("data-pick-svc"));

    if (!ids.length) return toast("No hay selección.");
    if (!confirm(`Borrar ${ids.length} servicios?`)) return;

    const batch = db.batch();
    ids.forEach(id=> batch.delete(db.collection(C.SERVICES).doc(id)));
    await batch.commit();

    toast("Borrados ✅");
    await renderServicesAdmin();
  });

  /* =========================
     19) Admin: Weekly Close + PDF
  ========================= */
  async function weeklyData(weekISO, driverUid){
    if (!canUseApp() || S.role !== "admin") return [];

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
      netSplit: round2(rows.reduce((a,s)=>a+num(s.netSplit),0)),
      company: round2(rows.reduce((a,s)=>a+num(s.company),0)),
      retention: round2(rows.reduce((a,s)=>a+num(s.retention),0)),
      driverNet: round2(rows.reduce((a,s)=>a+num(s.driverNet),0)),
    };
  }

  async function buildWeekly(exportPdf){
    if (!canUseApp() || S.role !== "admin") return;

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

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });
    const mx = 40;
    let y = 50;

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`${S.settings.brand} — Cierre Semanal`, mx, y); y+=18;
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Semana: ${weekISO}  |  Chofer: ${who}`, mx, y); y+=16;

    doc.setFont("helvetica","bold"); doc.text("Totales", mx, y); y+=14;
    doc.setFont("helvetica","normal");
    const line=(t)=>{ doc.text(t, mx, y); y+=12; if(y>740){ doc.addPage(); y=50; } };

    line(`Servicios: ${t.count}`);
    line(`Millas: ${t.miles.toFixed(1)}`);
    line(`Bruto: ${money(t.bruto)}`);
    line(`Ajuste Connect: -${money(t.connectAdj)}`);
    line(`Empresa: ${money(t.company)}`);
    line(`Retención: -${money(t.retention)}`);
    line(`Neto chofer: ${money(t.driverNet)}`);

    y+=10;
    doc.setFontSize(9);
    doc.text(S.settings.footer || "", mx, y);

    doc.save(`cierre_${weekISO}.pdf`);
  }

  $("btnBuildWeekly")?.addEventListener("click", ()=>buildWeekly(false));
  $("btnWeeklyPDF")?.addEventListener("click", ()=>buildWeekly(true));

  /* =========================
     20) Admin: Invoice by client + PDF
  ========================= */
  async function invoiceData(weekISO, clientId){
    if (!canUseApp() || S.role !== "admin") return [];

    let q = db.collection(C.SERVICES).where("weekISO","==",weekISO);
    if (clientId) q = q.where("clientId","==",clientId);
    const snap = await q.get();
    return snap.docs.map(d=>d.data()).sort((a,b)=> (a.dateISO < b.dateISO ? 1 : -1));
  }

  async function buildInvoice(exportPdf){
    if (!canUseApp() || S.role !== "admin") return;

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
        ${rows.slice(0,140).map(r=>`
          <div class="row">
            <span>${escapeHtml(r.dateISO)} • ${escapeHtml(r.driverEmail)} • ${round2(r.miles).toFixed(1)} mi</span>
            <b>${money(r.bruto)}</b>
          </div>
        `).join("")}
        ${rows.length>140 ? `<div class="muted" style="margin-top:8px">*Vista previa recortada. PDF incluye todo.</div>` : ""}
        <div class="hr"></div>
        <div class="row"><span>Total Bruto</span><b>${money(bruto)}</b></div>
        ${(client?.connect) ? `<div class="row"><span>Ajuste Connect</span><b>-${money(connectAdj)}</b></div>` : ""}
        <div class="row"><span><b>Total a facturar</b></span><b>${money(total)}</b></div>
        <div class="hr"></div>
        <div class="muted">${escapeHtml(S.settings.footer||"")}</div>
      `;
    }

    if (!exportPdf) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:"pt", format:"letter" });
    const mx = 40;
    let y = 50;

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text(`Factura — ${S.settings.brand}`, mx, y); y+=18;
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(`Cliente: ${client?.name||""} | Semana: ${weekISO}`, mx, y); y+=16;

    const line=(t)=>{ doc.text(t, mx, y); y+=12; if(y>740){ doc.addPage(); y=50; } };

    rows.slice().reverse().forEach(r=>{
      line(`${r.dateISO} | ${r.driverEmail} | ${round2(r.miles).toFixed(1)} mi | ${money(r.bruto)}`);
    });

    y+=12;
    line(`Total Bruto: ${money(bruto)}`);
    if (client?.connect) line(`Ajuste Connect: -${money(connectAdj)}`);
    line(`Total a facturar: ${money(total)}`);

    y+=10;
    doc.setFontSize(9);
    doc.text(S.settings.footer || "", mx, y);

    doc.save(`factura_${weekISO}_${(client?.name||"cliente").replaceAll(" ","_")}.pdf`);
  }

  $("btnBuildInvoice")?.addEventListener("click", ()=>buildInvoice(false));
  $("btnInvoicePDF")?.addEventListener("click", ()=>buildInvoice(true));

  /* =========================
     21) Settings save
  ========================= */
  function prefillSettingsForm(){
    if ($("brandName")) $("brandName").textContent = S.settings.brand || DEFAULT_SETTINGS.brand;
    if ($("setBrand")) $("setBrand").value = S.settings.brand ?? DEFAULT_SETTINGS.brand;
    if ($("setConnect")) $("setConnect").value = S.settings.connectPct ?? DEFAULT_SETTINGS.connectPct;
    if ($("setCompany")) $("setCompany").value = S.settings.companyPct ?? DEFAULT_SETTINGS.companyPct;
    if ($("setRetention")) $("setRetention").value = S.settings.retentionPct ?? DEFAULT_SETTINGS.retentionPct;
    if ($("setFooter")) $("setFooter").value = S.settings.footer ?? DEFAULT_SETTINGS.footer;
  }

  $("btnSaveSettings")?.addEventListener("click", async ()=>{
    if (!canUseApp() || S.role !== "admin") return;

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
  });

  $("btnWipeCache")?.addEventListener("click", ()=>{
    localStorage.removeItem(CACHE.SETTINGS);
    localStorage.removeItem(CACHE.CLIENTS);
    localStorage.removeItem(CACHE.USERS);
    toast("Cache local limpiado ✅");
  });

  /* =========================
     22) Refresh orchestration
  ========================= */
  async function refreshAll(){
    if (!canUseApp()) return;

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
    if (!canUseApp()) return;

    if (view === "dashboard") return renderDashboard();
    if (view === "driver") return renderDriverHistory();
    if (view === "adminUsers") return renderUsers();
    if (view === "adminClients") return renderClients();
    if (view === "adminServices") return renderServicesAdmin();
    return;
  }

})();
