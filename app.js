// ===============================
// Nexus Transport — app.js (v1 fix)
// Requiere: firebase v8 + db (firebase.firestore())
// ===============================

(function(){
  "use strict";

  // ===== DOM =====
  const form  = document.getElementById("serviceForm");
  const table = document.getElementById("servicesTable");

  // Inputs (NO dependas de globals del navegador)
  const $fecha  = document.getElementById("fecha");
  const $chofer = document.getElementById("chofer");
  const $cliente= document.getElementById("cliente");
  const $monto  = document.getElementById("monto");
  const $millas = document.getElementById("millas");
  const $metodo = document.getElementById("metodo");
  const $gastos = document.getElementById("gastos");
  const $nota   = document.getElementById("nota"); // si existe

  // KPIs
  const kpiBruto     = document.getElementById("kpiBruto");
  const kpiMillas    = document.getElementById("kpiMillas");
  const kpiServicios = document.getElementById("kpiServicios");
  const kpiPorMilla  = document.getElementById("kpiPorMilla");

  // ===== Helpers =====
  const money = (n)=> `$${(Number(n)||0).toFixed(2)}`;

  function toDateSafe(v){
    // soporta input type="date" (YYYY-MM-DD) y otros
    if(!v) return null;
    if (typeof v === "string") {
      // YYYY-MM-DD
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfWeekMonday(d){
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay(); // 0=dom
    const diff = (day === 0 ? -6 : 1) - day; // lunes
    x.setDate(x.getDate() + diff);
    x.setHours(0,0,0,0);
    return x;
  }

  function endOfWeekSunday(d){
    const s = startOfWeekMonday(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23,59,59,999);
    return e;
  }

  function calcularSemana(servicios){
    // Semana actual (lunes->domingo) basado en HOY
    const hoy = new Date();
    const ini = startOfWeekMonday(hoy);
    const fin = endOfWeekSunday(hoy);

    let bruto = 0;
    let millas = 0;

    let connectBruto = 0;
    let otros = 0;

    const enSemana = [];

    for (const s of servicios){
      const d = toDateSafe(s.fecha);
      if(!d) continue;
      if(d < ini || d > fin) continue;

      enSemana.push(s);

      const monto = Number(s.monto)||0;
      const mi    = Number(s.millas)||0;
      const cli   = String(s.cliente||"").toUpperCase();

      bruto += monto;
      millas += mi;

      if (cli === "CONNECT") connectBruto += monto;
      else otros += monto;
    }

    // Ajuste CONNECT -15% SOLO a CONNECT
    const connectNeto = connectBruto * 0.85;

    // Total real generado por la grúa esta semana:
    const totalReal = connectNeto + otros;

    return {
      ini, fin,
      serviciosSemana: enSemana.length,
      bruto,
      millas,
      connectBruto,
      connectNeto,
      otros,
      totalReal
    };
  }

  function renderTable(servicios){
    table.innerHTML =
      "<tr><th>Fecha</th><th>Chofer</th><th>Cliente</th><th>Método</th><th>Millas</th><th>Monto</th><th>Gastos</th></tr>";

    for (const s of servicios){
      table.innerHTML += `
        <tr>
          <td>${s.fecha || ""}</td>
          <td>${s.chofer || ""}</td>
          <td>${s.cliente || ""}</td>
          <td>${s.metodo || ""}</td>
          <td>${Number(s.millas||0)}</td>
          <td>${money(s.monto)}</td>
          <td>${money(s.gastos)}</td>
        </tr>`;
    }
  }

  function renderKPIs(servicios){
    const r = calcularSemana(servicios);

    kpiBruto.textContent     = money(r.bruto);
    kpiMillas.textContent    = String(r.millas || 0);
    kpiServicios.textContent = String(r.serviciosSemana || 0);
    kpiPorMilla.textContent  = money(r.totalReal / (r.millas || 1));
  }

  // ===== Guardar servicio =====
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();

    try{
      const service = {
        fecha:  ($fecha?.value || "").trim(),
        chofer: ($chofer?.value || "").trim(),
        cliente: ($cliente?.value || "").trim(),
        metodo: ($metodo?.value || "").trim(),
        monto:  Number($monto?.value || 0),
        millas: Number($millas?.value || 0),
        gastos: Number($gastos?.value || 0),
        nota:   ($nota?.value || "").trim(),
        created: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Validación mínima (evita basura)
      if(!service.fecha || !service.chofer || !service.cliente){
        alert("Faltan datos: fecha / chofer / cliente.");
        return;
      }

      await db.collection("services").add(service);
      form.reset();
    }catch(err){
      console.error("ERROR guardando servicio:", err);
      alert("No se pudo guardar. Revisa permisos/auth en Firebase.");
    }
  });

  // ===== Escucha tiempo real =====
  db.collection("services")
    .orderBy("created", "desc")
    .onSnapshot((snap)=>{
      const servicios = [];
      snap.forEach(doc => servicios.push(doc.data()));

      renderTable(servicios);
      renderKPIs(servicios);
    }, (err)=>{
      console.error("ERROR Firestore onSnapshot:", err);
      alert("Acceso denegado / permisos Firestore. Revisa admins + reglas.");
    });

})();
