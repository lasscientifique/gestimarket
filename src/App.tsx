import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { useApp } from "./context/AppContext";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import type { Role } from "./types";
import LoginPage from "./pages/Login";
import PinSetupPage from "./pages/PinSetup";
import { useLocation } from "react-router-dom";
import { tl } from "./lib/i18n";
import { getNetwork, isMobileApp } from "./lib/transport";
import { isTv } from "./lib/android";
import { startChoice, tvPoste } from "./lib/start";
import { ManualHost } from "./components/ManualHost";
import type { TermsStatus } from "./types";

const TermsGate = lazy(() => import("./components/Terms").then((m) => ({ default: m.TermsGate })));

// Pages chargées à la demande : l'écran de connexion s'affiche vite, même en 4G sur un téléphone ;
// la 3D, les graphiques et le PDF ne sont téléchargés qu'à l'ouverture de leur page.
const SetupPage = lazy(() => import("./pages/Setup"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const PosPage = lazy(() => import("./pages/Pos"));
const CashierDashboardPage = lazy(() => import("./pages/CashierDashboard"));
const PostePage = lazy(() => import("./pages/Poste"));
const ProductsPage = lazy(() => import("./pages/Products"));
const CategoriesPage = lazy(() => import("./pages/Categories"));
const StockPage = lazy(() => import("./pages/Stock"));
const PurchasesPage = lazy(() => import("./pages/Purchases"));
const SuppliersPage = lazy(() => import("./pages/Suppliers"));
const CustomersPage = lazy(() => import("./pages/Customers"));
const SalesPage = lazy(() => import("./pages/Sales"));
const CashSessionsPage = lazy(() => import("./pages/CashSessions"));
const ReportsPage = lazy(() => import("./pages/Reports"));
const UsersPage = lazy(() => import("./pages/Users"));
const AuditPage = lazy(() => import("./pages/Audit"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const FinderPage = lazy(() => import("./pages/Finder"));
const LocationsPage = lazy(() => import("./pages/Locations"));
const PaymentsPage = lazy(() => import("./pages/Payments"));
const PromotionsPage = lazy(() => import("./pages/Promotions"));
const ReturnsPage = lazy(() => import("./pages/Returns"));
const CustomerDisplayPage = lazy(() => import("./pages/CustomerDisplay"));
const LicencePage = lazy(() => import("./pages/Licence"));
// Application installée (téléphone, tablette, TV) : premier démarrage, Espace propriétaire, écran client de la TV.
const MobileStartPage = lazy(() => import("./pages/MobileStart"));
const OwnerHubPage = lazy(() => import("./pages/OwnerHub"));
const TvSetupPage = lazy(() => import("./pages/TvSetup"));

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useApp();
  return can(...roles) ? <>{children}</> : <Navigate to="/" replace />;
}

const MANAGERS: Role[] = ["admin", "manager"];
const ALL: Role[] = ["admin", "manager", "cashier"];
const ADMIN: Role[] = ["admin"];
const CASHIER: Role[] = ["cashier"];

export default function App() {
  return (
    <>
      <Screens />
      <ManualHost />
    </>
  );
}

function Screens() {
  // L'écran client (2ᵉ écran, TV) s'affiche sans connexion utilisateur.
  const location = useLocation();
  if (location.pathname.startsWith("/display")) {
    return (
      <Suspense fallback={<Loading />}>
        <CustomerDisplayPage />
      </Suspense>
    );
  }
  // Espace propriétaire : compte Eden Dev, boutiques à distance, abonnements (sans connexion à une boutique).
  if (location.pathname.startsWith("/proprietaire")) {
    return (
      <Suspense fallback={<Loading />}>
        <OwnerHubPage />
      </Suspense>
    );
  }
  // TV Android : écran client de la caisse choisie, ou choix de la boutique et de la caisse.
  if (isMobileApp && (location.pathname.startsWith("/tv") || isTv())) {
    const poste = tvPoste();
    if (poste && getNetwork()?.config.mode === "client" && !location.pathname.startsWith("/tv")) {
      return <Navigate to={`/display?poste=${encodeURIComponent(poste)}`} replace />;
    }
    return (
      <Suspense fallback={<Loading />}>
        <TvSetupPage />
      </Suspense>
    );
  }
  return <MainApp />;
}

function MainApp() {
  const { user, setUser } = useApp();
  const [state, setState] = useState<"loading" | "setup" | "ready">("loading");
  // Application installée : la boutique sera-t-elle sur ce téléphone ? (sinon : choix au premier démarrage)
  const [localChosen, setLocalChosen] = useState(() => !isMobileApp || startChoice() === "local");
  // Administrateur : conditions d'utilisation de la version actuelle acceptées au nom de la boutique ?
  const [terms, setTerms] = useState<TermsStatus | null>(null);
  useEffect(() => {
    if (user?.role !== "admin" || !user.has_pin) return setTerms(null);
    api.termsStatus().then(setTerms).catch(() => setTerms(null));
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        if (await api.needsSetup()) {
          setState("setup");
          return;
        }
        setUser(await api.currentUser());
      } catch {
        // Serveur injoignable (poste client) : l'écran de connexion propose de changer de serveur.
      }
      setState("ready");
    })();
  }, [setUser]);

  if (state === "loading") return <Loading label={tl("Démarrage de GestiMarket…")} />;
  if (state === "setup") {
    return (
      <Suspense fallback={<Loading />}>
        {localChosen ? <SetupPage onDone={() => setState("ready")} /> : <MobileStartPage onLocal={() => setLocalChosen(true)} />}
      </Suspense>
    );
  }
  if (!user) return <LoginPage />;
  // Chaque utilisateur doit avoir un code PIN pour confirmer les actions critiques.
  if (!user.has_pin) return <PinSetupPage />;

  return (
    <Layout>
      {terms && !terms.up_to_date && (
        <Suspense fallback={null}>
          <TermsGate status={terms} onDone={() => setTerms({ ...terms, up_to_date: true })} />
        </Suspense>
      )}
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Navigate to={user.role === "admin" ? "/dashboard" : user.role === "manager" ? "/products" : "/pos"} replace />} />
        <Route path="/dashboard" element={<Guard roles={ADMIN}><DashboardPage /></Guard>} />
        <Route path="/pos" element={<Guard roles={CASHIER}><PosPage /></Guard>} />
        <Route path="/poste" element={<Guard roles={ALL}><PostePage /></Guard>} />
        <Route path="/my-dashboard" element={<Guard roles={CASHIER}><CashierDashboardPage /></Guard>} />
        <Route path="/finder" element={<Guard roles={ALL}><FinderPage /></Guard>} />
        <Route path="/locations" element={<Guard roles={MANAGERS}><LocationsPage /></Guard>} />
        <Route path="/payments" element={<Guard roles={ADMIN}><PaymentsPage /></Guard>} />
        <Route path="/sales" element={<Guard roles={ALL}><SalesPage /></Guard>} />
        <Route path="/cash" element={<Guard roles={ALL}><CashSessionsPage /></Guard>} />
        <Route path="/returns" element={<Guard roles={ALL}><ReturnsPage /></Guard>} />
        <Route path="/promotions" element={<Guard roles={["admin", "manager"]}><PromotionsPage /></Guard>} />
        <Route path="/customers" element={<Guard roles={ALL}><CustomersPage /></Guard>} />
        <Route path="/products" element={<Guard roles={MANAGERS}><ProductsPage /></Guard>} />
        <Route path="/categories" element={<Guard roles={MANAGERS}><CategoriesPage /></Guard>} />
        <Route path="/stock" element={<Guard roles={MANAGERS}><StockPage /></Guard>} />
        <Route path="/purchases" element={<Guard roles={MANAGERS}><PurchasesPage /></Guard>} />
        <Route path="/suppliers" element={<Guard roles={MANAGERS}><SuppliersPage /></Guard>} />
        <Route path="/reports" element={<Guard roles={ADMIN}><ReportsPage /></Guard>} />
        <Route path="/users" element={<Guard roles={ADMIN}><UsersPage /></Guard>} />
        <Route path="/audit" element={<Guard roles={ADMIN}><AuditPage /></Guard>} />
        <Route path="/settings" element={<Guard roles={ADMIN}><SettingsPage /></Guard>} />
        <Route path="/licence" element={<Guard roles={ADMIN}><LicencePage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}
