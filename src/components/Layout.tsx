import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Wallet,
  Package,
  Boxes,
  Truck,
  Factory,
  Users,
  BarChart3,
  UserCog,
  ScrollText,
  Settings as SettingsIcon,
  LogOut,
  KeyRound,
  MapPin,
  ScanSearch,
  Smartphone,
  Moon,
  Sun,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  FolderTree,
  Menu,
  Network,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { ROLE_LABELS } from "../lib/format";
import { BrandLogo } from "./Brand";
import type { Role } from "../types";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { ProductFinderModal } from "./ProductFinder";
import { ConnChip } from "../pages/Poste";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
  /** Libellé court de la barre d'onglets mobile. */
  short?: string;
}

/** Onglets du bas sur téléphone, selon le rôle. */
const MOBILE_TABS: Record<string, string[]> = {
  cashier: ["/pos", "/my-dashboard", "/finder", "/sales"],
  manager: ["/products", "/categories", "/stock", "/finder"],
  admin: ["/dashboard", "/products", "/reports", "/sales"],
};

const M: Role[] = ["admin", "manager"];
const A: Role[] = ["admin", "manager", "cashier"];

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Ventes",
    items: [
      { to: "/dashboard", label: "Tableau de bord", short: "Accueil", icon: <LayoutDashboard size={18} />, roles: ["admin"] },
      { to: "/my-dashboard", label: "Mon tableau de bord", short: "Mes stats", icon: <LayoutDashboard size={18} />, roles: ["cashier"] },
      { to: "/pos", label: "Caisse", icon: <ShoppingCart size={18} />, roles: ["cashier"] },
      { to: "/finder", label: "Localiser un produit", short: "Localiser", icon: <ScanSearch size={18} />, roles: A },
      { to: "/sales", label: "Historique des ventes", short: "Ventes", icon: <Receipt size={18} />, roles: A },
      { to: "/cash", label: "Sessions de caisse", icon: <Wallet size={18} />, roles: A },
      { to: "/customers", label: "Clients", icon: <Users size={18} />, roles: A },
    ],
  },
  {
    title: "Magasin",
    items: [
      { to: "/products", label: "Produits", icon: <Package size={18} />, roles: M },
      { to: "/categories", label: "Catégories", icon: <FolderTree size={18} />, roles: M },
      { to: "/locations", label: "Emplacements", icon: <LayoutGrid size={18} />, roles: M },
      { to: "/stock", label: "Stock & inventaire", short: "Stock", icon: <Boxes size={18} />, roles: M },
      { to: "/purchases", label: "Achats / réceptions", icon: <Truck size={18} />, roles: M },
      { to: "/suppliers", label: "Fournisseurs", icon: <Factory size={18} />, roles: M },
    ],
  },
  {
    title: "Pilotage",
    items: [
      { to: "/reports", label: "Rapports", icon: <BarChart3 size={18} />, roles: ["admin"] },
      { to: "/payments", label: "Paiements mobiles", icon: <Smartphone size={18} />, roles: ["admin"] },
      { to: "/users", label: "Utilisateurs", icon: <UserCog size={18} />, roles: ["admin"] },
      { to: "/audit", label: "Journal d'activité", icon: <ScrollText size={18} />, roles: ["admin"] },
      { to: "/poste", label: "Poste & réseau", icon: <Network size={18} />, roles: ["admin", "manager", "cashier"] },
      { to: "/settings", label: "Paramètres", icon: <SettingsIcon size={18} />, roles: ["admin"] },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, settings, logout, confirm, theme, toggleTheme, finderOpen, setFinderOpen } = useApp();
  const [pwdOpen, setPwdOpen] = useState(false);
  // Téléphone / tablette : menu en tiroir, fermé après chaque navigation.
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  // Menu repliable : replié par défaut pour les caissiers (plus de place pour la caisse).
  const [collapsedPref, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("gm-drawer");
      if (v !== null) return v === "1";
    } catch {
      /* stockage indisponible */
    }
    return user?.role === "cashier";
  });
  // Sur téléphone, le tiroir est toujours affiché en entier (libellés visibles).
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const toggleDrawer = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("gm-drawer", c ? "0" : "1");
      } catch {
        /* stockage indisponible */
      }
      return !c;
    });

  // Ctrl+K (ou Ctrl+F hors champ de saisie) : recherche rapide d'un produit et de son emplacement.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinderOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFinderOpen]);

  if (!user) return null;

  const initials = user.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const collapsed = collapsedPref && !isMobile;
  const allowed = NAV.flatMap((g) => g.items).filter((i) => i.roles.includes(user.role));
  const tabs = (MOBILE_TABS[user.role] ?? []).map((to) => allowed.find((i) => i.to === to)).filter((i): i is NavItem => !!i);
  const current = allowed.find((i) => location.pathname.startsWith(i.to));

  return (
    <div className={`app-shell ${collapsed ? "drawer-collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      {/* Barre du haut (téléphone / tablette) */}
      <header className="mobile-topbar">
        <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={22} /></button>
        <BrandLogo size={30} className="brand-logo" />
        <div className="mobile-title">
          <strong>{current?.label ?? settings.shop_name}</strong>
          <span>{settings.shop_name || "GestiMarket"}</span>
        </div>
        <NavLink to="/poste" className="conn-link mobile-conn" aria-label="Poste & réseau"><ConnChip compact /></NavLink>
        <button className="icon-btn" onClick={() => setFinderOpen(true)} aria-label="Où est le produit ?"><MapPin size={20} /></button>
        <div className={`avatar sm role-${user.role}`} onClick={() => setPwdOpen(true)}>{initials}</div>
      </header>
      <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />
      <aside className="sidebar">
        <button className="icon-btn light mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><X size={20} /></button>
        <div className="brand">
          <BrandLogo size={collapsed ? 40 : 46} className="brand-logo" />
          {!collapsed && (
            <div className="brand-text">
              <div className="brand-name" title={settings.shop_name}>{settings.shop_name || "GestiMarket"}</div>
              <div className="brand-sub">{settings.shop_address || "GestiMarket"}</div>
            </div>
          )}
          <button className="icon-btn light drawer-toggle" onClick={toggleDrawer} title={collapsed ? "Déplier le menu" : "Replier le menu"}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <button className="quick-find" onClick={() => setFinderOpen(true)} title="Où se trouve un produit ? (Ctrl + K)">
          <MapPin size={16} />
          {!collapsed && <><span>Où est le produit ?</span><kbd className="kbd dark">Ctrl K</kbd></>}
        </button>

        <NavLink to="/poste" className="conn-link" title="Poste & réseau : état de la liaison avec le serveur">
          <ConnChip compact={collapsed} />
        </NavLink>

        <nav className="nav">
          {NAV.map((group) => {
            const items = group.items.filter((i) => i.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div key={group.title} className="nav-group">
                <div className="nav-title">{collapsed ? "" : group.title}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} title={i.label} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                    {i.icon}
                    {!collapsed && <span>{i.label}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className={`avatar role-${user.role}`} title={`${user.full_name} — ${ROLE_LABELS[user.role]}`}>{initials}</div>
          {!collapsed && (
            <div className="user-meta">
              <div className="user-name">{user.full_name}</div>
              <div className="user-role">{ROLE_LABELS[user.role]}</div>
            </div>
          )}
          <div className="user-actions">
            <button className="icon-btn light" title={theme === "dark" ? "Thème clair" : "Thème sombre"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="icon-btn light" title="Mon compte : mot de passe et code PIN" onClick={() => setPwdOpen(true)}>
              <KeyRound size={16} />
            </button>
            <button
              className="icon-btn light"
              title="Se déconnecter (changer de caissier)"
              onClick={async () => {
                if (await confirm({ title: "Déconnexion", message: "Voulez-vous vous déconnecter ?", confirmLabel: "Se déconnecter" })) await logout();
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="content">{children}</main>
      {tabs.length > 0 && (
        <nav className="mobile-tabs">
          {tabs.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}>
              {i.icon}
              <span>{i.short ?? i.label}</span>
            </NavLink>
          ))}
          <button className="mobile-tab" onClick={() => setMobileOpen(true)}>
            <Menu size={18} />
            <span>Menu</span>
          </button>
        </nav>
      )}
      {pwdOpen && <ChangePasswordModal onClose={() => setPwdOpen(false)} />}
      {finderOpen && <ProductFinderModal onClose={() => setFinderOpen(false)} />}
    </div>
  );
}
