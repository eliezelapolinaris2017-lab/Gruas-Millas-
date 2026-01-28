/* =========================================================
   TowOps MVP — app.js (v1 FINAL)
   - LocalStorage (persistente al refresh)
   - Registro de servicios
   - Cierre semanal por chofer
   - Ajuste Connect -15% (interno)
   - Reparto: Empresa 30% / Chofer 70%
   - Retención 10% (contributiva) al chofer
   - Reporte por cliente (factura simple)
   ========================================================= */

(() => {
  "use strict";

  // =========================
  // Storage Keys
  // =========================
  const KEY = {
    SETTINGS: "towops.settings.v1",
    DRIVERS:  "towops.drivers.v1",
    CLIENTS:  "towops.clients.v1",
    SERVICES: "towops.services.v1",
  };

  // =========================
  // Defaults (NO se pierden al refresh)
  // =========================
  const DEFAULT_SETTINGS = {
    companyName: "Tu Empresa de Grúas",
    connectPct: 0.15,     // -15% Connect a la empresa (ajuste interno)
    companyPct: 0.30,     // Empresa 30%
    retentionPct: 0.10,   // Retención chofer 10%
    footer: "Resumen generado por TowOps MVP"
  };

  // =========================
  // Helpers
  // =========================
  const $ = (id) => document.getElementById(id);

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

  const money = (n) => round2(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });

  const todayISO = () => new Date().toISOString().slice(0, 10);

  // Lunes de la semana (lunes-domingo)
  const mondayOf = (dateStr) => {
    const d = new Date((dateStr || todayISO()) + "T00:00:00");
    const day = d.getDay(); // 0=Dom
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0, 10);
  };

  const uid = () => Math.random().toString(36).slice(2, 10);

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // =========================
  // State
  // =========================
  let settings = loadJSON(KEY.SETTINGS, null);
  settings = settings ? { ...DEFAULT_SETTINGS, ...settings } : { ...DEFAULT_SETTINGS };
  saveJSON(KEY.SETTINGS, settings); // asegura merge persistente

  let drivers  = loadJSON(KEY.DRIVERS, []);
  let clients  = loadJSON(KEY.CLIENTS, []);
  let services = loadJSON(KEY.SERVICES, []);

  function persistAll() {
    saveJSON(KEY.SETTINGS, settings);
    saveJSON(KEY.DRIVERS, drivers);
    saveJSON(KEY.CLIENTS, clients);
    saveJSON(KEY.SERVICES, services);
  }

  // =========================
  // Minimum data (para no trabarse)
  // =========================
  function ensureMinimumData() {
    if (!clients.length) {
      clients.push({ id: uid(), nombre: "Connect" });
      clients.push({ id: uid(), nombre: "AAA" });
      clients.push({ id: uid(), nombre: "Dealer" });
      clients.push({ id: uid(), nombre: "Privado" });
      persistAll();
    }
  }
  ensureMinimumData();

  // =========================
  // Lookup helpers
  // =========================
  const driverName = (id) => drivers.find(d => d.id === id)?.nombre || "—";
  const clientName = (id) => clients.find(c => c.id === id)?.nombre || "—";

  // =========================
  // UI: navegación (si existe)
  // =========================
  const views = document.querySelectorAll(".view");
  const tabs  = document.querySelectorAll(".tab");

  function show(viewName) {
    views.forEach(v => v.classList.remove("active"));
    tabs.forEach(t => t.classList.remove("active"));

    const v = document.getElementById(`view-${viewName}`);
    const t = document.querySelector(`.tab[data-view="${viewName}"]`);
    if (v) v.classList.add("active");
    if (t) t.classList.add("active");

    refreshAll();
  }

  tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.view)));

  // =========================
  // Select fillers
  // =========================
  function fillSelect(el, items) {
    if (!el) return;
    el.innerHTML = `<option value="">—</option>` + items.map(x =>
      `<option value="${x.id}">${x.nombre}</option>`
    ).join("");
  }

  // =========================
  // Core: cálculo semanal por chofer
  // =========================
  function listWeek(weekStartISO, driverId = "", clientId = "") {
    return services.filter(s => {
      const okWeek   = mondayOf(s.fecha) === weekStartISO;
      const okDriver = driverId ? s.driverId === driverId : true;
      const okClient = clientId ? s.clientId === clientId : true;
      return okWeek && okDriver && okClient;
    });
  }

  function calcWeekly(weekStartISO, driverId, manualAdjust = {}) {
    const list = listWeek(weekStartISO, driverId);

    const totalMiles = round2(list.reduce((a, s) => a + num(s.millas), 0));
    const totalBruto = round2(list.reduce((a, s) => a + num(s.monto), 0));
    const totalGastosServicios = round2(list.reduce((a, s) => a + num(s.gastos), 0));

    // Connect bruto = SUM(monto) donde tipo = CONNECT
    const connectBruto = round2(list.filter(s => s.tipo === "CONNECT")
      .reduce((a, s) => a + num(s.monto), 0));

    // Ajuste interno Connect (-15% de Connect bruto)
    const connectAdjust = round2(connectBruto * num(settings.connectPct));

    // Total Neto para reparto (Bruto - ajuste connect)
    const totalNeto = round2(totalBruto - connectAdjust);

    // Split
    const companyShare = round2(totalNeto * num(settings.companyPct));
    const driverShareGross = round2(totalNeto - companyShare); // 70% si companyPct=30%

    // Retención al chofer (contributiva)
    const retention = round2(driverShareGross * num(settings.retentionPct));
    const driverShareNet = round2(driverShareGross - retention);

    // Ajustes manuales (opcionales, en cierre semanal)
    const adjGastos = round2(num(manualAdjust.gastos));
    const adjPeajes = round2(num(manualAdjust.peajes));
    const adjEnBolsa = round2(num(manualAdjust.enBolsa));
    const adjUsoCash = round2(num(manualAdjust.usoCash));
    const adjSeDebe = round2(num(manualAdjust.seDebe));

    // Interpretación práctica (editable):
    // - gastos/peajes bajan el pago neto del chofer (por defecto)
    // - enBolsa/usoCash pueden ser informativos, no necesariamente afectan
    // - seDebe es balance final (puede sumar o restar según caso)
    const driverFinal = round2(driverShareNet - adjGastos - adjPeajes + adjSeDebe);

    return {
      weekStartISO,
      driverId,
      count: list.length,
      totalMiles,
      totalBruto,
      connectBruto,
      connectAdjust,
      totalNeto,
      companyShare,
      driverShareGross,
      retention,
      driverShareNet,
      totalGastosServicios,
      adjGastos,
      adjPeajes,
      adjEnBolsa,
      adjUsoCash,
      adjSeDebe,
      driverFinal,
      list // <- la lista para PDF detallado
    };
  }

  // =========================
  // Dashboard KPIs (semana actual)
  // =========================
  function renderKPIs() {
    const wk = mondayOf(todayISO());
    const week = listWeek(wk);

    const bruto = round2(week.reduce((a,s)=>a+num(s.monto),0));
    const miles = round2(week.reduce((a,s)=>a+num(s.millas),0));

    // Ajuste connect general
    const connectBruto = round2(week.filter(s=>s.tipo==="CONNECT").reduce((a,s)=>a+num(s.monto),0));
    const connectAdj = round2(connectBruto * num(settings.connectPct));
    const neto = round2(bruto - connectAdj);

    const elGross = document.querySelector('[remember="kpiWeekGross"]');
    if (elGross) elGross.textContent = money(bruto);

    if ($("kpiWeekRange")) $("kpiWeekRange").textContent = `Semana desde ${wk}`;
    if ($("kpiWeekMiles")) $("kpiWeekMiles").textContent = miles;
    if ($("kpiWeekServices")) $("kpiWeekServices").textContent = week.length;

    const revPerMile = miles ? neto / miles : 0;
    if ($("kpiRevPerMile")) $("kpiRevPerMile").textContent = money(revPerMile);
  }

  // =========================
  // Registrar servicio (quick form)
  // =========================
  const quickForm = $("quickServiceForm");
  if (quickForm) {
    quickForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const fecha = $("qsDate")?.value || todayISO();
      const driverId = $("qsDriver")?.value;
      const clientId = $("qsClient")?.value;

      if (!driverId || !clientId) return alert("Selecciona chofer y cliente.");

      services.push({
        id: uid(),
        fecha,
        driverId,
        clientId,
        tipo: $("qsType")?.value || "OTRO",
        millas: num($("qsMiles")?.value),
        monto: num($("qsAmount")?.value),
        metodoPago: $("qsPayMethod")?.value || "PENDIENTE",
        gastos: num($("qsExpenses")?.value),
        nota: ($("qsNote")?.value || "").trim()
      });

      quickForm.reset();
      if ($("qsDate")) $("qsDate").value = todayISO();

      persistAll();
      refreshAll();
    });
  }

  // =========================
  // Render Recent (Dashboard table)
  // =========================
  function renderRecent() {
    const tb = $("dashRecentTable")?.querySelector("tbody");
    if (!tb) return;

    const last = services.slice(-20).reverse();
    tb.innerHTML = last.map(s => {
      const connectDisc = s.tipo === "CONNECT" ? round2(num(s.monto) * num(settings.connectPct)) : 0;
      const montoNetoServicio = round2(num(s.monto) - connectDisc);

      return `
        <tr>
          <td>${s.fecha}</td>
          <td>${driverName(s.driverId)}</td>
          <td>${clientName(s.clientId)}</td>
          <td>${s.tipo}</td>
          <td class="num">${round2(s.millas)}</td>
          <td class="num">${money(s.monto)}</td>
          <td class="num">${money(s.gastos)}</td>
          <td>${s.metodoPago}</td>
          <td class="num">${money(connectDisc)}</td>
          <td class="num">${money(montoNetoServicio)}</td>
          <td><button class="btn danger" data-del-svc="${s.id}">X</button></td>
        </tr>
      `;
    }).join("");

    tb.querySelectorAll("[data-del-svc]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delSvc;
        services = services.filter(s => s.id !== id);
        persistAll();
        refreshAll();
      });
    });
  }

  // =========================
  // Drivers (add/list)
  // =========================
  const driverForm = $("driverForm");
  if (driverForm) {
    driverForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = ($("driverName")?.value || "").trim();
      if (!name) return;

      drivers.push({ id: uid(), nombre: name });
      driverForm.reset();

      persistAll();
      refreshAll();
    });
  }

  function renderDrivers() {
    const tb = $("driversTable")?.querySelector("tbody");
    if (!tb) return;

    tb.innerHTML = drivers.map(d => `
      <tr>
        <td>${d.nombre}</td>
        <td class="num">—</td>
        <td><button class="btn danger" data-del-driver="${d.id}">X</button></td>
      </tr>
    `).join("");

    tb.querySelectorAll("[data-del-driver]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delDriver;
        if (!confirm("Borrar chofer y sus servicios asociados?")) return;

        drivers = drivers.filter(d => d.id !== id);
        services = services.filter(s => s.driverId !== id);

        persistAll();
        refreshAll();
      });
    });
  }

  // =========================
  // Clients (add/list)
  // =========================
  const clientForm = $("clientForm");
  if (clientForm) {
    clientForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = ($("clientName")?.value || "").trim();
      if (!name) return;

      clients.push({
        id: uid(),
        nombre: name,
        email: ($("clientEmail")?.value || "").trim()
      });

      clientForm.reset();
      persistAll();
      refreshAll();
    });
  }

  function renderClients() {
    const tb = $("clientsTable")?.querySelector("tbody");
    if (!tb) return;

    tb.innerHTML = clients.map(c => `
      <tr>
        <td>${c.nombre}</td>
        <td>${c.email || ""}</td>
        <td><button class="btn danger" data-del-client="${c.id}">X</button></td>
      </tr>
    `).join("");

    tb.querySelectorAll("[data-del-client]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delClient;
        if (!confirm("Borrar cliente y servicios asociados?")) return;

        clients = clients.filter(c => c.id !== id);
        services = services.filter(s => s.clientId !== id);

        persistAll();
        refreshAll();
      });
    });
  }

  // =========================
  // Services view table + export CSV
  // =========================
  function renderServicesTable() {
    const tb = $("servicesTable")?.querySelector("tbody");
    if (!tb) return;

    const list = services.slice().sort((a,b)=> (a.fecha < b.fecha ? 1 : -1));
    tb.innerHTML = list.map(s => {
      const connectDisc = s.tipo === "CONNECT" ? round2(num(s.monto) * num(settings.connectPct)) : 0;
      const montoNetoServicio = round2(num(s.monto) - connectDisc);

      return `
        <tr>
          <td>${s.fecha}</td>
          <td>${driverName(s.driverId)}</td>
          <td>${clientName(s.clientId)}</td>
          <td>${s.tipo}</td>
          <td class="num">${round2(s.millas)}</td>
          <td class="num">${money(s.monto)}</td>
          <td class="num">${money(s.gastos)}</td>
          <td>${s.metodoPago}</td>
          <td class="num">${money(connectDisc)}</td>
          <td class="num">${money(montoNetoServicio)}</td>
          <td></td>
        </tr>
      `;
    }).join("");
  }

  $("svcExportCsv")?.addEventListener("click", () => {
    const rows = [
      ["Fecha","Chofer","Cliente","Tipo","Millas","Monto","Gastos","MetodoPago","ConnectAdj15","MontoNeto"]
    ];

    services.forEach(s => {
      const connectAdj = s.tipo === "CONNECT" ? round2(num(s.monto) * num(settings.connectPct)) : 0;
      const net = round2(num(s.monto) - connectAdj);

      rows.push([
        s.fecha,
        driverName(s.driverId),
        clientName(s.clientId),
        s.tipo,
        round2(s.millas),
        round2(s.monto),
        round2(s.gastos),
        s.metodoPago,
        connectAdj,
        net
      ]);
    });

    const csv = rows.map(r => r.map(x => String(x).replaceAll(",", " ")).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "towops_servicios.csv";
    a.click();
  });

  // =========================
  // Weekly Close UI
  // =========================
  function getManualAdjustInputs() {
    return {
      gastos:  num($("wkAdjGastos")?.value),
      peajes:  num($("wkAdjPeajes")?.value),
      enBolsa: num($("wkAdjEnBolsa")?.value),
      usoCash: num($("wkAdjUsoCash")?.value),
      seDebe:  num($("wkAdjSeDebe")?.value),
    };
  }

  $("wkBuild")?.addEventListener("click", () => {
    const wk = $("wkStart")?.value;
    const did = $("wkDriver")?.value;
    if (!wk || !did) return alert("Selecciona semana y chofer.");

    const r = calcWeekly(wk, did, getManualAdjustInputs());

    const driverPct = round2(1 - num(settings.companyPct)); // 70%
    const html = `
      <h3>${settings.companyName} — Cierre semanal</h3>
      <div class="muted">Chofer: <b>${driverName(did)}</b> • Semana desde <b>${wk}</b> • Servicios: <b>${r.count}</b></div>
      <div class="row"><span>Millas</span><b>${r.totalMiles}</b></div>
      <div class="row"><span>Total Bruto</span><b>${money(r.totalBruto)}</b></div>

      <div class="row"><span>Connect Bruto</span><b>${money(r.connectBruto)}</b></div>
      <div class="row"><span>Ajuste Connect (-${Math.round(settings.connectPct*100)}%)</span><b>${money(r.connectAdjust)}</b></div>

      <div class="row"><span>Total Neto (para reparto)</span><b>${money(r.totalNeto)}</b></div>

      <div class="row"><span>Empresa (${Math.round(settings.companyPct*100)}%)</span><b>${money(r.companyShare)}</b></div>
      <div class="row"><span>Chofer (${Math.round(driverPct*100)}%)</span><b>${money(r.driverShareGross)}</b></div>

      <div class="row"><span>Retención chofer (${Math.round(settings.retentionPct*100)}%)</span><b>-${money(r.retention)}</b></div>
      <div class="row"><span>Chofer Neto (después retención)</span><b>${money(r.driverShareNet)}</b></div>

      <div class="hr"></div>
      <div class="row"><span>Ajuste: Gastos</span><b>-${money(r.adjGastos)}</b></div>
      <div class="row"><span>Ajuste: Peajes</span><b>-${money(r.adjPeajes)}</b></div>
      <div class="row"><span>Se le debe (±)</span><b>${money(r.adjSeDebe)}</b></div>

      <div class="row"><span><b>Total final a pagar al chofer</b></span><b>${money(r.driverFinal)}</b></div>

      <div class="hr"></div>
      <div class="muted">${settings.footer}</div>
    `;

    if ($("weeklySummary")) $("weeklySummary").innerHTML = html;
  });

  // =========================
  // Invoice by client (facturar a terceros)
  // =========================
  $("invBuild")?.addEventListener("click", () => {
    const wk = $("invWeekStart")?.value;
    const cid = $("invClient")?.value;
    if (!wk || !cid) return alert("Selecciona semana y cliente.");

    const list = listWeek(wk, "", cid).slice().sort((a,b)=> (a.fecha < b.fecha ? 1 : -1));
    const bruto = round2(list.reduce((a,s)=>a+num(s.monto),0));

    // Si el cliente es Connect, aplicamos ajuste interno para “netear”
    const isConnect = (clientName(cid).toLowerCase() === "connect");
    const connectAdj = isConnect ? round2(bruto * num(settings.connectPct)) : 0;
    const neto = round2(bruto - connectAdj);

    const html = `
      <h3>Factura — ${settings.companyName}</h3>
      <div class="muted">Cliente: <b>${clientName(cid)}</b> • Semana desde <b>${wk}</b></div>
      <div class="hr"></div>
      ${list.map(s=>`
        <div class="row">
          <span>${s.fecha} • ${driverName(s.driverId)} • ${s.tipo} • ${round2(s.millas)} millas</span>
          <b>${money(s.monto)}</b>
        </div>
      `).join("")}
      <div class="hr"></div>
      <div class="row"><span>Total Bruto</span><b>${money(bruto)}</b></div>
      ${isConnect ? `<div class="row"><span>Ajuste Connect (-${Math.round(settings.connectPct*100)}%)</span><b>-${money(connectAdj)}</b></div>` : ""}
      <div class="row"><span><b>Total a facturar</b></span><b>${money(neto)}</b></div>
      <div class="hr"></div>
      <div class="muted">${settings.footer}</div>
    `;
    if ($("invoiceClient")) $("invoiceClient").innerHTML = html;
  });

  // =========================
  // jsPDF: utilidades PDF (NO QUITA NADA, solo reemplaza print)
  // =========================
  function ensureJsPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("Falta jsPDF. Añade el script CDN de jsPDF antes de app.js en el index.html.");
      return null;
    }
    return window.jspdf.jsPDF;
  }

  function pdfNewDoc() {
    const J = ensureJsPDF();
    if (!J) return null;
    const doc = new J({ unit: "pt", format: "letter" });
    return doc;
  }

  function pdfText(doc, text, x, y, size = 11, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.text(String(text || ""), x, y);
  }

  function pdfLine(doc, x1, y1, x2, y2) {
    doc.setLineWidth(0.8);
    doc.line(x1, y1, x2, y2);
  }

  function pdfMoney(doc, label, value, xLabel, xValue, y) {
    pdfText(doc, label, xLabel, y, 11, false);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(String(value), xValue, y, { align: "right" });
  }

  function pdfFooter(doc) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(settings.footer, 40, 750);
  }

  // =========================
  // PDF: Cierre semanal (wkPrint) — SIEMPRE jsPDF
  // =========================
  $("wkPrint")?.addEventListener("click", () => {
    const wk = $("wkStart")?.value;
    const did = $("wkDriver")?.value;
    if (!wk || !did) return alert("Selecciona semana y chofer.");

    const r = calcWeekly(wk, did, getManualAdjustInputs());
    const doc = pdfNewDoc();
    if (!doc) return;

    // Header
    pdfText(doc, settings.companyName, 40, 50, 16, true);
    pdfText(doc, "CIERRE SEMANAL (CHOFER)", 40, 72, 12, true);
    pdfLine(doc, 40, 80, 572, 80);

    // Meta
    pdfText(doc, `Semana desde: ${wk}`, 40, 105, 11, false);
    pdfText(doc, `Chofer: ${driverName(did)}`, 40, 123, 11, false);
    pdfText(doc, `Servicios: ${r.count}`, 40, 141, 11, false);

    // Totales
    let y = 175;
    pdfMoney(doc, "Millas", String(r.totalMiles), 40, 572, y); y += 18;
    pdfMoney(doc, "Total Bruto", money(r.totalBruto), 40, 572, y); y += 18;
    pdfMoney(doc, "Connect Bruto", money(r.connectBruto), 40, 572, y); y += 18;
    pdfMoney(doc, `Ajuste Connect (-${Math.round(settings.connectPct * 100)}%)`, money(r.connectAdjust), 40, 572, y); y += 18;
    pdfMoney(doc, "Total Neto (para reparto)", money(r.totalNeto), 40, 572, y); y += 24;

    // Split
    const driverPct = round2(1 - num(settings.companyPct));
    pdfMoney(doc, `Empresa (${Math.round(settings.companyPct * 100)}%)`, money(r.companyShare), 40, 572, y); y += 18;
    pdfMoney(doc, `Chofer (${Math.round(driverPct * 100)}%)`, money(r.driverShareGross), 40, 572, y); y += 18;
    pdfMoney(doc, `Retención chofer (${Math.round(settings.retentionPct * 100)}%)`, `-${money(r.retention)}`, 40, 572, y); y += 18;
    pdfMoney(doc, "Chofer Neto", money(r.driverShareNet), 40, 572, y); y += 24;

    // Ajustes manuales
    pdfText(doc, "AJUSTES", 40, y, 12, true); y += 14;
    pdfLine(doc, 40, y, 572, y); y += 18;

    pdfMoney(doc, "Gastos", `-${money(r.adjGastos)}`, 40, 572, y); y += 18;
    pdfMoney(doc, "Peajes", `-${money(r.adjPeajes)}`, 40, 572, y); y += 18;
    pdfMoney(doc, "Se le debe (±)", money(r.adjSeDebe), 40, 572, y); y += 24;

    pdfText(doc, "TOTAL FINAL A PAGAR AL CHOFER", 40, y, 12, true);
    pdfText(doc, money(r.driverFinal), 572, y, 14, true);
    doc.text("", 0, 0); // no-op

    // Detalle (mini lista)
    y += 26;
    pdfText(doc, "DETALLE DE SERVICIOS (resumen)", 40, y, 11, true); y += 14;
    pdfLine(doc, 40, y, 572, y); y += 16;

    // Render lineas sin autoTable (simple y estable)
    const maxLines = 18;
    const detail = r.list.slice().sort((a,b)=> (a.fecha > b.fecha ? 1 : -1)).slice(0, maxLines);

    detail.forEach((s) => {
      const line = `${s.fecha} • ${clientName(s.clientId)} • ${s.tipo} • ${round2(s.millas)} mi • ${money(s.monto)}`;
      pdfText(doc, line, 40, y, 10, false);
      y += 14;
    });

    if (r.list.length > maxLines) {
      pdfText(doc, `… +${r.list.length - maxLines} más`, 40, y, 10, false);
    }

    pdfFooter(doc);

    const safeName = driverName(did).replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
    doc.save(`Cierre_${safeName}_${wk}.pdf`);
  });

  // =========================
  // PDF: Factura por cliente (invPrint) — SIEMPRE jsPDF
  // =========================
  $("invPrint")?.addEventListener("click", () => {
    const wk = $("invWeekStart")?.value;
    const cid = $("invClient")?.value;
    if (!wk || !cid) return alert("Selecciona semana y cliente.");

    const list = listWeek(wk, "", cid).slice().sort((a,b)=> (a.fecha < b.fecha ? 1 : -1));
    const bruto = round2(list.reduce((a,s)=>a+num(s.monto),0));

    const isConnect = (clientName(cid).toLowerCase() === "connect");
    const connectAdj = isConnect ? round2(bruto * num(settings.connectPct)) : 0;
    const neto = round2(bruto - connectAdj);

    const doc = pdfNewDoc();
    if (!doc) return;

    // Header
    pdfText(doc, settings.companyName, 40, 50, 16, true);
    pdfText(doc, "FACTURA POR CLIENTE", 40, 72, 12, true);
    pdfLine(doc, 40, 80, 572, 80);

    pdfText(doc, `Semana desde: ${wk}`, 40, 105, 11, false);
    pdfText(doc, `Cliente: ${clientName(cid)}`, 40, 123, 11, false);

    let y = 155;
    pdfText(doc, "DETALLE", 40, y, 11, true); y += 12;
    pdfLine(doc, 40, y, 572, y); y += 16;

    // detalle lineal
    const maxLines = 26;
    const items = list.slice(0, maxLines);
    items.forEach((s) => {
      const line = `${s.fecha} • ${driverName(s.driverId)} • ${s.tipo} • ${round2(s.millas)} mi`;
      pdfText(doc, line, 40, y, 10, false);
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      doc.text(money(s.monto), 572, y, { align: "right" });
      y += 14;
    });

    if (list.length > maxLines) {
      pdfText(doc, `… +${list.length - maxLines} más`, 40, y, 10, false);
      y += 16;
    } else {
      y += 8;
    }

    pdfLine(doc, 40, y, 572, y); y += 18;

    pdfMoney(doc, "Total Bruto", money(bruto), 40, 572, y); y += 18;
    if (isConnect) {
      pdfMoney(doc, `Ajuste Connect (-${Math.round(settings.connectPct * 100)}%)`, `-${money(connectAdj)}`, 40, 572, y);
      y += 18;
    }
    pdfMoney(doc, "Total a facturar", money(neto), 40, 572, y);

    pdfFooter(doc);

    const safeClient = clientName(cid).replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
    doc.save(`Factura_${safeClient}_${wk}.pdf`);
  });

  // =========================
  // Settings form (persistente)
  // =========================
  function bindSettingsForm() {
    const form = $("settingsForm");
    if (!form) return;

    // Prefill (si existen campos)
    if ($("setCompanyName")) $("setCompanyName").value = settings.companyName;
    if ($("setConnectPct")) $("setConnectPct").value = settings.connectPct;
    if ($("setCompanyPct")) $("setCompanyPct").value = settings.companyPct;
    if ($("setRetentionPct")) $("setRetentionPct").value = settings.retentionPct;
    if ($("setFooter")) $("setFooter").value = settings.footer;

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const companyPct = num($("setCompanyPct")?.value);
      if (companyPct < 0 || companyPct > 1) return alert("Empresa % debe ser entre 0 y 1 (ej 0.30).");

      settings = {
        ...settings,
        companyName: ($("setCompanyName")?.value || settings.companyName).trim(),
        connectPct: num($("setConnectPct")?.value) || 0,
        companyPct: companyPct || 0.30,
        retentionPct: num($("setRetentionPct")?.value) || 0.10,
        footer: ($("setFooter")?.value || settings.footer).trim()
      };

      saveJSON(KEY.SETTINGS, settings);
      if ($("brandName")) $("brandName").textContent = settings.companyName;

      alert("Configuración guardada ✅ (no se borra al refresh)");
      refreshAll();
    });
  }

  // =========================
  // Reset data but keep settings
  // =========================
  $("wipeAll")?.addEventListener("click", () => {
    if (!confirm("Esto borra choferes/clientes/servicios. Configuración se mantiene. ¿Seguro?")) return;

    localStorage.removeItem(KEY.DRIVERS);
    localStorage.removeItem(KEY.CLIENTS);
    localStorage.removeItem(KEY.SERVICES);

    drivers = [];
    clients = loadJSON(KEY.CLIENTS, clients); // se repuebla mínimo abajo
    services = [];

    ensureMinimumData();
    persistAll();
    refreshAll();
  });

  // =========================
  // Seed demo (si tu HTML tiene botón)
  // =========================
  $("seedDemo")?.addEventListener("click", () => {
    if (drivers.length || services.length) return alert("Demo ya cargado o ya tienes data.");

    const d1 = { id: uid(), nombre: "Adolfo Mejía" };
    drivers.push(d1);

    const cConnect = clients.find(c => c.nombre.toLowerCase() === "connect") || clients[0];

    services.push({
      id: uid(),
      fecha: todayISO(),
      driverId: d1.id,
      clientId: cConnect.id,
      tipo: "CONNECT",
      millas: 37,
      monto: 388.00,
      metodoPago: "CASH",
      gastos: 0,
      nota: "Demo"
    });

    persistAll();
    refreshAll();
  });

  // =========================
  // Init / refresh
  // =========================
  function refreshAll() {
    // Brand
    if ($("brandName")) $("brandName").textContent = settings.companyName;

    // selects
    fillSelect($("qsDriver"), drivers);
    fillSelect($("qsClient"), clients);
    fillSelect($("wkDriver"), drivers);
    fillSelect($("invClient"), clients);

    // dates
    if ($("qsDate")) $("qsDate").value = todayISO();
    if ($("wkStart")) $("wkStart").value = mondayOf(todayISO());
    if ($("invWeekStart")) $("invWeekStart").value = mondayOf(todayISO());

    // tables
    renderDrivers();
    renderClients();
    renderRecent();
    renderServicesTable();
    renderKPIs();
  }

  // Bind settings once
  bindSettingsForm();

  // Start on dashboard if navigation exists
  if (document.getElementById("view-dashboard")) {
    show("dashboard");
  } else {
    // fallback
    refreshAll();
  }

})();
