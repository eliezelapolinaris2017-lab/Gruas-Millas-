/* =========================================================
   Nexus Transport PR — app.js (SALON-LIKE FLOW)
   - Pantallas: Auth(Google) -> PIN -> AppShell
   - Firebase Auth (Google) + Firestore (v8)
   - PIN (hash SHA-256)
   - Roles: admin / driver
   - Delegación global de clicks (tabs + acciones)
   ========================================================= */
(() => {
  "use strict";

  const NTPR_APP_VERSION = "3.0.0-SALON-FLOW";

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

  /* =========================
     2) Pantallas (como Nexus Salon)
  ========================= */
  function showAuthScreen(){
    $("authScreen")?.classList.remove("hidden");
    $("pinScreen")?.classList.add("hidden");
    $("topbar")?.classList.add("hidden");
    $("app")?.classList.add("hidden");
  }
  function showPinScreen(){
    $("authScreen")?.classList.add("hidden");
    $("pinScreen")?.classList.remove("hidden");
    $("topbar")?.classList.add("hidden");
    $("app")?.classList.add("hidden");
  }
  function showAppShell(){
    $("authScreen")?.classList.add("hidden");
    $("pinScreen")?.classList.add("hidden");
    $("topbar")?.classList.remove("hidden");
    $("app")?.classList.remove("hidden");
  }

  /* =========================
     3) Cache
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
     4) Collections
  ========================= */
  const C = {
    USERS: "users",
    INVITES: "invites",
    CLIENTS: "clients",
    SERVICES: "services",
    SETTINGS: "settings" // doc "global"
  };

  /* =========================
     5) Defaults + State
  ========================= */
  const DEFAULT_SETTINGS = {
    brand: "Nexus Transport PR",
    footer: "Resumen generado por Nexus Transport PR",
    connectPct: 0.15,
    companyPct: 0.30,
    retentionPct: 0.10
  };

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

  function setAdminTabsVisible(isAdmin){
    const ids = ["tabAdminUsers","tabAdminClients","tabAdminServices","tabAdminClose","tabAdminInvoices","tabAdminSettings"];
    ids.forEach(id => { const el = $(id); if (el) el.style.display = isAdmin ? "" : "none"; });
  }

  /* =========================
     8) PWA (opcional)
  ========================= */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  }

  /* =========================
     9) Delegación global de clicks
  ========================= */
  document.addEventListener("click", async (e)=>{
    const tab = e.target.closest?.(".tab[data-view]");
    if (tab){
      const v = tab.dataset.view;
      if (!v) return;

      if (!S.user){ return showAuthScreen(); }
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

    // Auth Google
    if (e.target.closest?.("#btnGoogleLogin")){
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      return;
    }

    // PIN
    if (e.target.closest?.("#btnPinConfirm")){
      await onPinConfirm();
      return;
    }
    if (e.target.closest?.("#btnPinSet")){
      await onPinSet();
      return;
    }

    // Dashboard quick
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

    // Driver history
    if (e.target.closest?.("#btnDrvFilter")){
      await renderDriverHistory();
      return;
    }

    // Admin actions (igual que tu lógica original)
    if (e.target.closest?.("#btnSvcFilter")){ await renderServicesAdmin(); return; }
    if (e.target.closest?.("#btnBuildWeekly")){ await buildWeekly(false); return; }
    if (e.target.closest?.("#btnWeeklyPDF")){ await buildWeekly(true); return; }
    if (e.target.closest?.("#btnBuildInvoice")){ await buildInvoice(false); return; }
    if (e.target.closest?.("#btnInvoicePDF")){ await buildInvoice(true); return; }
    if (e.target.closest?.("#btnInviteUser")){ await inviteUser(); return; }
    if (e.target.closest?.("#btnResetPin")){ await resetPin(); return; }
    if (e.target.closest?.("#btnSaveClient")){ await saveClient(); return; }
    if (e.target.closest?.("#btnClearClient")){ prefillClientForm(null); return; }
    if (e.target.closest?.("#btnSaveSettings")){ await saveSettings(); return; }
    if (e.target.closest?.("#btnWipeCache")){
      localStorage.removeItem(CACHE.SETTINGS);
      localStorage.removeItem(CACHE.CLIENTS);
      localStorage.removeItem(CACHE.USERS);
      toast("Cache local limpiado ✅");
      return;
    }

    // borrar en dashboard
    const delDash = e.target.closest?.("[data-del]");
    if (delDash && S.role==="admin"){
      const id = delDash.getAttribute("data-del");
      if (!id) return;
      if (!confirm("Borrar servicio?")) return;
      await db.collection(C.SERVICES).doc(id).delete();
      await refreshAll();
      return;
    }

    // pick user
    const pickUser = e.target.closest?.("[data-pick-user]");
    if (pickUser && S.role==="admin"){
      S.selectedUserUid = pickUser.getAttribute("data-pick-user");
      toast(`Usuario seleccionado: ${S.selectedUserUid}`);
      return;
    }

    // edit client
    const editClientBtn = e.target.closest?.("[data-edit-client]");
    if (editClientBtn && S.role==="admin"){
      const id = editClientBtn.getAttribute("data-edit-client");
      const c = S.clients.find(x=>x.id===id);
      prefillClientForm(c);
      return;
    }

    // del one
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
     10) Load data (igual a tu Transport)
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
     11) Fill selects
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
     12) Settings form
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
     13) Auth flow (Salon-like)
     - Sin user => Auth screen
     - Con user => validación invite + PIN screen
  ========================= */
  auth.onAuthStateChanged(async (user)=>{
    if ($("pinError")) $("pinError").textContent = "";
    if ($("pinSetError")) $("pinSetError").textContent = "";

    if (!user){
      S.user=null; S.profile=null; S.role=null;
      if ($("loginMsg")) $("loginMsg").textContent = "Inicia sesión con Google";
      showAuthScreen();
      return;
    }

    // Google OK
    S.user = user;
    if ($("loginMsg")) $("loginMsg").textContent = "Google OK. Validando acceso...";

    const uref = db.collection(C.USERS).doc(user.uid);
    const usnap = await uref.get();

    if (!usnap.exists){
      const email = (user.email || "").toLowerCase();
      if (!email) { if ($("loginMsg")) $("loginMsg").textContent = "Email no disponible."; return; }

      const inv = await db.collection(C.INVITES).doc(email).get();
      if (!inv.exists){
        if ($("loginMsg")) $("loginMsg").textContent = "No autorizado. Admin debe invitar tu email.";
        // lo dejamos en authScreen
        showAuthScreen();
        return;
      }

      const invData = inv.data() || {};
      if (invData.active === false){
        if ($("loginMsg")) $("loginMsg").textContent = "Invitación inactiva.";
        showAuthScreen();
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

    // ✅ Ahora mostramos PIN screen hasta que confirme/cree PIN
    showPinScreen();

    if (!S.profile.pinHash){
      if ($("loginMsg")) $("loginMsg").textContent = "Crea tu PIN (primera vez) y entra.";
    } else {
      if ($("loginMsg")) $("loginMsg").textContent = "Confirma tu PIN para entrar.";
    }
  });

  /* =========================
     14) PIN actions
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

    showAppShell();
    setView("dashboard");
    await refreshAll();
  }

  /* =========================================================
     ✅ DESDE AQUÍ PEGAS TU MISMO CÓDIGO EXISTENTE (sin cambiar):
     - calc()
     - quickSave()
     - renderDashboard()
     - renderDriverHistory()
     - renderUsers/inviteUser/resetPin
     - renderClients/saveClient
     - renderServicesAdmin
     - buildWeekly
     - buildInvoice
     - saveSettings
     - refreshAll/refreshView
     ========================================================= */

  /* ======= TU CÓDIGO EXISTENTE (PEGA AQUÍ) =======
     Copia tal cual desde tu app.js anterior:
     - Sección 14) Calculation
     - Sección 15) Quick Save
     - Sección 16) Dashboard
     - Sección 17) Driver History
     - Sección 18) Admin...
     - Sección 19) Refresh
  */

  // Boot inicial (sin user => authScreen)
  showAuthScreen();

})();
