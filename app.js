/* =========================================================
   TowOps Lite — app.js
   - LocalStorage
   - Servicios, Choferes, Clientes
   - Connect -15%
   - Cierre semanal por chofer
   - Facturación a terceros
   ========================================================= */

(() => {
  "use strict";

  /* =======================
     Storage Keys
  ======================= */
  const KEY = {
    DRIVERS: "towops.drivers.v1",
    CLIENTS: "towops.clients.v1",
    SERVICES: "towops.services.v1",
    SETTINGS: "towops.settings.v1"
  };

  /* =======================
     Helpers
  ======================= */
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const num = (v) => Number(v) || 0;

  const todayISO = () => new Date().toISOString().slice(0,10);
  const mondayOf = (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDay(); // 0 Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0,10);
  };

  const uid = () => Math.random().toString(36).slice(2,10);

  const load = (k, d=[]) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  /* =======================
     State
  ======================= */
  let drivers = load(KEY.DRIVERS, []);
  let clients = load(KEY.CLIENTS, []);
  let services = load(KEY.SERVICES, []);
  let settings = load(KEY.SETTINGS, {
    ratePerMile: 0,
    connectPct: 0.15,
    bizName: "TowOps Lite",
    footer: "Gracias por su preferencia"
  });

  /* =======================
     Navigation
  ======================= */
  const views = document.querySelectorAll(".view");
  const tabs = document.querySelectorAll(".tab");

  function show(view){
    views.forEach(v=>v.classList.remove("active"));
    tabs.forEach(t=>t.classList.remove("active"));
    document.getElementById(`view-${view}`).classList.add("active");
    document.querySelector(`.tab[data-view="${view}"]`).classList.add("active");
    refreshAll();
  }

  tabs.forEach(t=>t.addEventListener("click",()=>show(t.dataset.view)));

  /* =======================
     Seed (demo)
  ======================= */
  $("seedDemo")?.addEventListener("click", ()=>{
    if(drivers.length || clients.length) return alert("Demo ya cargado.");
    drivers = [{id:uid(),nombre:"Adolfo Mejía", rate:0}];
    clients = [
      {id:uid(),nombre:"Connect", tipo:"CONNECT"},
      {id:uid(),nombre:"AAA", tipo:"AAA"},
      {id:uid(),nombre:"Dealer XYZ", tipo:"DEALER"}
    ];
    services = [{
      id: uid(),
      fecha: todayISO(),
      driverId: drivers[0].id,
      clientId: clients[0].id,
      tipo: "CONNECT",
      millas: 37,
      enganches: 6,
      monto: 388,
      metodoPago: "CASH",
      gastos: 0,
      nota: ""
    }];
    persist();
    refreshAll();
  });

  /* =======================
     Persist
  ======================= */
  function persist(){
    save(KEY.DRIVERS, drivers);
    save(KEY.CLIENTS, clients);
    save(KEY.SERVICES, services);
    save(KEY.SETTINGS, settings);
  }

  /* =======================
     Select Options
  ======================= */
  function fillSelect(sel, arr, label="nombre"){
    sel.innerHTML = `<option value="">—</option>` +
      arr.map(a=>`<option value="${a.id}">${a[label]}</option>`).join("");
  }

  /* =======================
     Drivers
  ======================= */
  $("driverForm")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    drivers.push({
      id: uid(),
      nombre: $("driverName").value.trim(),
      rate: num($("driverRate").value)
    });
    e.target.reset();
    persist(); refreshAll();
  });

  function renderDrivers(){
    const tb = $("driversTable").querySelector("tbody");
    tb.innerHTML = drivers.map(d=>`
      <tr>
        <td>${d.nombre}</td>
        <td class="num">${fmt(d.rate)}</td>
        <td><button class="btn danger" data-del="${d.id}">X</button></td>
      </tr>`).join("");
    tb.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick=()=>{
        drivers = drivers.filter(d=>d.id!==b.dataset.del);
        persist(); refreshAll();
      };
    });
  }

  /* =======================
     Clients
  ======================= */
  $("clientForm")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    clients.push({
      id: uid(),
      nombre: $("clientName").value.trim(),
      email: $("clientEmail").value.trim(),
      tipo: "DEALER"
    });
    e.target.reset();
    persist(); refreshAll();
  });

  function renderClients(){
    const tb = $("clientsTable").querySelector("tbody");
    tb.innerHTML = clients.map(c=>`
      <tr>
        <td>${c.nombre}</td>
        <td>${c.email||""}</td>
        <td><button class="btn danger" data-del="${c.id}">X</button></td>
      </tr>`).join("");
    tb.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick=()=>{
        clients = clients.filter(c=>c.id!==b.dataset.del);
        persist(); refreshAll();
      };
    });
  }

  /* =======================
     Services (Quick)
  ======================= */
  $("quickServiceForm")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    services.push({
      id: uid(),
      fecha: $("qsDate").value || todayISO(),
      driverId: $("qsDriver").value,
      clientId: $("qsClient").value,
      tipo: $("qsType").value,
      millas: num($("qsMiles").value),
      enganches: 0,
      monto: num($("qsAmount").value),
      metodoPago: $("qsPayMethod").value,
      gastos: num($("qsExpenses").value),
      nota: $("qsNote").value.trim()
    });
    e.target.reset();
    persist(); refreshAll();
  });

  function connectDiscount(s){
    return s.tipo==="CONNECT" ? s.monto * settings.connectPct : 0;
  }

  function netDriver(s){
    return s.monto - connectDiscount(s) - s.gastos;
  }

  function renderRecent(){
    const tb = $("dashRecentTable").querySelector("tbody");
    const last = services.slice(-20).reverse();
    tb.innerHTML = last.map(s=>{
      const d = drivers.find(x=>x.id===s.driverId)?.nombre || "";
      const c = clients.find(x=>x.id===s.clientId)?.nombre || "";
      return `
      <tr>
        <td>${s.fecha}</td>
        <td>${d}</td>
        <td>${c}</td>
        <td>${s.tipo}</td>
        <td class="num">${s.millas}</td>
        <td class="num">${fmt(s.monto)}</td>
        <td class="num">${fmt(s.gastos)}</td>
        <td>${s.metodoPago}</td>
        <td class="num">${fmt(connectDiscount(s))}</td>
        <td class="num">${fmt(netDriver(s))}</td>
        <td><button class="btn danger" data-del="${s.id}">X</button></td>
      </tr>`;
    }).join("");
    tb.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick=()=>{
        services = services.filter(s=>s.id!==b.dataset.del);
        persist(); refreshAll();
      };
    });
  }

  /* =======================
     Dashboard KPIs (week)
  ======================= */
  function renderKPIs(){
    const wk = mondayOf(todayISO());
    const week = services.filter(s=>mondayOf(s.fecha)===wk);
    const gross = week.reduce((a,s)=>a+s.monto,0);
    const miles = week.reduce((a,s)=>a+s.millas,0);
    $("kpiWeekRange").textContent = wk;
    $("kpiWeekMiles").textContent = miles;
    $("kpiWeekServices").textContent = week.length;
    $("kpiRevPerMile").textContent = miles?fmt(gross/miles):fmt(0);
    document.querySelector('[remember="kpiWeekGross"]').textContent = fmt(gross);
  }

  /* =======================
     Services list + CSV
  ======================= */
  $("svcApply")?.addEventListener("click",renderServices);
  $("svcExportCsv")?.addEventListener("click",()=>{
    const rows = [["Fecha","Chofer","Cliente","Tipo","Millas","Monto","Gastos","Pago","Desc Connect","Neto"]];
    services.forEach(s=>{
      rows.push([
        s.fecha,
        drivers.find(d=>d.id===s.driverId)?.nombre||"",
        clients.find(c=>c.id===s.clientId)?.nombre||"",
        s.tipo, s.millas, s.monto, s.gastos, s.metodoPago,
        connectDiscount(s).toFixed(2),
        netDriver(s).toFixed(2)
      ]);
    });
    const csv = rows.map(r=>r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = "servicios.csv"; a.click();
  });

  function renderServices(){
    const tb = $("servicesTable").querySelector("tbody");
    tb.innerHTML = services.map(s=>{
      return `
      <tr>
        <td>${s.fecha}</td>
        <td>${drivers.find(d=>d.id===s.driverId)?.nombre||""}</td>
        <td>${clients.find(c=>c.id===s.clientId)?.nombre||""}</td>
        <td>${s.tipo}</td>
        <td class="num">${s.millas}</td>
        <td class="num">${fmt(s.monto)}</td>
        <td class="num">${fmt(s.gastos)}</td>
        <td>${s.metodoPago}</td>
        <td class="num">${fmt(connectDiscount(s))}</td>
        <td class="num">${fmt(netDriver(s))}</td>
        <td></td>
      </tr>`;
    }).join("");
  }

  /* =======================
     Weekly Close (Driver)
  ======================= */
  $("wkBuild")?.addEventListener("click",()=>{
    const wk = $("wkStart").value;
    const did = $("wkDriver").value;
    const rate = num($("wkRate").value) || settings.ratePerMile;
    if(!wk||!did) return alert("Selecciona semana y chofer");
    const list = services.filter(s=>mondayOf(s.fecha)===wk && s.driverId===did);
    const miles = list.reduce((a,s)=>a+s.millas,0);
    const gross = list.reduce((a,s)=>a+s.monto,0);
    const disc = list.reduce((a,s)=>a+connectDiscount(s),0);
    const gastos = list.reduce((a,s)=>a+s.gastos,0);
    const net = gross - disc - gastos;
    $("weeklySummary").innerHTML = `
      <h3>${drivers.find(d=>d.id===did)?.nombre||""} — Semana ${wk}</h3>
      <div class="row"><span>Total millas</span><b>${miles}</b></div>
      <div class="row"><span>Bruto</span><b>${fmt(gross)}</b></div>
      <div class="row"><span>Connect -15%</span><b>${fmt(disc)}</b></div>
      <div class="row"><span>Gastos</span><b>${fmt(gastos)}</b></div>
      <div class="row"><span>Neto chofer</span><b>${fmt(net)}</b></div>
    `;
  });
  $("wkPrint")?.addEventListener("click",()=>window.print());

  /* =======================
     Invoice (Client)
  ======================= */
  $("invBuild")?.addEventListener("click",()=>{
    const wk = $("invWeekStart").value;
    const cid = $("invClient").value;
    if(!wk||!cid) return alert("Selecciona semana y cliente");
    const list = services.filter(s=>mondayOf(s.fecha)===wk && s.clientId===cid);
    const total = list.reduce((a,s)=>a+s.monto,0);
    $("invoiceClient").innerHTML = `
      <h3>${clients.find(c=>c.id===cid)?.nombre||""} — Semana ${wk}</h3>
      ${list.map(s=>`<div class="row"><span>${s.fecha} ${drivers.find(d=>d.id===s.driverId)?.nombre||""}</span><b>${fmt(s.monto)}</b></div>`).join("")}
      <div class="row"><span>Total</span><b>${fmt(total)}</b></div>
    `;
  });
  $("invPrint")?.addEventListener("click",()=>window.print());

  /* =======================
     Settings
  ======================= */
  $("settingsForm")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    settings.ratePerMile = num($("setRate").value);
    settings.connectPct = num($("setConnectPct").value);
    settings.bizName = $("setBizName").value;
    settings.footer = $("setFooter").value;
    persist();
    alert("Ajustes guardados");
  });
  $("wipeAll")?.addEventListener("click",()=>{
    if(confirm("¿Borrar todo?")){
      localStorage.clear(); location.reload();
    }
  });

  /* =======================
     Refresh All
  ======================= */
  function refreshAll(){
    fillSelect($("qsDriver"), drivers);
    fillSelect($("qsClient"), clients);
    fillSelect($("svcDriver"), drivers);
    fillSelect($("svcClient"), clients);
    fillSelect($("wkDriver"), drivers);
    fillSelect($("invClient"), clients);
    renderDrivers();
    renderClients();
    renderRecent();
    renderServices();
    renderKPIs();
    $("qsDate").value = todayISO();
  }

  // Init
  show("dashboard");
})();
