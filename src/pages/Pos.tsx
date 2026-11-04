import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search,
  Minus,
  Plus,
  Trash2,
  UserPlus,
  UserRound,
  X,
  Banknote,
  Smartphone,
  CreditCard,
  HandCoins,
  CircleEllipsis,
  Printer,
  Percent,
  ScanBarcode,
  Lock,
  PauseCircle,
  History,
  MapPin,
  Check,
  Wallet,
  MonitorSmartphone,
  Keyboard,
  ChevronRight,
  ArrowLeft,
  Package,
  Camera,
  Users,
  Eye,
  HandHelping,
  Ticket,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, Field, LocationBadge, Modal, Thumb } from "../components/ui";
import { OpenSessionModal } from "../components/CashModals";
import { operatorTheme, PaymentQr } from "../components/OrangeMoneyQr";
import { operatorOf, parseOperators } from "../lib/mobile";
import { HelpTip, PageHelpButton } from "../components/Help";
import { NumPad } from "../components/PinPad";
import { CameraScanner } from "../components/CameraScanner";
import { openCustomerDisplay } from "../components/CustomerDisplayPanel";
import { posteId } from "../lib/presence";
import { locationText, currencyDecimals, currencySymbol, minorToInput, money, parseNumber, paymentLabel, qty, toMinor } from "../lib/format";
import { printReceipt } from "../lib/receipt";
import { afterSalePrint } from "../lib/printer";
import { IDLE_DISPLAY, publishDisplay, type DisplayLine } from "../lib/display";
import { isTauri, posteName } from "../lib/transport";
import type { CashSession, Category, CreditNote, Customer, LiveCart, LiveCartContent, Packaging, PaymentInput, PaymentMethod, Product, QuoteLine, Sale } from "../types";
import { locale, tl } from "../lib/i18n";

interface CartLine {
  product: Product;
  /** Conditionnement vendu (carton, sac…) ; null = unité de base. */
  packaging: Packaging | null;
  quantity: number;
  discount: number;
  /** Prix calculé par le serveur : gros (quantité, client grossiste) ou promotion du jour. */
  quoted?: QuoteLine | null;
}

/** Exemple de code d'avoir (champ de saisie en caisse). */
const CREDIT_NOTE_EXAMPLE = "AV20261103-0001-K7QM";

/** Prix, libellé et nombre d'unités de base d'une ligne (produit à l'unité ou conditionnement). */
const linePrice = (l: { product: Product; packaging: Packaging | null; quoted?: QuoteLine | null }) =>
  l.quoted?.unit_price ?? l.packaging?.sale_price ?? l.product.sale_price;
const lineUnit = (l: { product: Product; packaging: Packaging | null }) => l.packaging?.name ?? l.product.unit;
const lineFactor = (l: { packaging: Packaging | null }) => l.packaging?.quantity ?? 1;
const lineName = (l: { product: Product; packaging: Packaging | null }) => (l.packaging ? `${l.product.name} — ${l.packaging.name}` : l.product.name);
const sameLine = (l: CartLine, p: Product, k: Packaging | null) => l.product.id === p.id && (l.packaging?.id ?? null) === (k?.id ?? null);

interface HeldTicket {
  id: number;
  at: string;
  label: string;
  lines: { product_id: number; packaging_id?: number | null; quantity: number; discount: number }[];
  customer: Customer | null;
  discount: number;
  total: number;
}

const lineGross = (l: CartLine) => Math.round(l.quantity * linePrice(l));
const lineTotal = (l: CartLine) => lineGross(l) - Math.min(l.discount, lineGross(l));

/** Numéro unique d'un ticket : la même vente renvoyée après une coupure n'est enregistrée qu'une fois.
 *  `crypto.getRandomValues` fonctionne aussi en HTTP simple (téléphones du réseau du magasin). */
function newTicketRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${posteId()}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 80);
}

const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

