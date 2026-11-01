import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { initTransport, posteName } from "./lib/transport";
import { startPresence } from "./lib/presence";
import "@fontsource-variable/inter";
import "./styles.css";

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
