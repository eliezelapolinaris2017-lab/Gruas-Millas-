const firebaseConfig = {
  apiKey: "AIzaSyDGoSNKi1wapE1SpHxTc8wNZGGkJ2nQj7s",
  authDomain: "nexus-transport-2887b.firebaseapp.com",
  projectId: "nexus-transport-2887b",
  storageBucket: "nexus-transport-2887b.firebasestorage.app",
  messagingSenderId: "972915419764",
  appId: "1:972915419764:web:7d61dfb03bbe56df867f21"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

document.getElementById("saveBtn").onclick = async () => {
  const data = {
    driver: driver.value,
    date: date.value,
    millas: +millas.value || 0,
    enganche: +enganche.value || 0,
    viales: +viales.value || 0,

    cops: +cops.value || 0,
    aaa: +aaa.value || 0,
    enterprise: +enterprise.value || 0,
    mapfre: +mapfre.value || 0,
    creditos: +creditos.value || 0,
    erika: +erika.value || 0,

    ath: +ath.value || 0,
    salvamentos: +salvamentos.value || 0,
    od: +od.value || 0,
    extracciones: +extracciones.value || 0,

    cashRecibo: +cashRecibo.value || 0,
    cashChofer: +cashChofer.value || 0,
    gastos: +gastos.value || 0,

    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  data.totalServicios =
    data.millas + data.enganche + data.viales +
    data.cops + data.aaa + data.enterprise +
    data.mapfre + data.creditos + data.erika +
    data.ath + data.salvamentos + data.od + data.extracciones;

  data.retencion10 = data.totalServicios * 0.10;
  data.totalPagar = data.totalServicios - data.retencion10;

  await db.collection("transportTickets").add(data);
  alert("Servicio guardado");
};