function loadHeld(key: string): HeldTicket[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

export default function PosPage() {
  const { settings, toast, user, askPin } = useApp();

  /** Confirmation par PIN d'une action sensible en caisse (niveau réglable dans Paramètres → Sécurité). */
  const guard = async (_kind: "void", title: string, action: string) => {
    const level = settings.pin_void_level || "cashier";
    return !!(await askPin({ title, action, level: level as "cashier" | "manager" | "admin" }));
  };
  // Remises : jusqu'au seuil sans validation ; au-delà, PIN d'un responsable (le serveur le contrôle aussi).
  const freePercent = Math.min(100, Math.max(0, Number(settings.discount_free_percent ?? "5") || 0));
  const discountLevel = (settings.pin_discount_level || "manager") as "cashier" | "manager" | "admin";
  const canApproveDiscount = (ROLE_LEVEL[user?.role ?? "cashier"] ?? 1) >= (ROLE_LEVEL[discountLevel] ?? 2);
  const overDiscountLimit = (allDiscount: number, gross: number) => allDiscount > 0 && allDiscount * 100 > freePercent * gross;
  const requireSession = settings.require_cash_session !== "0";
  /** Demande le PIN d'un responsable si la remise totale du ticket dépasse le seuil (sinon rien). */
  const approveDiscount = async (allDiscount: number, gross: number, what: string): Promise<boolean> => {
    if (!overDiscountLimit(allDiscount, gross) || canApproveDiscount || (discountPin && allDiscount <= discountPin.upTo)) return true;
    const pct = gross > 0 ? Math.round((allDiscount * 1000) / gross) / 10 : 0;
    const pin = await askPin({
      title: tl("Valider la remise"),
      message: tl("{0} : {1} % du ticket, au-delà des {2} % autorisés. Un responsable valide avec son code PIN.", [what, String(pct).replace(".", ","), freePercent]),
      level: discountLevel,
    });
    if (!pin) return false;
    setDiscountPin({ pin, upTo: allDiscount });
    return true;
  };
  const allowNegative = settings.allow_negative_stock === "1";
  const heldKey = `gm-held-${user?.id ?? 0}`;

  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState(0);
  const [held, setHeld] = useState<HeldTicket[]>(() => loadHeld(heldKey));
  const [modal, setModal] = useState<null | "open" | "customer" | "pay" | "discount" | "held" | { line: number }>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** PIN du responsable qui a validé la remise du ticket en cours (envoyé avec la vente), et jusqu'à quel montant. */
  const [discountPin, setDiscountPin] = useState<{ pin: string; upTo: number } | null>(null);
  const [ticketRef, setTicketRef] = useState(newTicketRef);
  // Nouveau contenu = nouveau numéro ; le même ticket renvoyé tel quel garde le sien.
  useEffect(() => setTicketRef(newTicketRef()), [cart, discount, customer]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + lineTotal(l), 0), [cart]);
  const total = Math.max(0, subtotal - Math.min(discount, subtotal));
  const tax = useMemo(() => {
    const t = cart.reduce((s, l) => {
      const r = l.product.tax_rate;
      return s + (r > 0 ? (lineTotal(l) * r) / (100 + r) : 0);
    }, 0);
    return subtotal > 0 ? Math.round((t * total) / subtotal) : 0;
  }, [cart, subtotal, total]);
  const itemsCount = cart.reduce((s, l) => s + l.quantity, 0);
  // Navigation dans l'arbre des catégories (catégories visibles uniquement) : fil d'Ariane + enfants.
  const visible = categories.filter((c) => c.active);
  const current = visible.find((c) => c.id === categoryId) ?? null;
  const breadcrumb: Category[] = [];
  for (let c = current; c; c = c.parent_id !== null ? visible.find((x) => x.id === c!.parent_id) ?? null : null) breadcrumb.unshift(c);
  const children = visible.filter((c) => c.parent_id === (current?.id ?? null));
  // Catégorie sans sous-catégorie : on garde ses sœurs affichées.
  const stripParent = current && children.length === 0 ? current.parent_id : current?.id ?? null;
  const strip = children.length ? children : visible.filter((c) => c.parent_id === stripParent);
  const [packChoice, setPackChoice] = useState<Product | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  /** Téléphone : le ticket s'ouvre en plein écran par-dessus les produits. */
  const [ticketOpen, setTicketOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [othersCount, setOthersCount] = useState(0);
  /** Unités de base déjà au panier pour ce produit (toutes lignes confondues). */
  const baseInCart = (productId: number, except = -1) =>
    cart.reduce((s, l, i) => (l.product.id === productId && i !== except ? s + l.quantity * lineFactor(l) : s), 0);
  const [displayOpen, setDisplayOpen] = useState(false);

  // ───── Écran client : le panier est envoyé à chaque modification ─────
  const displayLines: DisplayLine[] = useMemo(
    () =>
      cart.map((l) => ({
        name: lineName(l),
        quantity: l.quantity,
        unit: lineUnit(l),
        unit_price: linePrice(l),
        discount: Math.min(l.discount, lineGross(l)),
        total: lineTotal(l),
        image_id: l.product.image_id,
      })),
    [cart],
  );
  const cartDisplay = {
    lines: displayLines,
    items_count: itemsCount,
    subtotal,
    discount: Math.min(discount, subtotal),
    total,
    customer: customer?.name ?? null,
  };
  useEffect(() => {
    if (modal === "pay" || lastSale) return;
    publishDisplay(cart.length ? { status: "cart", ...cartDisplay } : IDLE_DISPLAY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayLines, discount, customer, modal, lastSale]);

  // ───── Ticket partagé : les autres caissiers peuvent le suivre et le reprendre ─────
  const liveContent: LiveCartContent = useMemo(
    () => ({
      lines: cart.map((l) => ({
        product_id: l.product.id,
        packaging_id: l.packaging?.id ?? null,
        name: lineName(l),
        unit: lineUnit(l),
        quantity: l.quantity,
        unit_price: linePrice(l),
        discount: l.discount,
        total: lineTotal(l),
      })),
      customer,
      discount: Math.min(discount, subtotal),
      total,
      items: itemsCount,
    }),
    [cart, customer, discount, subtotal, total, itemsCount],
  );
  const quoteKey = JSON.stringify([customer?.id ?? null, cart.map((l) => [l.product.id, l.packaging?.id ?? null, l.quantity])]);
  useEffect(() => {
    if (!cart.length) return;
    const items = cart.map((l) => ({ product_id: l.product.id, packaging_id: l.packaging?.id ?? null, quantity: l.quantity }));
    const t = setTimeout(() => {
      api
        .saleQuote(items, customer?.id ?? null)
        .then((quotes) =>
          setCart((c) =>
            c.map((l, i) => {
              const q = quotes[i];
              return q && q.product_id === l.product.id && (q.packaging_id ?? null) === (l.packaging?.id ?? null) ? { ...l, quoted: q } : l;
            }),
          ),
        )
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const liveRef = useRef({ content: liveContent, status: "cart" });
  liveRef.current = { content: liveContent, status: modal === "pay" ? "payment" : "cart" };
  const pushLive = useCallback(async () => {
    try {
      const { content, status } = liveRef.current;
      const r = await api.liveCartUpdate(posteId(), posteName(), content, status);
      if (r.taken_by && content.lines.length) {
        // Un collègue a repris ce client : le ticket est retiré de cette caisse.
        setCart([]);
        setCustomer(null);
        setDiscount(0);
        setModal(null);
        setTicketOpen(false);
        toast.info(tl("{0} a repris ce client sur sa caisse : le ticket a été retiré d'ici.", [r.taken_by]));
      }
    } catch {
      /* hors ligne : on réessaie au prochain envoi */
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(pushLive, 350);
    return () => clearTimeout(t);
  }, [liveContent, modal, pushLive]);
  useEffect(() => {
    const t = setInterval(() => {
      pushLive();
      api.liveCarts(posteId()).then((l) => setOthersCount(l.length)).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [pushLive]);

  /** Reprise du client d'un collègue : son ticket arrive ici, prêt à encaisser. */
  const takeOver = async (c: LiveCart) => {
    const pin = await askPin({ title: tl("Reprendre le client de {0}", [c.user_name]), action: `Reprise du ticket de ${c.poste}`, level: "cashier" });
    if (!pin) return;
    try {
      const taken = await api.liveCartTake(c.poste_id, pin);
      const lines: CartLine[] = [];
      for (const l of taken.cart.lines) {
        const product = await api.getProduct(l.product_id);
        const packaging = l.packaging_id ? product.packagings.find((k) => k.id === l.packaging_id) ?? null : null;
        lines.push({ product, packaging, quantity: l.quantity, discount: l.discount });
      }
      if (cart.length) holdCurrent();
      setCart(lines);
      setCustomer(taken.cart.customer);
      setDiscount(taken.cart.discount);
      setOthersOpen(false);
      toast.success(tl("Client de {0} ({1}) repris : {2} ligne(s), {3}.", [taken.user_name, taken.poste, lines.length, money(taken.total)]));
    } catch (e) {
      toast.error(e);
    }
  };

  const toggleDisplay = async () => {
    try {
      setDisplayOpen(await openCustomerDisplay(null));
    } catch (e) {
      toast.error(e);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(heldKey, JSON.stringify(held));
    } catch {
      /* stockage indisponible */
    }
  }, [held, heldKey]);

  // ───── Chargements ─────
  const loadSession = useCallback(() => api.currentCashSession().then(setSession).catch(toast.error), [toast]);

  useEffect(() => {
    loadSession();
    api.listCategories().then(setCategories).catch(toast.error);
  }, [loadSession, toast]);

  const loadProducts = useCallback(() => {
    const term = search.includes("*") ? search.split("*")[1] : search;
    // Une recherche texte porte sur tout le catalogue ; sans recherche, on affiche la catégorie ouverte.
    api.listProducts({ search: term, category_id: term.trim() ? null : categoryId, limit: 80 }).then(setProducts).catch(toast.error);
  }, [search, categoryId, toast]);

  useEffect(() => {
    const t = setTimeout(loadProducts, 150);
    return () => clearTimeout(t);
  }, [loadProducts]);

  // ───── Raccourcis clavier ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setModal("customer");
      } else if (e.key === "F8") {
        e.preventDefault();
        setModal("held");
      } else if (e.key === "F9" || e.key === "F12") {
        e.preventDefault();
        if (cart.length) setModal("pay");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  // ───── Panier ─────
  const addToCart = (p: Product, quantity = 1, packaging: Packaging | null = null) => {
    const need = baseInCart(p.id) + quantity * (packaging?.quantity ?? 1);
    if (p.track_stock && !allowNegative && need > p.stock + 1e-9) {
      toast.error(tl("Stock insuffisant pour « {0} » (disponible : {1} {2}).", [p.name, qty(p.stock), p.unit]));
      return;
    }
    setCart((c) => {
      const i = c.findIndex((l) => sameLine(l, p, packaging));
      if (i >= 0) {
        const copy = [...c];
        copy[i] = { ...copy[i], quantity: +(copy[i].quantity + quantity).toFixed(3) };
        return copy;
      }
      return [...c, { product: p, packaging, quantity, discount: 0 }];
    });
  };

  /** Toucher une vignette : si le produit a des conditionnements, on demande lequel. */
  const onTile = (p: Product) => {
    if (p.packagings.length > 0) setPackChoice(p);
    else addToCart(p);
  };

  const setLineQty = async (index: number, q: number) => {
    if (!(q > 0)) return removeLine(index);
    const p = cart[index].product;
    if (q < cart[index].quantity && !(await guard("void", tl("Diminuer la quantité"), tl("Diminution de quantité : {0} ({1} → {2})", [lineName(cart[index]), qty(cart[index].quantity), qty(q)])))) return;
    if (p.track_stock && !allowNegative && baseInCart(p.id, index) + q * lineFactor(cart[index]) > p.stock + 1e-9) {
      toast.error(tl("Stock insuffisant (disponible : {0} {1}).", [qty(p.stock), p.unit]));
      return;
    }
    setCart((c) => c.map((l, i) => (i === index ? { ...l, quantity: +q.toFixed(3) } : l)));
  };

  const removeLine = async (index: number) => {
    const l = cart[index];
    if (!l || !(await guard("void", tl("Retirer l'article"), tl("Suppression d'article : {0} × {1}", [lineName(l), qty(l.quantity)])))) return;
    setCart((c) => c.filter((_, i) => i !== index));
  };

  const resetSale = () => {
    setTicketOpen(false);
    setCart([]);
    setCustomer(null);
    setDiscount(0);
    setDiscountPin(null);
    setSearch("");
    searchRef.current?.focus();
  };

  // ───── Tickets en attente ─────
  const holdCurrent = () => {
    if (!cart.length) return;
    const ticket: HeldTicket = {
      id: Date.now(),
      at: new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }),
      label: customer?.name ?? tl("Ticket {0}", [held.length + 1]),
      lines: cart.map((l) => ({ product_id: l.product.id, packaging_id: l.packaging?.id ?? null, quantity: l.quantity, discount: l.discount })),
      customer,
      discount,
      total,
    };
    setHeld((h) => [...h, ticket]);
    resetSale();
    toast.info(tl("Ticket mis en attente (F8 pour le reprendre)."));
  };

  const recall = async (t: HeldTicket) => {
    try {
      const lines: CartLine[] = [];
      for (const l of t.lines) {
        const product = await api.getProduct(l.product_id);
        const packaging = l.packaging_id ? product.packagings.find((k) => k.id === l.packaging_id) ?? null : null;
        lines.push({ product, packaging, quantity: l.quantity, discount: l.discount });
      }
      if (cart.length) holdCurrent();
      setHeld((h) => h.filter((x) => x.id !== t.id));
      setCart(lines);
      setCustomer(t.customer);
      setDiscount(t.discount);
      setModal(null);
    } catch (e) {
      toast.error(e);
    }
  };

  /** Validation de la recherche (Entrée) : code-barres exact, puis résultat unique. Syntaxe « 3*code » pour la quantité. */
  const onSearchEnter = async () => {
    if (await addByCode(search)) setSearch("");
  };

  /** Ajoute l'article correspondant à un code (code-barres produit ou conditionnement, QR code, référence). */
  const addByCode = async (input: string): Promise<boolean> => {
    const raw = input.trim();
    if (!raw) return false;
    let quantity = 1;
    let code = raw;
    const m = raw.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
    if (m) {
      quantity = parseNumber(m[1]);
      code = m[2].trim();
    }
    try {
      const r = await api.scanCode(code);
      if (r) {
        addToCart(r.product, quantity, r.packaging);
        return true;
      }
      if (input === search && products.length === 1) {
        onTile(products[0]);
        return true;
      }
      if (input !== search || products.length === 0) toast.error(tl("Aucun produit avec le code « {0} ».", [code]));
    } catch (e) {
      toast.error(e);
    }
    return false;
  };

  const sessionMissing = requireSession && session === null;

  return (
    <div className={`pos ${ticketOpen ? "ticket-open" : ""} ${sessionMissing ? "session-missing" : ""}`}>
      {/* ───── Colonne produits ───── */}
      <section className="pos-products">
        <div className="pos-search">
          <div className="search-box big">
            <ScanBarcode size={20} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearchEnter()}
              placeholder={tl("Scanner un code-barres ou rechercher un produit… (F2)")}
              autoFocus
            />
            {search && (
              <button className="icon-btn" onClick={() => setSearch("")} aria-label={tl("Effacer")}>
                <X size={16} />
              </button>
            )}
          </div>
          <div className="pos-tools">
            <button className="btn btn-square btn-camera" onClick={() => setCameraOpen(true)} title={tl("Scanner avec la caméra (téléphone, tablette, webcam)")}>
              <Camera size={19} />
            </button>
            <button className="btn btn-square" onClick={() => setCodeOpen(true)} title={tl("Saisir un code-barres au clavier (code illisible)")}>
              <Keyboard size={19} />
            </button>
            <button className="btn btn-square" onClick={() => setModal("held")} title={tl("Tickets en attente (F8)")}>
              <History size={19} />
              {held.length > 0 && <span className="count-pill">{held.length}</span>}
            </button>
            <button className="btn btn-square" onClick={() => setOthersOpen(true)} title={tl("Autres caisses : suivre un collègue et reprendre son client")}>
              <Users size={19} />
              {othersCount > 0 && <span className="count-pill">{othersCount}</span>}
            </button>
            <button className={`btn btn-square ${displayOpen && isTauri ? "btn-active" : ""}`} onClick={toggleDisplay} title={tl("Écran client : afficher le panier au client (2ᵉ écran, TV, tablette)")}>
              <MonitorSmartphone size={19} />
            </button>
            <PageHelpButton page="pos" />
          </div>
        </div>

        {breadcrumb.length > 0 && (
          <div className="crumbs">
            <button className="chip" onClick={() => setCategoryId(null)}><Wallet size={14} />  {tl("Tous")}</button>
            {breadcrumb.map((c) => (
              <span key={c.id} className="crumb">
                <ChevronRight size={14} className="muted" />
                <button className={`chip ${c.id === categoryId ? "active" : ""}`} onClick={() => setCategoryId(c.id)}>{c.name}</button>
              </span>
            ))}
          </div>
        )}
        <div className="cat-strip">
          {breadcrumb.length === 0 && (
            <button className="cat-card active" onClick={() => setCategoryId(null)}>
              <span className="cat-card-img all"><Wallet size={18} /></span>
              <span>{tl("Tous")}</span>
            </button>
          )}
          {breadcrumb.length > 0 && (
            <button className="cat-card" onClick={() => setCategoryId(breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2].id : null)}>
              <span className="cat-card-img all"><ArrowLeft size={18} /></span>
              <span>{tl("Retour")}</span>
            </button>
          )}
          {strip.map((c) => (
            <button
              key={c.id}
              className={`cat-card ${categoryId === c.id ? "active" : ""}`}
              onClick={() => setCategoryId(c.id)}
              style={{ ["--cat" as string]: c.color }}
              title={c.path}
            >
              <Thumb imageId={c.image_id} name={c.name} color={c.color} size={34} rounded={10} />
              <span>
                {c.name}
                {c.children_count > 0 && <ChevronRight size={12} className="cat-more" />}
              </span>
            </button>
          ))}
        </div>

        <div className="product-grid">
          {products.map((p) => {
            const out = p.track_stock && p.stock <= 0;
            return (
              <button key={p.id} className={`product-tile ${out ? "out" : ""}`} onClick={() => onTile(p)}>
                <div className="tile-img">
                  <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={1000} rounded={0} />
                  {p.bloc && (
                    <span className="tile-loc">
                      <MapPin size={10} /> {locationText(p, true)}
                    </span>
                  )}
                  {out && <span className="tile-out">{tl("Rupture")}</span>}
                  {p.packagings.length > 0 && (
                    <span className="tile-pack"><Package size={10} /> {p.packagings.length + 1} formats</span>
                  )}
                </div>
                <div className="tile-body">
                  <span className="tile-name">{p.name}</span>
                  <div className="tile-foot">
                    <span className="tile-price">{money(p.sale_price)}</span>
                    <span className={`tile-stock ${out ? "danger" : p.stock <= p.min_stock ? "warning" : ""}`}>
                      {p.track_stock ? `${qty(p.stock)} ${p.unit}` : "∞"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
          {products.length === 0 && (
            <div className="empty" style={{ gridColumn: "1 / -1" }}>
              <Search size={32} strokeWidth={1.5} />
              <strong>{tl("Aucun produit")}</strong>
              <span className="muted">{tl("Modifiez la recherche ou ajoutez des produits dans le catalogue.")}</span>
            </div>
          )}
        </div>
      </section>

      {/* ───── Barre du bas sur téléphone : ticket et encaissement ───── */}
      <div className="pos-mobile-bar">
        <button className="pmb-ticket" onClick={() => setTicketOpen(true)}>
          <span className="pmb-count">{cart.length}</span>
          <span className="pmb-text">
            <strong>{tl("Ticket")}</strong>
            <span>{qty(itemsCount)}  {tl("article(s)")}</span>
          </span>
        </button>
        <button className="btn btn-primary pmb-pay" disabled={!cart.length} onClick={() => setModal("pay")}>
          {tl("Encaisser")} <strong>{money(total)}</strong>
        </button>
      </div>

      {/* ───── Colonne ticket ───── */}
      <section className="pos-ticket">
        <div className="ticket-head">
          <button className="icon-btn ticket-close" onClick={() => setTicketOpen(false)} aria-label={tl("Retour aux produits")}>
            <ArrowLeft size={20} />
          </button>
          <button className="customer-btn" onClick={() => setModal("customer")}>
            {customer ? <UserRound size={18} /> : <UserPlus size={18} />}
            <div>
              <div className="cb-title">{customer ? customer.name : tl("Client de passage")}</div>
              <div className="cb-sub">
                {customer
                  ? `${customer.phone ?? ""}${customer.balance > 0 ? ` · Dette : ${money(customer.balance)}` : ""}`
                  : tl("Associer un client (F4)")}
              </div>
            </div>
          </button>
          {customer && (
            <button className="icon-btn" onClick={() => setCustomer(null)} title={tl("Retirer le client")}>
              <X size={16} />
            </button>
          )}
        </div>

        <div className="ticket-lines">
          {cart.length === 0 && (
            <div className="empty">
              <ScanBarcode size={36} strokeWidth={1.5} />
              <strong>{tl("Ticket vide")}</strong>
              <span className="muted">{tl("Scannez ou touchez un produit pour l'ajouter.")}</span>
            </div>
          )}
          {cart.map((l, i) => (
            <div key={`${l.product.id}-${l.packaging?.id ?? 0}`} className="line">
              <Thumb imageId={l.product.image_id} name={l.product.name} color={l.product.category_color} size={38} />
              <button className="line-info" onClick={() => setModal({ line: i })} title={tl("Modifier la ligne")}>
                <span className="line-name">{l.product.name}</span>
                <span className="line-sub">
                  {l.packaging && <Badge tone="info"><Package size={11} /> {l.packaging.name}</Badge>}
                  {l.quoted?.kind === "promo" && <Badge tone="success">{l.quoted.promotion_name ?? tl("Promo")}</Badge>}
                  {l.quoted?.kind === "wholesale" && <Badge tone="info">{tl("Gros")}</Badge>}
                  {l.quoted && l.quoted.kind !== "retail" && <s className="muted">{money(l.quoted.regular_price, false)}</s>}
                  {money(linePrice(l))} / {lineUnit(l)}
                  {l.discount > 0 && <Badge tone="warning">-{money(l.discount)}</Badge>}
                </span>
              </button>
              <div className="qty-ctrl">
                <button onClick={() => setLineQty(i, +(l.quantity - 1).toFixed(3))} aria-label={tl("Moins")}>
                  <Minus size={14} />
                </button>
                <input value={qty(l.quantity)} readOnly onClick={() => setModal({ line: i })} title={tl("Modifier la quantité")} />
                <button onClick={() => setLineQty(i, +(l.quantity + 1).toFixed(3))} aria-label={tl("Plus")}>
                  <Plus size={14} />
                </button>
              </div>
              <div className="line-total">{money(lineTotal(l), false)}</div>
              <button className="icon-btn danger" onClick={() => removeLine(i)} aria-label={tl("Supprimer")}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="ticket-totals">
          <div className="kv"><span>{tl("Articles")}</span><span>{qty(itemsCount)}</span></div>
          <div className="kv"><span>{tl("Sous-total")}</span><span>{money(subtotal)}</span></div>
          <div className="kv">
            <button className="link-btn" onClick={() => setModal("discount")} disabled={!cart.length}>
              <Percent size={14} />  {tl("Remise")}</button>
            <span>{discount > 0 ? `-${money(Math.min(discount, subtotal))}` : "—"}</span>
          </div>
          {tax > 0 && <div className="kv muted"><span>{tl("dont TVA")}</span><span>{money(tax)}</span></div>}
          <div className="grand-total">
            <span>{tl("TOTAL")}</span>
            <span>{money(total)}</span>
          </div>
          <div className="ticket-actions">
            <button
              className="btn"
              onClick={async () => {
                if (await guard("void", tl("Vider le ticket"), tl("Ticket vidé : {0} ligne(s), {1}", [cart.length, money(total)]))) resetSale();
              }}
              disabled={!cart.length}
              title={tl("Vider le ticket")}
            >
              <Trash2 size={16} />
            </button>
            <button className="btn" onClick={holdCurrent} disabled={!cart.length} title={tl("Mettre en attente (le client a oublié quelque chose…)")}>
              <PauseCircle size={16} />  {tl("Attente")}</button>
            <button className="btn btn-primary btn-lg" disabled={!cart.length || sessionMissing} onClick={() => setModal("pay")}>
              {tl("Encaisser")} <kbd className="kbd light">F9</kbd>
            </button>
          </div>
        </div>

        {sessionMissing && (
          <div className="session-lock">
            <Lock size={28} />
            <strong>{tl("Caisse fermée")}</strong>
            <span className="muted">{tl("Ouvrez une session de caisse pour commencer à vendre.")}</span>
            <button className="btn btn-primary" onClick={() => setModal("open")}>
              {tl("Ouvrir la caisse")}</button>
          </div>
        )}
      </section>

      {/* ───── Fenêtres ───── */}
      {modal === "open" && (
        <OpenSessionModal
          onClose={() => setModal(null)}
          onOpened={(s) => {
            setSession(s);
            setModal(null);
            searchRef.current?.focus();
          }}
        />
      )}
      {modal === "customer" && (
        <CustomerPicker
          onClose={() => setModal(null)}
          onPick={(c) => {
            setCustomer(c);
            setModal(null);
          }}
        />
      )}
      {packChoice && (
        <Modal title={<>{tl("Quel format ?")} <HelpTip k="packagings" /></>} onClose={() => setPackChoice(null)} width={480}>
          <div className="pick-list">
            {[null, ...packChoice.packagings].map((k) => (
              <button
                key={k?.id ?? 0}
                className="pick-item pack-pick"
                onClick={() => {
                  addToCart(packChoice, 1, k);
                  setPackChoice(null);
                }}
              >
                <Package size={20} className="muted" />
                <div style={{ flex: 1 }}>
                  <strong>{k ? k.name : tl("À l'unité ({0})", [packChoice.unit])}</strong>
                  <div className="muted small">{k ? `${qty(k.quantity)} ${packChoice.unit} · ${k.barcode ?? ""}` : packChoice.barcode}</div>
                </div>
                <strong className="pack-price">{money(k ? k.sale_price : packChoice.sale_price)}</strong>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {othersOpen && <OtherTillsModal onClose={() => setOthersOpen(false)} onTake={takeOver} />}
      {cameraOpen && (
        <CameraScanner
          title={tl("Scanner les articles")}
          hint={tl("Visez le code-barres ou le QR code : chaque article lu est ajouté au ticket.")}
          continuous
          onCode={(c) => addByCode(c)}
          onClose={() => {
            setCameraOpen(false);
            searchRef.current?.focus();
          }}
        />
      )}
      {codeOpen && (
        <CodeEntryModal
          onClose={() => {
            setCodeOpen(false);
            searchRef.current?.focus();
          }}
          onSubmit={addByCode}
        />
      )}
      {modal === "held" && (
        <Modal title={tl("Tickets en attente")} onClose={() => setModal(null)} width={520}>
          {held.length === 0 ? (
            <div className="muted center pad">{tl("Aucun ticket en attente. Utilisez « Attente » pour mettre de côté le ticket en cours.")}</div>
          ) : (
            <div className="pick-list">
              {held.map((t) => (
                <div key={t.id} className="pick-item static">
                  <PauseCircle size={20} className="muted" />
                  <div style={{ flex: 1 }}>
                    <strong>{t.label}</strong>
                    <div className="muted small">{t.at} · {t.lines.length}  {tl("ligne(s) ·")} {money(t.total)}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => recall(t)}>{tl("Reprendre")}</button>
                  <button className="icon-btn danger" title={tl("Supprimer")} onClick={() => setHeld((h) => h.filter((x) => x.id !== t.id))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {modal === "discount" && (
        <AmountModal
          title={tl("Remise sur le ticket")}
          label={tl("Montant de la remise ({0})", [currencySymbol()])}
          initial={discount}
          max={subtotal}
          percentBase={subtotal}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            const gross = cart.reduce((t, l) => t + lineGross(l), 0);
            const lineDiscounts = cart.reduce((t, l) => t + Math.min(l.discount, lineGross(l)), 0);
            if (v > discount && !(await approveDiscount(lineDiscounts + Math.min(v, subtotal), gross, tl("Remise sur le ticket")))) return;
            setDiscount(v);
            setModal(null);
          }}
        />
      )}
      {modal !== null && typeof modal === "object" && cart[modal.line] && (
        <LineModal
          line={cart[modal.line]}
          onClose={() => setModal(null)}
          onSave={async (quantity, lineDiscount) => {
            const line = cart[modal.line];
            const p = line.product;
            if (p.track_stock && !allowNegative && baseInCart(p.id, modal.line) + quantity * lineFactor(line) > p.stock + 1e-9) {
              toast.error(tl("Stock insuffisant (disponible : {0} {1}).", [qty(p.stock), p.unit]));
              return;
            }
            if (quantity < line.quantity && !(await guard("void", tl("Diminuer la quantité"), tl("Diminution de quantité : {0} ({1} → {2})", [p.name, qty(line.quantity), qty(quantity)])))) return;
            if (lineDiscount > line.discount) {
              const next = cart.map((l, i) => (i === modal.line ? { ...l, quantity, discount: lineDiscount } : l));
              const gross = next.reduce((t, l) => t + lineGross(l), 0);
              const sub = next.reduce((t, l) => t + lineTotal(l), 0);
              const all = next.reduce((t, l) => t + Math.min(l.discount, lineGross(l)), 0) + Math.min(discount, sub);
              if (!(await approveDiscount(all, gross, tl("Remise sur l'article")))) return;
            }
            setCart((c) => c.map((l, i) => (i === modal.line ? { ...l, quantity, discount: lineDiscount } : l)));
            setModal(null);
          }}
        />
      )}
      {modal === "pay" && (
        <PaymentModal
          total={total}
          customer={customer}
          onLive={(info) => publishDisplay({ status: "payment", ...cartDisplay, ...info })}
          onClose={() => setModal(null)}
          onPay={async (payments, note) => {
            try {
              // Remise au-delà du seuil sans validation (ticket repris, PIN refusé…) : on la demande maintenant.
              const gross = cart.reduce((t, l) => t + lineGross(l), 0);
              const allDiscount = cart.reduce((t, l) => t + Math.min(l.discount, lineGross(l)), 0) + Math.min(discount, subtotal);
              let pin = discountPin && allDiscount <= discountPin.upTo ? discountPin.pin : null;
              if (overDiscountLimit(allDiscount, gross) && !canApproveDiscount && !pin) {
                pin = await askPin({
                  title: tl("Valider la remise"),
                  message: tl("Remise de {0} au-delà des {1} % autorisés : un responsable valide avec son code PIN.", [money(allDiscount), freePercent]),
                  level: discountLevel,
                });
                if (!pin) return false;
                setDiscountPin({ pin, upTo: allDiscount });
              }
              const sale = await api.createSale({
                items: cart.map((l) => ({ product_id: l.product.id, packaging_id: l.packaging?.id ?? null, quantity: l.quantity, discount: l.discount })),
                customer_id: customer?.id ?? null,
                discount: Math.min(discount, subtotal),
                payments,
                note,
                client_ref: ticketRef,
                discount_pin: pin,
              });
              setModal(null);
              setLastSale(sale);
              // Imprimante à tickets de ce poste : ticket et tiroir sans fenêtre (si réglé).
              afterSalePrint(sale, settings).catch((e) => toast.error(tl("Vente enregistrée, mais le ticket n'est pas sorti : {0}", [e instanceof Error ? e.message : String(e)])));
              publishDisplay({
                status: "done",
                ...cartDisplay,
                total: sale.total,
                paid: sale.amount_paid,
                change: sale.change_due,
                sale_number: sale.number,
              });
              resetSale();
              loadProducts();
              loadSession();
              return true;
            } catch (e) {
              toast.error(e);
              return false;
            }
          }}
        />
      )}
      {lastSale && (
        <Modal
          title={<><Check size={20} className="text-success" />  {tl("Vente")} {lastSale.number}  {tl("enregistrée")}</>}
          onClose={() => {
            setLastSale(null);
            searchRef.current?.focus();
          }}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => printReceipt(lastSale, settings).catch(toast.error)}>
                <Printer size={16} />  {tl("Imprimer le ticket")}</button>
              <button
                className="btn btn-primary"
                autoFocus
                onClick={() => {
                  setLastSale(null);
                  searchRef.current?.focus();
                }}
              >
                {tl("Nouvelle vente")}</button>
            </>
          }
        >
          <div className="sale-done">
            <div className="kv kv-strong"><span>{tl("Total")}</span><span>{money(lastSale.total)}</span></div>
            {lastSale.payments.map((p) => (
              <div key={p.id} className="kv">
                <span>{paymentLabel(p.method)}{p.reference ? <span className="muted small"> · {p.reference}</span> : null}</span>
                <span>{money(p.method === "cash" ? p.tendered : p.amount)}</span>
              </div>
            ))}
            {lastSale.change_due > 0 && (
              <div className="change-due">
                <span>{tl("Monnaie à rendre")}</span>
                <strong>{money(lastSale.change_due)}</strong>
              </div>
            )}
            {lastSale.credit_amount > 0 && <div className="alert alert-warning">{tl("Reste à crédit :")} {money(lastSale.credit_amount)}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────── Paiement ───────────────────────────

function quickAmounts(due: number): number[] {
  const unit = 10 ** currencyDecimals();
  const steps = currencyDecimals() === 0 ? [500, 1000, 2000, 5000, 10000] : [5, 10, 20, 50, 100];
  const set = new Set<number>([due]);
  for (const s of steps) {
    const v = Math.ceil(due / (s * unit)) * s * unit;
    if (v > due) set.add(v);
  }
  return [...set].sort((a, b) => a - b).slice(0, 5);
}

function PaymentModal({
  total,
  customer,
  onLive,
  onClose,
  onPay,
}: {
  total: number;
  customer: Customer | null;
  onClose: () => void;
  onPay: (payments: PaymentInput[], note: string | null) => Promise<boolean>;
  onLive?: (info: { method: string | null; paid: number; remaining: number; change: number; show_om_qr: boolean; qr_method: string | null }) => void;
}) {
  const { settings } = useApp();
  const omEnabled = settings.om_enabled !== "0";
  const omRequireRef = settings.om_require_reference !== "0";
  const operators = useMemo(() => parseOperators(settings.mobile_operators), [settings.mobile_operators]);
  const methods: { id: PaymentMethod | "credit"; label: string; icon: ReactNode; cls?: string; color?: string }[] = [
    { id: "cash", label: tl("Espèces"), icon: <Banknote size={22} /> },
    ...(omEnabled ? [{ id: "orange_money" as const, label: paymentLabel("orange_money"), icon: <Smartphone size={22} />, cls: "om" }] : []),
    ...operators
      .filter((o) => o.enabled)
      .map((o) => ({ id: `mm:${o.id}` as const, label: o.name, icon: <Smartphone size={22} />, cls: "om", color: o.color })),
    { id: "mobile_money", label: tl("Autre mobile money"), icon: <Smartphone size={22} /> },
    { id: "card", label: tl("Carte"), icon: <CreditCard size={22} /> },
    { id: "other", label: tl("Autre"), icon: <CircleEllipsis size={22} /> },
    { id: "credit_note", label: tl("Avoir"), icon: <Ticket size={22} /> },
    { id: "credit", label: tl("Crédit client"), icon: <HandCoins size={22} /> },
  ];

  const [added, setAdded] = useState<PaymentInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod | "credit">("cash");
  const [amount, setAmount] = useState(minorToInput(total));
  const [reference, setReference] = useState("");
  const [refScan, setRefScan] = useState(false);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  // Le premier appui sur le pavé numérique remplace le montant proposé par défaut.
  const touched = useRef(false);
  const refRef = useRef<HTMLInputElement>(null);
  const [note_, setNote_] = useState<CreditNote | null>(null);
  const [noteError, setNoteError] = useState("");
  const [noteScan, setNoteScan] = useState(false);

  const sumAdded = (pred: (p: PaymentInput) => boolean) => added.filter(pred).reduce((s, p) => s + p.amount, 0);
  const addedNonCash = sumAdded((p) => p.method !== "cash");
  const addedCash = sumAdded((p) => p.method === "cash");
  const dueNow = Math.max(0, total - addedNonCash - addedCash);

  const current: PaymentInput | null =
    method === "credit" || toMinor(amount || "0") <= 0
      ? null
      : { method, amount: toMinor(amount || "0"), reference: reference.trim() || null, phone: phone.trim() || null };
  const all = current ? [...added, current] : added;
  const nonCash = all.filter((p) => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
  const cash = all.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
  const cashApplied = Math.min(cash, Math.max(0, total - nonCash));
  const change = cash - cashApplied;
  const remaining = Math.max(0, total - nonCash - cashApplied);
  const canCredit = !!customer && customer.credit_limit > 0;
  // Orange Money et opérateurs configurés : QR marchand + ID de transaction.
  const operator = operatorOf(method, operators);
  const qrPanel = method === "orange_money" || !!operator;
  const refRequired = (m: string) => (m === "credit_note" ? true : m === "orange_money" ? omRequireRef : !!operatorOf(m, operators)?.require_ref);
  const missingRef = all.find((p) => refRequired(p.method) && !p.reference);

  // L'écran client suit le paiement en direct (montant reçu, reste, monnaie, QR Orange Money).
  useEffect(() => {
    onLive?.({
      method: method === "credit" ? "credit" : method,
      paid: nonCash + cash,
      remaining,
      change,
      show_om_qr: method === "orange_money",
      qr_method: qrPanel ? method : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, nonCash, cash, remaining, change]);

  const problem =
    nonCash > total
      ? tl("Les paiements électroniques dépassent le total : la monnaie ne se rend qu'en espèces.")
      : missingRef
        ? missingRef.method === "credit_note"
          ? tl("Scannez ou saisissez le code de l'avoir, puis « Vérifier ».")
          : missingRef.method === "orange_money"
          ? tl("Saisissez ou scannez l'ID de transaction Orange Money (reçu par SMS).")
          : tl("Saisissez ou scannez l'ID de transaction {0} (reçu par SMS).", [paymentLabel(missingRef.method)])
        : method === "credit_note" && current && note_ && current.amount > note_.balance
          ? tl("Il ne reste que {0} sur cet avoir.", [money(note_.balance)])
          : remaining > 0 && !canCredit
          ? tl("Il manque {0}. Pour vendre à crédit, associez un client disposant d'un plafond de crédit.", [money(remaining)])
          : null;

  const selectMethod = (m: PaymentMethod | "credit") => {
    touched.current = false;
    setMethod(m);
    setReference("");
    setPhone("");
    setNote_(null);
    setNoteError("");
    setAmount(m === "credit" ? "" : minorToInput(dueNow));
    setTimeout(() => (m === "orange_money" || m.startsWith("mm:") ? refRef.current?.focus() : amountRef.current?.select()), 0);
  };

  useEffect(() => {
    setTimeout(() => amountRef.current?.select(), 0);
  }, []);

  const addCurrent = () => {
    if (!current) return;
    setAdded((a) => [...a, current]);
    const rest = Math.max(0, dueNow - current.amount);
    setReference("");
    setPhone("");
    setMethod("cash");
    setAmount(minorToInput(rest));
    setTimeout(() => amountRef.current?.select(), 0);
  };

  /** Avoir : le code (scanné ou saisi) est vérifié ; le montant proposé est son reste, au plus le dû. */
  const checkNote = async (code = reference) => {
    setNoteError("");
    setNote_(null);
    if (!code.trim()) return;
    try {
      const n = await api.getCreditNote(code.trim());
      if (n.status !== "active" || n.balance <= 0) throw new Error(tl("Cet avoir a déjà été entièrement utilisé."));
      if (n.expires_on < new Date().toISOString().slice(0, 10)) throw new Error(tl("Cet avoir a expiré le {0}.", [n.expires_on]));
      setNote_(n);
      setReference(n.code);
      setAmount(minorToInput(Math.min(n.balance, dueNow)));
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    const ok = await onPay(all, note.trim() || null);
    if (!ok) setBusy(false);
  };

  return (
    <Modal
      title={tl("Encaissement")}
      onClose={onClose}
      width={qrPanel ? 820 : 680}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Retour")}</button>
          <button className="btn" disabled={!current || remaining === 0} onClick={addCurrent} title={tl("Payer une partie avec ce moyen, puis compléter avec un autre")}>
            <Plus size={16} />  {tl("Paiement partiel")}</button>
          <HelpTip k="partial" side="top" />
          <button className="btn btn-primary btn-lg" disabled={!!problem || busy} onClick={submit}>
            {busy ? tl("Enregistrement…") : tl("Valider la vente (Entrée)")}
          </button>
        </>
      }
    >
      <div className="pay-head">
        <div className="pay-total">
          <span>{tl("Total à payer")}</span>
          <strong>{money(total)}</strong>
        </div>
        <div className={`pay-side ${remaining > 0 ? "warn" : "ok"}`}>
          <span>{remaining > 0 ? tl("Reste à payer") : change > 0 ? tl("Monnaie à rendre") : tl("Soldé")}</span>
          <strong>{money(remaining > 0 ? remaining : change)}</strong>
        </div>
      </div>

      {added.length > 0 && (
        <div className="pay-added">
          {added.map((p, i) => (
            <div key={i} className="pay-chip">
              <span>{paymentLabel(p.method)}</span>
              <strong>{money(p.amount)}</strong>
              {p.reference && <span className="muted small">{p.reference}</span>}
              <button className="icon-btn" onClick={() => setAdded((a) => a.filter((_, j) => j !== i))} aria-label={tl("Retirer")}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="method-grid">
        {methods.map((m) => (
          <button
            key={m.id}
            className={`method ${m.cls ?? ""} ${method === m.id ? "active" : ""}`}
            style={operatorTheme(m.color)}
            onClick={() => selectMethod(m.id)}
            disabled={m.id === "credit" && !canCredit}
            title={m.id === "credit" && !canCredit ? tl("Sélectionnez un client autorisé au crédit") : undefined}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {method === "credit" && (
        <div className="alert alert-warning">
          {tl("Le reste (")}{money(remaining)}{tl(") sera ajouté à la dette de")} <strong>{customer?.name}</strong>  {tl("(dette actuelle")} {money(customer?.balance ?? 0)}{tl(", plafond")} {money(customer?.credit_limit ?? 0)}).
        </div>
      )}

      {method === "credit_note" ? (
        <div className="form-grid">
          <Field label={tl("Code de l'avoir *")} hint={tl("Scannez le code-barres du bon avec la douchette, ou recopiez-le.")}>
            <div className="input-group">
              <input
                ref={refRef}
                className="mono input-lg"
                value={reference}
                autoFocus
                onChange={(e) => {
                  setReference(e.target.value.trim().toUpperCase());
                  setNote_(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (note_ ? submit() : checkNote())}
                placeholder={CREDIT_NOTE_EXAMPLE}
              />
              <button type="button" className="btn" onClick={() => checkNote()}>{tl("Vérifier")}</button>
              <button type="button" className="btn" title={tl("Scanner le bon avec la caméra")} onClick={() => setNoteScan(true)}>
                <Camera size={18} />
              </button>
            </div>
            {noteScan && <CameraScanner title={tl("Scanner l'avoir")} onCode={(c) => checkNote(c)} onClose={() => setNoteScan(false)} />}
          </Field>
          {note_ && (
            <Field label={tl("Montant payé avec l'avoir ({0})", [currencySymbol()])} hint={tl("Reste sur l'avoir : {0} · valable jusqu'au {1}", [money(note_.balance), note_.expires_on])}>
              <input ref={amountRef} className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          )}
          {noteError && <div className="alert alert-danger" style={{ gridColumn: "1 / -1" }}>{noteError}</div>}
        </div>
      ) : qrPanel ? (
        <div className="om-pay" style={operatorTheme(operator?.color)}>
          <PaymentQr method={method} size={180} />
          <div className="om-fields">
            <div className="om-steps">
              <span><b className="om-step-n">1</b>  {tl("Le client scanne le QR code ou paie au numéro marchand.")}</span>
              <span><b className="om-step-n">2</b>  {tl("Il montre la confirmation ; saisissez ou scannez l'")}<strong>{tl("ID de transaction")}</strong>.</span>
            </div>
            <Field label={tl("Montant payé ({0})", [currencySymbol()])}>
              <input ref={amountRef} className="input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={<>{tl("ID de transaction")} {refRequired(method) ? "*" : ""} <HelpTip k="om_reference" /></>} hint={tl("Scannez le code de la confirmation avec la douchette ou recopiez-le depuis le SMS.")}>
              <div className="input-group">
                <input
                  ref={refRef}
                  className="mono input-lg"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.trim())}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={tl("Ex. MP251031.1542.C12345")}
                />
                <button type="button" className="btn" title={tl("Scanner le code de la confirmation avec la caméra")} onClick={() => setRefScan(true)}>
                  <Camera size={18} />
                </button>
              </div>
              {refScan && <CameraScanner title={tl("Scanner la confirmation")} onCode={(c) => setReference(c)} onClose={() => setRefScan(false)} />}
            </Field>
            <Field label={tl("N° de téléphone du client")}>
              <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tl("Ex. 70 00 00 00")} />
            </Field>
          </div>
        </div>
      ) : (
        method !== "credit" && (
          <>
            <div className="pay-entry">
              <div className="pay-entry-main">
                <Field label={method === "cash" ? tl("Montant reçu ({0})", [currencySymbol()]) : tl("Montant encaissé ({0})", [currencySymbol()])}>
                  <input
                    ref={amountRef}
                    className="input-xl"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                </Field>
                {method === "cash" && (
                  <div className="quick-amounts big">
                    {quickAmounts(dueNow).map((a) => (
                      <button key={a} className="btn" onClick={() => setAmount(minorToInput(a))}>
                        {money(a, false)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="pay-numpad">
                <NumPad
                  extra="00"
                  onKey={(k) => {
                    const fresh = !touched.current;
                    touched.current = true;
                    setAmount((v) => (k === "⌫" ? v.slice(0, -1) : (fresh ? "" : v) + k));
                  }}
                />
                <button className="btn btn-sm btn-block" onClick={() => setAmount("")}>{tl("Effacer")}</button>
              </div>
            </div>
            {(method === "mobile_money" || method === "card") && (
              <div className="form-grid">
                <Field label={tl("Référence de transaction")}>
                  <input className="mono" value={reference} onChange={(e) => setReference(e.target.value.trim())} />
                </Field>
                <Field label={method === "card" ? tl("4 derniers chiffres (facultatif)") : tl("N° du client")}>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
              </div>
            )}
          </>
        )
      )}

      {change > 0 && remaining === 0 && (
        <div className="change-due">
          <span>{tl("Monnaie à rendre")}</span>
          <strong>{money(change)}</strong>
        </div>
      )}
      {problem ? (
        <div className="alert alert-danger">{problem}</div>
      ) : (
        remaining > 0 && method !== "credit" && (
          <div className="alert alert-warning">
            {tl("Reste")} {money(remaining)}  {tl("à mettre au crédit de")} {customer!.name}  {tl("(plafond")} {money(customer!.credit_limit)}).
          </div>
        )
      )}

      <Field label={tl("Note (facultatif)")}>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ─────────────────────────── Client ───────────────────────────

function CustomerPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: Customer) => void }) {
  const { toast } = useApp();
  const [search, setSearch] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });

  useEffect(() => {
    const t = setTimeout(() => api.listCustomers({ search }).then(setList).catch(toast.error), 150);
    return () => clearTimeout(t);
  }, [search, toast]);

  const create = async () => {
    try {
      onPick(await api.saveCustomer(null, { name: form.name, phone: form.phone || null }));
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal title={tl("Choisir un client")} onClose={onClose} width={560}>
      {!creating ? (
        <>
          <div className="toolbar">
            <div className="search-box grow">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Nom ou téléphone…")} autoFocus />
            </div>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <UserPlus size={16} />  {tl("Nouveau")}</button>
          </div>
          <div className="pick-list">
            {list.map((c) => (
              <button key={c.id} className="pick-item" onClick={() => onPick(c)}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted small">{c.phone ?? "—"}</div>
                </div>
                <div className="right small">
                  {c.balance > 0 && <Badge tone="warning">{tl("Dette")} {money(c.balance)}</Badge>}
                  {c.credit_limit > 0 ? <div className="muted">{tl("Plafond")} {money(c.credit_limit)}</div> : <div className="muted">{tl("Sans crédit")}</div>}
                </div>
              </button>
            ))}
            {list.length === 0 && <div className="muted center pad">{tl("Aucun client trouvé.")}</div>}
          </div>
        </>
      ) : (
        <div className="form-grid one">
          <Field label={tl("Nom du client *")}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label={tl("Téléphone")}>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="row-end">
            <button className="btn" onClick={() => setCreating(false)}>{tl("Retour")}</button>
            <button className="btn btn-primary" disabled={!form.name.trim()} onClick={create}>{tl("Créer et sélectionner")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────── Ligne / remise ───────────────────────────

function LineModal({ line, onClose, onSave }: { line: CartLine; onClose: () => void; onSave: (q: number, d: number) => void }) {
  const [q, setQ] = useState(String(line.quantity).replace(".", ","));
  const [d, setD] = useState(line.discount ? minorToInput(line.discount) : "");
  const quantity = parseNumber(q);
  const gross = Number.isFinite(quantity) ? Math.round(quantity * linePrice(line)) : 0;
  const disc = Math.min(toMinor(d || "0"), gross);
  return (
    <Modal
      title={lineName(line)}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={!(quantity > 0)} onClick={() => onSave(+quantity.toFixed(3), disc)}>
            {tl("Appliquer")}</button>
        </>
      }
    >
      <div className="line-modal-head">
        <Thumb imageId={line.product.image_id} name={line.product.name} color={line.product.category_color} size={64} rounded={12} />
        <div>
          <div className="muted small">
            {money(linePrice(line))} / {lineUnit(line)}
            {line.packaging && <> · {qty(line.packaging.quantity)} {line.product.unit} par {line.packaging.name.toLowerCase()}</>}
          </div>
          <LocationBadge p={line.product} />
        </div>
      </div>
      <div className="form-grid one">
        <Field label={tl("Quantité ({0})", [lineUnit(line)])} hint={!line.packaging && ["kg", "g", "L", "m", "mètre"].includes(line.product.unit) ? tl("Les décimales sont acceptées : 0,750 {0}", [line.product.unit]) : undefined}>
          <input className="input-lg" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </Field>
        <Field label={tl("Remise sur la ligne ({0})", [currencySymbol()])}>
          <input inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} placeholder="0" />
        </Field>
        <div className="kv kv-strong"><span>{tl("Total ligne")}</span><span>{money(gross - disc)}</span></div>
      </div>
    </Modal>
  );
}

function AmountModal({
  title,
  label,
  initial,
  max,
  percentBase,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial: number;
  max: number;
  percentBase: number;
  onClose: () => void;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(initial ? minorToInput(initial) : "");
  const amount = Math.min(toMinor(v || "0"), max);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={() => onSave(0)}>{tl("Supprimer la remise")}</button>
          <button className="btn btn-primary" onClick={() => onSave(amount)}>{tl("Appliquer")}</button>
        </>
      }
    >
      <Field label={label}>
        <input className="input-lg" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSave(amount)} autoFocus />
      </Field>
      <div className="quick-amounts">
        {[5, 10, 15, 20].map((p) => (
          <button key={p} className="btn" onClick={() => setV(minorToInput(Math.round((percentBase * p) / 100)))}>
            {p} %
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Saisie manuelle d'un code-barres au pavé numérique (étiquette abîmée, douchette en panne). */
function CodeEntryModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [q, setQ] = useState("1");
  const [field, setField] = useState<"code" | "qty">("code");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    const n = parseNumber(q);
    const ok = await onSubmit(n > 0 && n !== 1 ? `${q}*${code.trim()}` : code.trim());
    setBusy(false);
    if (ok) {
      setCode("");
      setQ("1");
      setField("code");
    }
  };
  const key = (k: string) => {
    const set = field === "code" ? setCode : setQ;
    if (k === "⌫") set((v) => v.slice(0, -1));
    else if (k === "C") set("");
    else set((v) => (field === "qty" && v === "1" ? k : v + k));
  };
  return (
    <Modal
      title={<>{tl("Saisir un code-barres")} <HelpTip k="code_entry" /></>}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Fermer")}</button>
          <button className="btn btn-primary btn-lg" disabled={busy || !code.trim()} onClick={submit}><Plus size={16} />  {tl("Ajouter au ticket")}</button>
        </>
      }
    >
      <div className="code-entry">
        <label className={`code-field ${field === "code" ? "focus" : ""}`} onClick={() => setField("code")}>
          <span className="field-label">{tl("Code (chiffres sous le code-barres)")}</span>
          <input
            className="mono input-lg"
            value={code}
            autoFocus
            onFocus={() => setField("code")}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        <label className={`code-field qty ${field === "qty" ? "focus" : ""}`} onClick={() => setField("qty")}>
          <span className="field-label">{tl("Quantité")}</span>
          <input className="input-lg" inputMode="decimal" value={q} onFocus={() => setField("qty")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </label>
      </div>
      <NumPad onKey={key} />
    </Modal>
  );
}

/** Caisses des collègues en temps réel : suivre un encaissement et reprendre le client en cas de problème. */
function OtherTillsModal({ onClose, onTake }: { onClose: () => void; onTake: (c: LiveCart) => void }) {
  const [list, setList] = useState<LiveCart[] | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.liveCarts(posteId()).then(setList).catch(() => setList([]));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  const followed = list?.find((c) => c.poste_id === follow) ?? null;
  return (
    <Modal title={<><Users size={18} />  {tl("Autres caisses")} <HelpTip k="other_tills" /></>} onClose={onClose} width={720}>
      {list === null ? (
        <div className="muted center pad">{tl("Chargement…")}</div>
      ) : list.length === 0 ? (
        <div className="muted center pad">{tl("Aucun autre ticket en cours. Les tickets des collègues apparaissent ici en direct.")}</div>
      ) : (
        <div className="till-list">
          {list.map((c) => (
            <div key={c.poste_id} className={`till ${follow === c.poste_id ? "followed" : ""} ${c.status === "payment" ? "paying" : ""}`}>
              <div className="till-head">
                <div>
                  <strong>{c.poste}</strong> · {c.user_name}
                  <div className="muted small">
                    {c.status === "payment" ? <Badge tone="warning">{tl("Encaissement en cours")}</Badge> : <Badge tone="info">{tl("Saisie des articles")}</Badge>}{" "}
                    {c.lines}  {tl("ligne(s) ·")} {c.seen_ago < 30 ? <>{tl("actif à l'instant")}</> : <span className="text-danger">{tl("inactif depuis")} {c.seen_ago < 120 ? `${c.seen_ago} s` : tl("{0} min", [Math.floor(c.seen_ago / 60)])}  {tl("(caisse fermée ?)")}</span>}
                    {c.cart.customer && <>  {tl("· client :")} {c.cart.customer.name}</>}
                  </div>
                </div>
                <strong className="till-total">{money(c.total)}</strong>
              </div>
              {follow === c.poste_id && followed && (
                <table className="table compact">
                  <tbody>
                    {followed.cart.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.name}</td>
                        <td className="num muted">{qty(l.quantity)}  {tl("×")} {money(l.unit_price)}</td>
                        <td className="num"><strong>{money(l.total)}</strong></td>
                      </tr>
                    ))}
                    {followed.cart.discount > 0 && (
                      <tr><td>{tl("Remise")}</td><td /><td className="num">-{money(followed.cart.discount)}</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              <div className="till-actions">
                <button className="btn btn-sm" onClick={() => setFollow(follow === c.poste_id ? null : c.poste_id)}>
                  <Eye size={14} /> {follow === c.poste_id ? tl("Ne plus suivre") : tl("Suivre en direct")}
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => onTake(c)}>
                  <HandHelping size={14} />  {tl("Reprendre ce client")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted small">
        {tl("Reprendre un client transfère son ticket sur votre caisse (articles, client, remise) : il disparaît de la caisse du collègue. Votre ticket en cours éventuel est mis en attente. L'action est confirmée par votre code PIN et tracée dans le journal.")}</p>
    </Modal>
  );
}
