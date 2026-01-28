(() => {
  "use strict";

  const NTPR_APP_VERSION = "2.0.0";
  console.log("NTPR_APP_VERSION:", NTPR_APP_VERSION);

  // ===== Firebase config (TU PROYECTO NUEVO) =====
  const firebaseConfig = {
    apiKey: "AIzaSyDGoSNKi1wapE1SpHxTc8wNZGGkJ2nQj7s",
    authDomain: "nexus-transport-2887b.firebaseapp.com",
    projectId: "nexus-transport-2887b",
    storageBucket: "nexus-transport-2887b.firebasestorage.app",
    messagingSenderId: "972915419764",
    appId: "1:972915419764:web:7d61dfb03bbe56df867f21"
  };

  // UID maestro (tu UID)
  const MASTER_ADMIN_UID = "cLXayqw0dhWPDkuozjA2G3k7d4z1";

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);

  const views = {
    login: $("view-login"),
    dashboard: $("view-dashboard"),
    driver: $("view-driver"),
    adminUsers: $("view-adminUsers"),
    adminClients: $("view-adminClients"),
    adminServices: $("view-adminServices")
  };

  const topbar = $("topbar");
  const appMain = $("app");
  const whoLine = $("whoLine");
  const rolePill = $("rolePill");

  // ===== Error banner (injected) =====
  const errBar = document.createElement("div");
  errBar.style.cssText = `
    position:fixed; left:12px; right:12px; bottom:12px; z-index:99999;
    background:rgba(255,0,0,.12); border:1px solid rgba(255,0,0,.35);
    color:#fff; padding:10px 12px; border-radius:12px; display:none;
    font-family:system-ui; font-size:13px;
  `;
  document.body.appendChild(errBar);

  function showError(msg, err){
    const detail = err?.message ? ` — ${err.message}` : "";
    errBar.textContent = `ERROR: ${msg}${detail}`;
    errBar.style.display = "block";
    console.error(msg, err || "");
  }
  function clearError(){ errBar.style.display = "none"; errBar.textContent = ""; }

  function setView(name){
    Object.values(views).forEach(v => v && v.classList.remove("active"));
    views[name]?.classList.add("active");

    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelector(`.tab[data-view="${name}"]`)?.classList.add("active");
  }

  function setShell(ready){
    if (topbar) topbar.hidden = !ready;
    if (appMain) appMain.hidden = !ready;
  }

  function guard(id){
    const el = $(id);
    if (!el) console.warn("Missing element:", id);
    return el;
  }

  // ===== Firebase init =====
  let auth, db;
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("Firebase inicializado:", firebaseConfig.projectId);
  } catch (e) {
    showError("Firebase init falló", e);
    return;
  }

  // ===== State =====
  const S = {
    user: null,
    profile: null,
    role: null,
    entered: false
  };

  // ===== Collections =====
  const C = {
    USERS: "users",
    INVITES: "invites",
    CLIENTS: "clients",
    SERVICES: "services"
  };

  // ===== UI Buttons =====
  $("btnGoogleLogin")?.addEventListener("click", async ()=>{
    clearError();
    try{
      const prov = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(prov);
    }catch(e){
      showError("Login Google bloqueado. Revisa Authorized Domains en Firebase Auth.", e);
    }
  });

  $("btnLogout")?.addEventListener("click", ()=>auth.signOut());
  $("btnReload")?.addEventListener("click", ()=>location.reload());

  // ===== PIN helpers (simple) =====
  async function sha256Hex(text){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  }
  async function pinHash(uid, pin){
    return sha256Hex(`${uid}:${String(pin||"")}`);
  }

  $("btnPinConfirm")?.addEventListener("click", async ()=>{
    clearError();
    const pin = ($("pinInput")?.value || "").trim();
    if (!pin) return (guard("pinError").textContent = "PIN requerido.");

    try{
      const h = await pinHash(S.user.uid, pin);
      if (h !== (S.profile?.pinHash || "")) {
        guard("pinError").textContent = "PIN incorrecto.";
        return;
      }
      await afterEnter();
    } catch(e){
      showError("Validación de PIN falló", e);
    }
  });

  $("btnPinSet")?.addEventListener("click", async ()=>{
    clearError();
    const p1 = ($("pinNew")?.value || "").trim();
    const p2 = ($("pinNew2")?.value || "").trim();
    if (!p1 || !p2) return (guard("pinSetError").textContent = "Completa ambos campos.");
    if (p1 !== p2) return (guard("pinSetError").textContent = "PIN no coincide.");
    if (p1.length < 4) return (guard("pinSetError").textContent = "PIN mínimo 4 dígitos.");

    try{
      const h = await pinHash(S.user.uid, p1);
      await db.collection(C.USERS).doc(S.user.uid).set({
        pinHash: h,
        pinUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });

      const snap = await db.collection(C.USERS).doc(S.user.uid).get();
      S.profile = snap.data() || {};
      S.role = S.profile.role || "driver";

      await afterEnter();
    } catch(e){
      showError("Guardar PIN falló (rules/firestore)", e);
    }
  });

  // ===== Bootstrap user =====
  async function ensureUserDoc(user){
    const uref = db.collection(C.USERS).doc(user.uid);
    let snap;

    try { snap = await uref.get(); }
    catch(e){ throw new Error("No puedo leer users/{uid}. Revisa Firestore Rules/DB."); }

    // Bootstrap admin maestro
    if (!snap.exists && user.uid === MASTER_ADMIN_UID){
      await uref.set({
        email: (user.email||"").toLowerCase(),
        displayName: user.displayName || "",
        role: "admin",
        active: true,
        pinHash: "",
        master: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
      snap = await uref.get();
    }

    // Invitación por email si no existe
    if (!snap.exists){
      const email = (user.email||"").toLowerCase();
      if (!email) throw new Error("Email no disponible en Google Auth.");

      const inv = await db.collection(C.INVITES).doc(email).get();
      if (!inv.exists) throw new Error("No autorizado. Falta invite en /invites/{email}.");

      const d = inv.data() || {};
      if (d.active === false) throw new Error("Invitación inactiva.");

      await uref.set({
        email,
        displayName: user.displayName || "",
        role: d.role || "driver",
        active: d.active !== false,
        pinHash: "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });

      snap = await uref.get();
    }

    return snap.data() || {};
  }

  async function afterEnter(){
    S.entered = true;
    setShell(true);

    // Admin tabs
    const adminTabs = ["tabAdminUsers","tabAdminClients","tabAdminServices"];
    adminTabs.forEach(id=>{
      const el = $(id);
      if (el) el.style.display = (S.role === "admin") ? "" : "none";
    });

    setView("dashboard");
    await renderDashboardSafe();
  }

  // ===== Dashboard render safe =====
  async function renderDashboardSafe(){
    clearError();

    if (!S.entered || !S.user) {
      // No render aún
      return;
    }

    try{
      // KPI básicos desde services (si no hay colección, no explota)
      const wkMiles = $("kpiWeekMiles");
      const wkServices = $("kpiWeekServices");
      const wkDriverNet = $("kpiWeekDriverNet");
      const wkCompany = $("kpiWeekCompany");

      if (wkMiles) wkMiles.textContent = "0";
      if (wkServices) wkServices.textContent = "0";
      if (wkDriverNet) wkDriverNet.textContent = "$0.00";
      if (wkCompany) wkCompany.textContent = "$0.00";

      // Intento lectura simple: últimos 10 services del usuario (o todos si admin)
      let q = db.collection(C.SERVICES).orderBy("createdAt","desc").limit(10);
      if (S.role !== "admin") q = q.where("driverUid","==",S.user.uid);

      const snap = await q.get();
      const rows = snap.docs.map(d=>d.data());

      if (wkServices) wkServices.textContent = String(rows.length);

      // Recent list
      const tb = $("dashRecent");
      if (tb){
        tb.innerHTML = rows.map(r=>`
          <tr>
            <td>${String(r.dateISO||"")}</td>
            <td>${String(r.clientName||"")}</td>
            <td>${Number(r.miles||0).toFixed(1)}</td>
            <td>${Number(r.driverNet||0).toFixed(2)}</td>
          </tr>
        `).join("");
      }
    }catch(e){
      showError("Dashboard no puede leer Firestore. 99% Rules/Auth/Firestore DB.", e);
    }
  }

  // ===== Tabs click (solo si entered) =====
  document.querySelectorAll("#navTabs .tab[data-view]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if (!S.entered) return setView("login");
      const v = btn.dataset.view;
      if (!v) return;
      if (v.startsWith("admin") && S.role !== "admin") return;
      setView(v);
      if (v === "dashboard") await renderDashboardSafe();
    });
  });

  // ===== Auth state =====
  auth.onAuthStateChanged(async (user)=>{
    clearError();
    S.entered = false;
    S.user = user;
    S.profile = null;
    S.role = null;

    // Siempre arrancar bloqueado
    setShell(false);
    setView("login");

    if (!user){
      guard("loginMsg").textContent = "Inicia sesión con Google";
      return;
    }

    guard("loginMsg").textContent = "Google OK. Cargando perfil...";
    try{
      const profile = await ensureUserDoc(user);
      S.profile = profile;
      S.role = profile.role || "driver";

      if (whoLine) whoLine.textContent = (profile.email || user.email || "—");
      if (rolePill) rolePill.textContent = (S.role || "—").toUpperCase();

      // Si no hay PIN, pedir crear
      if (!profile.pinHash){
        guard("loginMsg").textContent = "Usuario OK. Crea tu PIN para entrar.";
      } else {
        guard("loginMsg").textContent = "Usuario OK. Confirma tu PIN para entrar.";
      }

    }catch(e){
      showError("Onboarding falló (Auth/Rules/Firestore)", e);
      guard("loginMsg").textContent = "Fallo de acceso. Revisa el error abajo.";
    }
  });

})();
