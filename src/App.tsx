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

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useApp();
  return can(...roles) ? <>{children}</> : <Navigate to="/" replace />;
}

const MANAGERS: Role[] = ["admin", "manager"];
const ALL: Role[] = ["admin", "manager", "cashier"];
const ADMIN: Role[] = ["admin"];
const CASHIER: Role[] = ["cashier"];

export default function App() {
  // L'écran client (2ᵉ écran, TV) s'affiche sans connexion utilisateur.
  const location = useLocation();
  if (location.pathname.startsWith("/display")) {
    return (
      <Suspense fallback={<Loading />}>
        <CustomerDisplayPage />
      </Suspense>
    );
  }
  return <MainApp />;
}

function MainApp() {
  const { user, setUser } = useApp();
  const [state, setState] = useState<"loading" | "setup" | "ready">("loading");

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
        <SetupPage onDone={() => setState("ready")} />
      </Suspense>
    );
  }
  if (!user) return <LoginPage />;
  // Chaque utilisateur doit avoir un code PIN pour confirmer les actions critiques.
  if (!user.has_pin) return <PinSetupPage />;

  return (
    <Layout>
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
