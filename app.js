document.getElementById("fecha").textContent =
  new Date().toLocaleDateString("es-PR");

function v(id){
  return Number(document.getElementById(id).value) || 0;
}

function calcular(){
  const ingresos =
    v("millas") +
    v("enganche") +
    v("cash") +
    v("creditos") +
    v("mapfre");

  const ajustes = v("descuento") + v("retencion");
  const gastos = v("gastos");

  const total = ingresos - ajustes - gastos;

  document.getElementById("resultado").textContent =
    `$${total.toFixed(2)}`;
}
