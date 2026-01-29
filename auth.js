const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");

loginBtn.onclick = () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider);
};

logoutBtn.onclick = () => auth.signOut();

auth.onAuthStateChanged(async user => {
  if (!user) {
    loginView.hidden = false;
    appView.hidden = true;
    return;
  }

  const adminDoc = await db.collection("admins").doc(user.uid).get();
  if (!adminDoc.exists) {
    alert("Acceso denegado");
    auth.signOut();
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
});
