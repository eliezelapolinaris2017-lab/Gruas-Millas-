function generarPDF(data) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  pdf.text("Nexus Transport - Cierre Semanal", 20, 20);
  pdf.text(`Total Bruto: $${data.bruto}`, 20, 40);
  pdf.text(`Total Real: $${data.totalReal}`, 20, 50);
  pdf.text(`Empresa 30%: $${data.empresa30}`, 20, 60);
  pdf.text(`Chofer Neto: $${data.pagoChofer}`, 20, 70);

  pdf.save("cierre-semanal.pdf");
}
