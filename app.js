const form = document.getElementById("serviceForm");
const table = document.getElementById("servicesTable");

form.onsubmit = async e => {
  e.preventDefault();

  const service = {
    fecha: fecha.value,
    chofer: chofer.value,
    cliente: cliente.value,
    monto: Number(monto.value),
    millas: Number(millas.value),
    metodo: metodo.value,
    gastos: Number(gastos.value || 0),
    created: firebase.firestore.FieldValue.serverTimestamp()
  };

  await db.collection("services").add(service);
  form.reset();
};

db.collection("services").orderBy("created","desc").onSnapshot(snap => {
  table.innerHTML = "<tr><th>Fecha</th><th>Chofer</th><th>Cliente</th><th>Monto</th></tr>";
  const servicios = [];
  snap.forEach(doc => {
    const s = doc.data();
    servicios.push(s);
    table.innerHTML += `<tr><td>${s.fecha}</td><td>${s.chofer}</td><td>${s.cliente}</td><td>$${s.monto}</td></tr>`;
  });

  const r = calcularSemana(servicios);
  kpiBruto.textContent = `$${r.bruto.toFixed(2)}`;
  kpiMillas.textContent = r.millas;
  kpiServicios.textContent = servicios.length;
  kpiPorMilla.textContent = `$${(r.totalReal / (r.millas||1)).toFixed(2)}`;
});
