import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { getNetwork, initTransport, isMobileApp, posteName } from "./lib/transport";
import { startPresence } from "./lib/presence";
import { getLang, loadDictionary } from "./lib/i18n";
import { captureErrors, reportError } from "./lib/errors";
import { loadOfflineHelp } from "./lib/videos";
import { hasAndroidBridge, serverService } from "./lib/android";
import "@fontsource-variable/inter";
import "./styles.css";

// Le programme a été lu par le moteur web : public/compat.js n'affichera pas son message de blocage.
(window as unknown as { __GM_READY__?: boolean }).__GM_READY__ = true;
document.getElementById("gm-compat")?.remove();

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
// (Fonction plutôt qu'« await » au premier niveau : les moteurs d'avant Chrome 89 / iOS 15 ne le lisent pas.)
async function start() {
  // Interface en anglais : dictionnaire chargé avant le premier affichage.
  await Promise.all([initTransport(), getLang() === "en" ? loadDictionary() : Promise.resolve()]);
  // Téléphone serveur (Android) : service permanent, le serveur continue écran verrouillé.
  if (isMobileApp && hasAndroidBridge()) serverService(getNetwork()?.config.mode === "server");
  // Chaque poste se signale au serveur (liste des postes connectés, état de la liaison).
  startPresence(posteName);
  // Aide hors ligne (vidéos, manuel) sur ce poste ou sur le poste serveur.
  void loadOfflineHelp();

  captureErrors();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
    // Écran qui plante : la panne est envoyée à Eden Dev (si la boutique le permet).
    onUncaughtError: (error, info) => {
      console.error(error);
      reportError("react", error, info.componentStack ?? "");
    },
  }).render(
    <React.StrictMode>
      <HashRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </HashRouter>
    </React.StrictMode>,
  );
}
void start();
