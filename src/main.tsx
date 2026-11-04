import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { initTransport, posteName } from "./lib/transport";
import { startPresence } from "./lib/presence";
import "@fontsource-variable/inter";
import "./styles.css";

// Nouvelle version installée sur le poste serveur pendant qu'un téléphone avait l'ancienne ouverte :
// une page chargée à la demande n'existe plus. On recharge une fois pour prendre la nouvelle version.
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("gm-reloaded") === "1") return;
    sessionStorage.setItem("gm-reloaded", "1");
  } catch {
    /* stockage indisponible : on recharge quand même */
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => setTimeout(() => {
  try {
    sessionStorage.removeItem("gm-reloaded");
  } catch {
    /* stockage indisponible */
  }
}, 10_000));

// Le mode réseau (poste unique / serveur / client / navigateur) est déterminé avant tout affichage.
await initTransport();
// Chaque poste se signale au serveur (liste des postes connectés, état de la liaison).
startPresence(posteName);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>,
);
