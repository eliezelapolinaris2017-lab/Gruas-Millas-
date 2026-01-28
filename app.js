/* =========================================================
   Nexus Transport PR — app.js (FINAL CONSOLIDADO)
   - Firebase Auth (Google)
   - PIN por usuario (hash por email)
   - Roles: admin / driver
   - Chofer: solo escribe millas, ve su historial
   - Admin: settings, choferes, clientes, cierre semanal, PDF
   - Cálculo: Connect -15% (si aplica), Empresa 30%, Retención 10%
   - Persistencia: Firestore + cache local (no se pierde al refresh)
   ========================================================= */

(() => {
  "use strict";

  /* =========================
     FIREBASE CONFIG
  ========================= */
  const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_PROJECT.firebaseapp.com",
    projectId: "TU_PROJECT_ID",
  };
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  /* =========================
     KEYS (cache)
  ========================= */
  const CACHE = {
    SETTINGS: "ntpr.settings.cache.v1",
    CLIENTS:  "ntpr.clients.cache.v1",
    ME:       "ntpr.me.cache.v1",
  };

  /* =========================
     HELPERS
  ========================= */
  const $ = (id) => document.getElementById(id);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const money = (n) => round2(n).toLocaleString("en-US", { style:"currency", currency:"USD" });
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // Monday for ISO date
  const mondayOf = (iso) => {
    const d = new Date(iso + "T00:00:00");
    const day = d.getDay() || 7; // 1..7 (Mon..Sun)
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0,10);
  };

  const loadJSON = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const emailKey = (email) => String(email || "").trim().toLowerCase();

  async function sha256Hex(text){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  async function pinHashForEmail(email, pin){
    // Hash por email (no por uid) para poder provisionar chofer antes de que entre
    return sha256Hex(`${emailKey(email)}:${String(pin||"")}`);
  }

  function setView(name){
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.add("active");

    document.querySelectorAll(".tab[data-view]").forEach(t => t.classList.remove("active"));
    const tab = document.querySelector(`.tab[data-view="${name}"]`);
    if (tab) tab.classList.add("active");
  }

  /* =========================
     DEFAULT SETTINGS
  ========================= */
  const DEFAULT_SETTINGS = {
    companyName: "Nexus Transport PR",
    connectPct: 0.15,
    companyPct: 0.30,
    retentionPct: 0.10,
    footer: "Resumen generado por Nexus Transport PR"
  };

  let settings = { ...DEFAULT_SETTINGS, ...(loadJSON(CACHE.SETTINGS, {})) };
  let clientsCache = loadJSON(CACHE.CLIENTS, []);
  let meCache = loadJSON(CACHE.ME, null);

  /* =========================
     RUNTIME STATE
  ========================= */
  let user = null;
  let profile = null; // from Firestore users/{emailLower}

  /* =========================
     UI WIRES
  ========================= */
  // Tabs
  document.querySelectorAll(".tab[data-view]").forEach(t => {
    t.addEventListener("click", () => setView(t.dataset.view));
  });

  $("btnLogout")?.addEventListener("click", async () => {
    await auth.signOut();
    location.reload();
  });

  $("btnGoogleLogin")?.addEventListener("click", async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  });

  /* =========================
     AUTH FLOW
  ========================= */
  auth.onAuthStateChanged(async (u) => {
    user = u || null;

    if (!user){
      $("topbar").style.display = "none";
      $("view-login").style.display = "block";
      $("loginMsg").textContent = "Acceso con Google";
      return;
    }

    // Show login view awaiting PIN
    $("topbar").style.display = "none";
    $("view-login").style.display = "block";
    $("loginMsg").textContent = `Google OK: ${user.email}. Ahora PIN.`;

    // Prefill cache line
    meCache = { email: user.email, name: user.displayName || user.email };
    saveJSON(CACHE.ME, meCache);

    // Load profile from users/{emailLower}
    const key = emailKey(user.email);
    const doc = await db.collection("users").doc(key).get();

    if (!doc.exists){
      $("loginMsg").textContent = "Este email no está registrado. Pídele al admin que te agregue.";
      return;
    }

    profile = doc.data();

    if (profile.active === false){
      $("loginMsg").textContent = "Usuario desactivado. Contacta admin.";
      return;
    }

    $("loginMsg").textContent = "PIN requerido.";
  });

  $("btnPinConfirm")?.addEventListener("click", async () => {
    if (!user || !profile) return;

    const pin = $("pinInput").value || "";
    const h = await pinHashForEmail(user.email, pin);

    if (!profile.pinHash || h !== profile.pinHash){
      alert("PIN incorrecto");
      return;
    }

    // Logged in
    $("view-login").style.display = "none";
    $("topbar").style.display = "flex";

    // Header
    $("brandName").textContent = settings.companyName || DEFAULT_SETTINGS.companyName;
    $("userLine").textContent = `${user.displayName || "Usuario"} (${user.email})`;
    $("roleLine").textContent = (profile.role || "driver").toUpperCase();

    // Role tabs
    if (profile.role === "admin"){
      $("tabAdmin").style.display = "";
      $("tabDriver").style.display = "";
    } else {
      $("tabAdmin").style.display = "none";
      $("tabDriver").style.display = "";
    }

    // Ensure base data
    await ensureSettings();
    await ensureMinimumClients();

    // Bind admin forms if admin
    if (profile.role === "admin"){
      bindSettingsForm();
      bindDriverAdminForm();
      bindClientForm();
      bindWeeklyButtons();
      await refreshAdminTables();
    } else {
      bindDriverServiceForm();
      bindDriverHistory();
    }

    // Load dashboard
    setView("dashboard");
    await refreshDashboard();
  });

  /* =========================
     SETTINGS (Firestore + cache)
  ========================= */
  async function ensureSettings(){
    const ref = db.collection("settings").doc("global");
    const snap = await ref.get();
    if (!snap.exists){
      await ref.set({ ...DEFAULT_SETTINGS, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      settings = { ...DEFAULT_SETTINGS };
    } else {
      settings = { ...DEFAULT_SETTINGS, ...snap.data() };
    }
    saveJSON(CACHE.SETTINGS, settings);
    $("brandName").textContent = settings.companyName || DEFAULT_SETTINGS.companyName;
  }

  function bindSettingsForm(){
    const form = $("settingsForm");
    if (!form) return;

    $("setCompanyName").value = settings.companyName;
    $("setConnectPct").value = settings.connectPct;
    $("setCompanyPct").value = settings.companyPct;
    $("setRetentionPct").value = settings.retentionPct;
    $("setFooter").value = settings.footer;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newSet = {
        companyName: ($("setCompanyName").value || "").trim() || DEFAULT_SETTINGS.companyName,
        connectPct: num($("setConnectPct").value),
        companyPct: num($("setCompanyPct").value),
        retentionPct: num($("setRetentionPct").value),
        footer: ($("setFooter").value || "").trim() || DEFAULT_SETTINGS.footer,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (newSet.companyPct < 0 || newSet.companyPct > 1) return alert("Empresa % debe ser 0..1 (ej 0.30).");
      if (newSet.connectPct < 0 || newSet.connectPct > 1) return alert("Connect % debe ser 0..1 (ej 0.15).");
      if (newSet.retentionPct < 0 || newSet.retentionPct > 1) return alert("Retención % debe ser 0..1 (ej 0.10).");

      await db.collection("settings").doc("global").set(newSet, { merge:true });
      settings = { ...settings, ...newSet };
      saveJSON(CACHE.SETTINGS, settings);
      $("brandName").textContent = settings.companyName;

      alert("Configuración guardada ✅");
      await refreshDashboard();
    });
  }

  /* =========================
     CLIENTS
  ========================= */
  async function ensureMinimumClients(){
    const snap = await db.collection("clients").limit(1).get();
    if (!snap.empty) {
      await refreshClientsCache();
      return;
    }
    // Seed defaults
    const batch = db.batch();
    const defaults = [
      { nombre:"Connect", tarifaMilla: 1.00, aplicaConnect:true, activo:true },
      { nombre:"Dealer",  tarifaMilla: 1.00, aplicaConnect:false, activo:true },
      { nombre:"Privado", tarifaMilla: 1.00, aplicaConnect:false, activo:true },
      { nombre:"AAA",     tarifaMilla: 1.00, aplicaConnect:false, activo:true },
    ];
    defaults.forEach(d=>{
      const ref = db.collection("clients").doc();
      batch.set(ref, { ...d, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
    await refreshClientsCache();
  }

  async function refreshClientsCache(){
    const snap = await db.collection("clients").get();
    clientsCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    saveJSON(CACHE.CLIENTS, clientsCache);

    // Fill driver select if exists
    const sel = $("drvClient");
    if (sel){
      const activeClients = clientsCache.filter(c => c.activo !== false);
      sel.innerHTML = `<option value="">—</option>` + activeClients
        .map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
    }
  }

  function bindClientForm(){
    const form = $("clientForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const nombre = ($("admClientName").value || "").trim();
      const tarifa = round2(num($("admClientRate").value));
      const aplicaConnect = $("admClientConnect").value === "true";
      const activo = $("admClientActive").value === "true";

      if (!nombre) return alert("Nombre requerido.");
      if (tarifa <= 0) return alert("Tarifa por milla debe ser > 0.");

      // Upsert by name (case-insensitive) to avoid duplicates
      const existing = clientsCache.find(c => String(c.nombre||"").trim().toLowerCase() === nombre.toLowerCase());

      if (existing){
        await db.collection("clients").doc(existing.id).set({
          nombre, tarifaMilla: tarifa, aplicaConnect, activo,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge:true });
      } else {
        await db.collection("clients").add({
          nombre, tarifaMilla: tarifa, aplicaConnect, activo,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      $("admClientName").value = "";
      $("admClientRate").value = "";
      $("admClientConnect").value = "false";
      $("admClientActive").value = "true";

      await refreshClientsCache();
      await refreshAdminTables();
      alert("Cliente guardado ✅");
    });
  }

  async function renderAdminClients(){
    const tb = $("adminClientsBody");
    if (!tb) return;

    // Always refresh from cache (already loaded)
    const list = clientsCache.slice().sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""));
    tb.innerHTML = list.map(c => `
      <tr>
        <td>${c.nombre || "—"}</td>
        <td class="num">${money(c.tarifaMilla)}</td>
        <td>${c.aplicaConnect ? "Sí" : "No"}</td>
        <td>${c.activo === false ? "No" : "Sí"}</td>
      </tr>
    `).join("");
  }

  /* =========================
     USERS (Admin)
     Collection: users/{emailLower}
     { role: "admin"|"driver", displayName, email, pinHash, active }
  ========================= */
  function bindDriverAdminForm(){
    const form = $("driverAdminForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = emailKey($("admDrvEmail").value);
      const displayName = ($("admDrvName").value || "").trim();
      const pin = $("admDrvPin").value || "";
      const active = $("admDrvActive").value === "true";

      if (!email) return alert("Email requerido.");
      if (!displayName) return alert("Nombre requerido.");
      if (!pin) return alert("PIN requerido.");

      const h = await pinHashForEmail(email, pin);

      await db.collection("users").doc(email).set({
        role: "driver",
        email,
        displayName,
        pinHash: h,
        active,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });

      $("admDrvEmail").value = "";
      $("admDrvName").value = "";
      $("admDrvPin").value = "";
      $("admDrvActive").value = "true";

      await renderAdminDrivers();
      alert("Chofer guardado ✅");
    });
  }

  async function renderAdminDrivers(){
    const tb = $("adminDriversBody");
    if (!tb) return;

    const snap = await db.collection("users").where("role","==","driver").get();
    const list = snap.docs.map(d => d.data()).sort((a,b)=> (a.displayName||"").localeCompare(b.displayName||""));

    tb.innerHTML = list.map(u => `
      <tr>
        <td>${u.displayName || "—"}</td>
        <td>${u.email || "—"}</td>
        <td>${u.active === false ? "No" : "Sí"}</td>
      </tr>
    `).join("");
  }

  async function refreshAdminTables(){
    await refreshClientsCache();
    await renderAdminClients();
    await renderAdminDrivers();
  }

  /* =========================
     CALCULATIONS (central)
  ========================= */
  function calcService(miles, client){
    const bruto = round2(miles * num(client.tarifaMilla));
    const connectAdj = client.aplicaConnect ? round2(bruto * num(settings.connectPct)) : 0;
    const netToSplit = round2(bruto - connectAdj);

    const companyShare = round2(netToSplit * num(settings.companyPct));
    const driverGross = round2(netToSplit - companyShare);
    const retention = round2(driverGross * num(settings.retentionPct));
    const driverNet = round2(driverGross - retention);

    return { bruto, connectAdj, netToSplit, companyShare, driverGross, retention, driverNet };
  }

  /* =========================
     DRIVER SERVICE ENTRY
  ========================= */
  function bindDriverServiceForm(){
    const form = $("driverServiceForm");
    if (!form) return;

    if ($("drvDate")) $("drvDate").value = todayISO();
    refreshClientsCache();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const dateISO = $("drvDate").value || todayISO();
      const clientId = $("drvClient").value;
      const miles = round2(num($("drvMiles").value));
      const note = ($("drvNote").value || "").trim();

      if (!clientId) return alert("Selecciona cliente.");
      if (miles <= 0) return alert("Millas deben ser > 0.");

      const client = clientsCache.find(c => c.id === clientId);
      if (!client || client.activo === false) return alert("Cliente inválido/inactivo.");

      const cal = calcService(miles, client);

      // Anti-duplicados por chofer+fecha+cliente+millas
      const dayKey = `${emailKey(user.email)}|${dateISO}|${clientId}|${miles}`;
      const dup = await db.collection("services")
        .where("dayKey","==",dayKey)
        .limit(1).get();
      if (!dup.empty) return alert("Servicio duplicado (mismo día/cliente/millas).");

      await db.collection("services").add({
        driverEmail: emailKey(user.email),
        driverName: profile.displayName || (user.displayName || user.email),
        clientId,
        clientNombre: client.nombre,
        fechaISO: dateISO,
        weekStartISO: mondayOf(dateISO),

        millas: miles,
        tarifaMilla: round2(num(client.tarifaMilla)),
        aplicaConnect: !!client.aplicaConnect,

        montoBruto: cal.bruto,
        connectAdjust: cal.connectAdj,
        netToSplit: cal.netToSplit,
        companyShare: cal.companyShare,
        driverGross: cal.driverGross,
        retention: cal.retention,
        driverNet: cal.driverNet,

        nota: note,
        dayKey,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Reset fields
      $("drvMiles").value = "";
      $("drvNote").value = "";

      await refreshDriverHistory();
      await refreshDashboard();
      alert("Servicio guardado ✅");
    });
  }

  function bindDriverHistory(){
    $("btnDrvFilter")?.addEventListener("click", refreshDriverHistory);

    // Defaults range: current month
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth()+1, 0);
    $("drvFromDate").value = from.toISOString().slice(0,10);
    $("drvToDate").value = to.toISOString().slice(0,10);

    refreshDriverHistory();
  }

  async function refreshDriverHistory(){
    const from = $("drvFromDate").value || "1900-01-01";
    const to = $("drvToDate").value || todayISO();

    const q = db.collection("services")
      .where("driverEmail","==",emailKey(user.email))
      .where("fechaISO",">=",from)
      .where("fechaISO","<=",to);

    const snap = await q.get();
    const rows = snap.docs.map(d => d.data()).sort((a,b)=> (a.fechaISO < b.fechaISO ? 1 : -1));

    const tb = $("driverHistoryBody");
    if (!tb) return;

    tb.innerHTML = rows.map(s => `
      <tr>
        <td>${s.fechaISO}</td>
        <td>${s.clientNombre}</td>
        <td class="num">${round2(s.millas)}</td>
        <td class="num">${money(s.driverNet)}</td>
      </tr>
    `).join("");
  }

  /* =========================
     DASHBOARD
  ========================= */
  async function refreshDashboard(){
    await ensureSettings();
    await refreshClientsCache();

    const wk = mondayOf(todayISO());
    $("kpiWeekRange").textContent = `Semana desde ${wk}`;

    let q = db.collection("services").where("weekStartISO","==",wk);

    // role filter
    if (profile.role !== "admin"){
      q = q.where("driverEmail","==",emailKey(user.email));
    }

    const snap = await q.get();
    const list = snap.docs.map(d=>({ id:d.id, ...d.data() }))
      .sort((a,b)=> (a.fechaISO < b.fechaISO ? 1 : -1));

    const miles = round2(list.reduce((a,s)=>a+num(s.millas),0));
    const net = round2(list.reduce((a,s)=>a+num(s.driverNet),0));
    const servicesCount = list.length;

    $("kpiWeekMiles").textContent = miles.toFixed(1);
    $("kpiWeekServices").textContent = String(servicesCount);
    $("kpiWeekNet").textContent = money(net);
    const revPerMile = miles ? round2(net / miles) : 0;
    $("kpiRevPerMile").textContent = money(revPerMile);

    // Recent table
    const tb = $("dashRecentBody");
    if (!tb) return;

    const last = list.slice(0,20);
    tb.innerHTML = last.map(s => `
      <tr>
        <td>${s.fechaISO}</td>
        <td>${s.driverName || "—"}</td>
        <td>${s.clientNombre}</td>
        <td class="num">${round2(s.millas)}</td>
        <td class="num">${money(s.montoBruto)}</td>
        <td class="num">${money(s.connectAdjust)}</td>
        <td class="num">${money(s.driverNet)}</td>
        <td>${profile.role === "admin" ? `<button class="btn danger" data-del="${s.id}">X</button>` : ""}</td>
      </tr>
    `).join("");

    // Admin can delete rows (optional but useful)
    if (profile.role === "admin"){
      tb.querySelectorAll("[data-del]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const id = btn.getAttribute("data-del");
          if (!confirm("Borrar servicio?")) return;
          await db.collection("services").doc(id).delete();
          await refreshDashboard();
        });
      });
    }
  }

  /* =========================
     WEEKLY REPORT + PDF (Admin)
  ========================= */
  function bindWeeklyButtons(){
    // default weekStart
    $("admWeekStart").value = mondayOf(todayISO());

    $("btnBuildWeekly")?.addEventListener("click", async ()=>{
      await buildWeeklyReport();
    });

    $("btnExportPDF")?.addEventListener("click", async ()=>{
      await exportWeeklyPDF();
    });
  }

  async function weeklyData(weekStartISO){
    const snap = await db.collection("services").where("weekStartISO","==",weekStartISO).get();
    const list = snap.docs.map(d=>d.data()).sort((a,b)=> (a.fechaISO < b.fechaISO ? 1 : -1));

    const bruto = round2(list.reduce((a,s)=>a+num(s.montoBruto),0));
    const connectAdj = round2(list.reduce((a,s)=>a+num(s.connectAdjust),0));
    const netToSplit = round2(list.reduce((a,s)=>a+num(s.netToSplit),0));
    const company = round2(list.reduce((a,s)=>a+num(s.companyShare),0));
    const driverNet = round2(list.reduce((a,s)=>a+num(s.driverNet),0));
    const miles = round2(list.reduce((a,s)=>a+num(s.millas),0));

    return { list, bruto, connectAdj, netToSplit, company, driverNet, miles, count:list.length };
  }

  async function buildWeeklyReport(){
    const wk = $("admWeekStart").value || mondayOf(todayISO());
    const r = await weeklyData(wk);

    const box = $("adminWeeklyReport");
    if (!box) return;

    box.innerHTML = `
      <h3>${settings.companyName} — Cierre semanal</h3>
      <div class="muted">Semana desde <b>${wk}</b> • Servicios: <b>${r.count}</b> • Millas: <b>${r.miles}</b></div>
      <div class="hr"></div>

      ${r.list.map(s=>`
        <div class="row">
          <span>${s.fechaISO} • ${s.driverName} • ${s.clientNombre} • ${round2(s.millas)} mi</span>
          <b>${money(s.driverNet)}</b>
        </div>
      `).join("")}

      <div class="hr"></div>
      <div class="row"><span>Total Bruto</span><b>${money(r.bruto)}</b></div>
      <div class="row"><span>Ajuste Connect</span><b>-${money(r.connectAdj)}</b></div>
      <div class="row"><span>Total Neto (para reparto)</span><b>${money(r.netToSplit)}</b></div>
      <div class="row"><span>Empresa</span><b>${money(r.company)}</b></div>
      <div class="row"><span><b>Neto choferes</b></span><b>${money(r.driverNet)}</b></div>
      <div class="hr"></div>
      <div class="muted">${settings.footer}</div>
    `;
  }

  async function exportWeeklyPDF(){
    const wk = $("admWeekStart").value || mondayOf(todayISO());
    const r = await weeklyData(wk);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 16;
    doc.setFontSize(16);
    doc.text(`${settings.companyName} — Cierre semanal`, 14, y); y += 8;

    doc.setFontSize(11);
    doc.text(`Semana desde: ${wk}`, 14, y); y += 6;
    doc.text(`Servicios: ${r.count}   Millas: ${r.miles}`, 14, y); y += 8;

    doc.setFontSize(10);
    r.list.forEach(s=>{
      doc.text(`${s.fechaISO} | ${s.driverName} | ${s.clientNombre} | ${round2(s.millas)} mi | Neto: ${money(s.driverNet)}`, 14, y);
      y += 5;
      if (y > 280){ doc.addPage(); y = 16; }
    });

    y += 6;
    doc.setFontSize(11);
    doc.text(`Total Bruto: ${money(r.bruto)}`, 14, y); y += 6;
    doc.text(`Ajuste Connect: -${money(r.connectAdj)}`, 14, y); y += 6;
    doc.text(`Total Neto (reparto): ${money(r.netToSplit)}`, 14, y); y += 6;
    doc.text(`Empresa: ${money(r.company)}`, 14, y); y += 6;
    doc.text(`Neto choferes: ${money(r.driverNet)}`, 14, y); y += 10;

    doc.setFontSize(9);
    doc.text(settings.footer || "", 14, y);

    doc.save(`cierre_${wk}.pdf`);
  }

})();
