import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { useApp } from "./context/AppContext";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import type { Role } from "./types";
import LoginPage from "./pages/Login";
import PinSetupPage from "./pages/PinSetup";
import SetupPage from "./pages/Setup";
import DashboardPage from "./pages/Dashboard";
import PosPage from "./pages/Pos";
import CashierDashboardPage from "./pages/CashierDashboard";
import PostePage from "./pages/Poste";
import ProductsPage from "./pages/Products";
import CategoriesPage from "./pages/Categories";
import StockPage from "./pages/Stock";
import PurchasesPage from "./pages/Purchases";
import SuppliersPage from "./pages/Suppliers";
import CustomersPage from "./pages/Customers";
import SalesPage from "./pages/Sales";
import CashSessionsPage from "./pages/CashSessions";
import ReportsPage from "./pages/Reports";
import UsersPage from "./pages/Users";
import AuditPage from "./pages/Audit";
import SettingsPage from "./pages/Settings";
import FinderPage from "./pages/Finder";
import LocationsPage from "./pages/Locations";
import PaymentsPage from "./pages/Payments";
import PromotionsPage from "./pages/Promotions";
import ReturnsPage from "./pages/Returns";
import CustomerDisplayPage from "./pages/CustomerDisplay";
import LicencePage from "./pages/Licence";
import { useLocation } from "react-router-dom";
import { tl } from "./lib/i18n";

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
  if (location.pathname.startsWith("/display")) return <CustomerDisplayPage />;
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
  if (state === "setup") return <SetupPage onDone={() => setState("ready")} />;
  if (!user) return <LoginPage />;
  // Chaque utilisateur doit avoir un code PIN pour confirmer les actions critiques.
  if (!user.has_pin) return <PinSetupPage />;

  return (
    <Layout>
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
    </Layout>
  );
}
