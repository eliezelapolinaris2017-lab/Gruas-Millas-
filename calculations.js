function calcularSemana(servicios) {
  let bruto = 0, millas = 0, connect = 0;

  servicios.forEach(s => {
    bruto += s.monto;
    millas += s.millas;
    if (s.cliente === "CONNECT") connect += s.monto;
  });

  const connectNeto = connect * 0.85;
  const totalReal = connectNeto + (bruto - connect);

  const chofer70 = totalReal * 0.7;
  const empresa30 = totalReal * 0.3;
  const retencion = chofer70 * 0.1;
  const pagoChofer = chofer70 - retencion;

  return {
    bruto,
    millas,
    totalReal,
    empresa30,
    chofer70,
    retencion,
    pagoChofer
  };
}
