// Types partagés avec le backend Rust (mêmes noms de champs, en snake_case).
// Les montants sont des entiers dans la plus petite unité de la devise.

export type Role = "admin" | "manager" | "cashier";
/** « mm:<id> » : opérateur de mobile money configuré par la boutique (Wave, MTN MoMo…). */
export type PaymentMethod = "cash" | "orange_money" | "mobile_money" | "card" | "other" | `mm:${string}`;
/** Mode de paiement résumé d'une vente : un moyen, « mixed » (plusieurs) ou « credit » (rien payé). */
export type SaleMethod = PaymentMethod | "credit" | "mixed";

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  has_pin: boolean;
  /** Langue choisie (fr, en) ; vide : langue de la boutique. */
  lang?: string | null;
}

export interface User extends SessionUser {
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export type Settings = Record<string, string>;

export interface Category {
  id: number;
  parent_id: number | null;
  parent_name: string | null;
  name: string;
  color: string;
  image_id: number | null;
  sort_order: number;
  /** Chemin complet « Alimentation › Riz › Riz local ». */
  path: string;
  /** 0 = catégorie principale. */
  depth: number;
  active: boolean;
  /** Produits actifs de la catégorie et de toute sa descendance. */
  product_count: number;
  direct_count: number;
  children_count: number;
}

export interface Packaging {
  id: number | null;
  name: string;
  /** Nombre d'unités de base contenues (12 bouteilles, 50 kg…). */
  quantity: number;
  barcode: string | null;
  sale_price: number;
}

export interface ScanResult {
  product: Product;
  packaging: Packaging | null;
}

export interface BusinessProfile {
  id: string;
  label: string;
  description: string;
  categories: number[];
  features: string[];
  track_stock: boolean;
  /** Meubles proposés en tête de la palette du plan (codes des types). */
  fixtures?: string[];
}

export interface CatalogueSummary {
  index: number;
  name: string;
  subcategories: number;
  total: number;
  examples: string[];
}

export interface TemplateNode {
  name: string;
  children: TemplateNode[];
}

/** Case d'un meuble du plan (étage × case). bloc = code du meuble. */
export interface Location {
  id: number;
  bloc: string;
  etage: string;
  rangee: string;
  label: string | null;
  product_count: number;
  stock_value: number;
  fixture_id: number;
  fixture_name: string;
  fixture_type: string;
  category: FixtureCategory;
  floor_id: number;
  floor_name: string;
  level: number;
  section: number;
}

// ───────────── Plan de la boutique ─────────────

export type FixtureCategory = "rayon" | "froid" | "presentation" | "rangement" | "zone" | "batiment";

export interface Floor {
  id: number;
  name: string;
  sort: number;
  width: number;
  depth: number;
}

export interface FixtureType {
  id: number;
  code: string;
  name: string;
  category: FixtureCategory;
  prefix: string;
  color: string;
  width: number;
  depth: number;
  levels: number;
  sections: number;
  storage: boolean;
  builtin: boolean;
  sort: number;
  used: number;
}

/** Meuble posé sur le plan : position, taille (mètres) et rotation (degrés). */
export interface Fixture {
  id: number;
  floor_id: number;
  type_id: number;
  type_code: string;
  type_name: string;
  category: FixtureCategory;
  storage: boolean;
  code: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  color: string;
  custom_color: string | null;
  levels: number;
  sections: number;
  notes: string | null;
  product_count: number;
}

export interface StorePlanData {
  floors: Floor[];
  types: FixtureType[];
  fixtures: Fixture[];
}

export interface SlotProduct {
  product_id: number;
  name: string;
  barcode: string | null;
  image_id: number | null;
  stock: number;
  unit: string;
  primary: boolean;
}

export interface Slot {
  id: number;
  level: number;
  section: number;
  etage: string;
  rangee: string;
  label: string | null;
  products: SlotProduct[];
}

export interface FixtureContents {
  fixture: Fixture;
  slots: Slot[];
}

/** Emplacement d'un produit sur le plan (le principal d'abord). */
export interface Place {
  location_id: number;
  primary: boolean;
  fixture_id: number;
  fixture_code: string;
  fixture_name: string;
  type_name: string;
  category: FixtureCategory;
  floor_id: number;
  floor_name: string;
  level: number;
  section: number;
  etage: string;
  rangee: string;
  levels: number;
  sections: number;
}

export interface Product {
  id: number;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  parent_category_id: number | null;
  parent_category_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  tax_rate: number;
  stock: number;
  min_stock: number;
  track_stock: boolean;
  active: boolean;
  image_id: number | null;
  location_id: number | null;
  bloc: string | null;
  etage: string | null;
  rangee: string | null;
  location_label: string | null;
  /** Meuble du plan de l'emplacement principal. */
  fixture_id: number | null;
  fixture_name: string | null;
  /** Autres emplacements (réserve, frigo…). */
  other_places: number;
  expiry_date: string | null;
  brand: string | null;
  sku: string | null;
  category_path: string | null;
  packagings: Packaging[];
  created_at: string;
  updated_at: string;
}

export interface ProductInput {
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: number | null;
  supplier_id: number | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  tax_rate: number;
  min_stock: number;
  track_stock: boolean;
  active: boolean;
  image_id: number | null;
  location_id: number | null;
  expiry_date: string | null;
  brand: string | null;
  sku: string | null;
  packagings?: Packaging[];
  initial_stock?: number;
}

export interface ImportRow {
  barcode: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  unit: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  tax_rate: number | null;
  stock: number | null;
  min_stock: number | null;
  bloc: string | null;
  etage: string | null;
  rangee: string | null;
  expiry_date: string | null;
  brand: string | null;
  sku: string | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: string[];
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  unit: string;
  kind: string;
  quantity: number;
  stock_after: number;
  unit_cost: number | null;
  reference: string | null;
  note: string | null;
  user_name: string | null;
  created_at: string;
}

export interface StockSummary {
  product_count: number;
  value_cost: number;
  value_sale: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  product_count: number;
  purchases_total: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  balance: number;
  loyalty_points: number;
  active: boolean;
  created_at: string;
  purchases_total: number;
  last_purchase_at: string | null;
}

export interface StatementLine {
  date: string;
  kind: "sale" | "payment";
  reference: string;
  sale_id: number | null;
  total: number;
  debt_change: number;
  method: string | null;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  /** Quantité en unités de base (ex. 1 carton = 12). */
  base_quantity: number | null;
  packaging_id: number | null;
  unit_price: number;
  discount: number;
  tax_rate: number;
  total: number;
}

export interface SalePayment {
  id: number;
  method: PaymentMethod;
  amount: number;
  tendered: number;
  reference: string | null;
  phone: string | null;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  phone?: string | null;
}

export interface ElectronicPayment {
  date: string;
  source: "sale" | "customer_payment";
  sale_id: number | null;
  document: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  phone: string | null;
  customer_name: string | null;
  user_name: string | null;
}

export interface Sale {
  id: number;
  number: string;
  customer_id: number | null;
  customer_name: string | null;
  user_id: number;
  user_name: string;
  session_id: number | null;
  subtotal: number;
  discount: number;
  tax_total: number;
  total: number;
  cost_total: number;
  amount_paid: number;
  change_due: number;
  credit_amount: number;
  payment_method: SaleMethod;
  status: "completed" | "cancelled";
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items_count: number;
  items: SaleItem[];
  payments: SalePayment[];
}

export interface SaleInput {
  items: { product_id: number; quantity: number; discount?: number; packaging_id?: number | null }[];
  customer_id: number | null;
  discount: number;
  payments: PaymentInput[];
  note: string | null;
}

export interface PurchaseItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total: number;
  expiry_date: string | null;
}

export interface Purchase {
  id: number;
  number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  user_name: string;
  total: number;
  note: string | null;
  created_at: string;
  items_count: number;
  items: PurchaseItem[];
}

export interface CashSession {
  id: number;
  user_id: number;
  user_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  expected_amount: number | null;
  counted_amount: number | null;
  difference: number | null;
  status: "open" | "closed";
  note: string | null;
  sales_count: number;
  sales_total: number;
  cash_sales: number;
  orange_money_sales: number;
  mobile_money_sales: number;
  card_sales: number;
  other_sales: number;
  credit_sales: number;
  customer_payments_cash: number;
  customer_payments_electronic: number;
  cash_in: number;
  cash_out: number;
  expected_now: number;
}

export interface CashMovement {
  id: number;
  kind: "in" | "out";
  amount: number;
  reason: string;
  user_name: string | null;
  created_at: string;
}

export interface DayPoint {
  date: string;
  revenue: number;
  margin: number;
  count: number;
}

export interface TopProduct {
  product_id: number;
  name: string;
  unit: string;
  quantity: number;
  revenue: number;
  margin: number;
}

export interface Dashboard {
  today_revenue: number;
  today_margin: number;
  today_count: number;
  yesterday_revenue: number;
  month_revenue: number;
  month_margin: number;
  month_count: number;
  customers_debt: number;
  stock: StockSummary;
  daily: DayPoint[];
  top_products: TopProduct[];
  low_stock: { id: number; name: string; unit: string; stock: number; min_stock: number }[];
  expiring: { id: number; name: string; unit: string; stock: number; expiry_date: string; days_left: number }[];
  today_payments: Breakdown[];
  recent_sales: Sale[];
}

export interface Breakdown {
  label: string;
  count: number;
  amount: number;
  margin: number;
}

export interface SalesReport {
  from: string;
  to: string;
  revenue: number;
  sales_count: number;
  discount_total: number;
  tax_total: number;
  cost_total: number;
  margin: number;
  credit_total: number;
  cancelled_count: number;
  cancelled_total: number;
  purchases_total: number;
  customer_payments_total: number;
  by_day: DayPoint[];
  by_payment: Breakdown[];
  by_category: Breakdown[];
  by_user: Breakdown[];
  top_products: TopProduct[];
}

export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  created_at: string;
}

export interface CashierStats {
  session: CashSession | null;
  items_sold: number;
  average_basket: number;
  biggest_sale: number;
  discounts_total: number;
  cancelled_count: number;
  cancelled_total: number;
  customers_count: number;
  hourly: { hour: number; count: number; total: number }[];
  top_products: { name: string; unit: string; quantity: number; total: number }[];
  recent: { id: number; number: string; created_at: string; total: number; status: string; customer_name: string | null; items: number }[];
  today_count: number;
  today_total: number;
}

export interface PosteInfo {
  id: string;
  name: string;
  kind: "desktop" | "mobile" | "browser" | "display" | string;
  device: string;
  mode: string;
  ip: string;
  /** local = même réseau que le serveur ; internet = adresse publique (tunnel). */
  route: "local" | "internet" | string;
  version: string;
  page: string;
  user: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_ago: number;
  online: boolean;
  duplicate_name: boolean;
}

/** Ligne d'un ticket en cours partagé entre caisses. */
export interface LiveCartLine {
  product_id: number;
  packaging_id: number | null;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export interface LiveCartContent {
  lines: LiveCartLine[];
  customer: Customer | null;
  discount: number;
  total: number;
  items: number;
}

export interface LiveCart {
  poste_id: string;
  poste: string;
  user_id: number;
  user_name: string;
  cart: LiveCartContent;
  total: number;
  items: number;
  lines: number;
  status: "cart" | "payment" | string;
  updated_at: string;
  seen_ago: number;
}

export interface CloudStatus {
  running: boolean;
  enabled: boolean;
  shop_code: string;
  last_ok_at: string | null;
  last_try_at: string | null;
  last_error: string | null;
  url: string | null;
  public_url: string | null;
  /** Résultat du dernier test de l'adresse publique, fait depuis le poste serveur. */
  public_ok: boolean | null;
  public_ms: number | null;
  public_error: string | null;
}

/** Boutique de ce PC (5 au maximum, chacune dans sa fenêtre). */
export interface BoutiqueInfo {
  slot: number;
  name: string;
  configured: boolean;
  open: boolean;
  current: boolean;
}

export interface BoutiquesInfo {
  current: number;
  max: number;
  boutiques: BoutiqueInfo[];
  can_create: boolean;
}

// ───────────── Abonnement, licence et compte boutique (Eden Dev) ─────────────

export type PlanCode = "free" | "starter" | "pro" | "business";
export type LicenseFeature = "write" | "server" | "internet" | "customer_display" | "logo";

export interface LicenseStatus {
  /** Identifiant de ce PC (et de cette boutique sur le PC) : K7QM-2XPA-9DTR */
  pc_id: string;
  /** none, not_yet, active, expired */
  phase: string;
  plan: PlanCode;
  plan_label: string;
  licensed_plan: string | null;
  features: LicenseFeature[];
  max_postes: number;
  read_only: boolean;
  store_code: string | null;
  store_name: string | null;
  starts_at: string | null;
  expires_at: string | null;
  days_left: number | null;
  message: string;
  warning: string | null;
  level: "ok" | "warning" | "danger";
  clock_warning: string | null;
  load_error: string | null;
  account: { email: string; store_code: string; store_name: string };
  last_sync: string | null;
  last_sync_error: string | null;
  /** Dernière réponse d'Eden Dev : ok, none, unregistered, suspended */
  remote_status: string | null;
  postes_used?: number;
}

export interface PlanInfo {
  code: PlanCode;
  label: string;
  price_month: number;
  max_postes: number;
  features: LicenseFeature[];
  description: string;
  /** Prix mensuel par devise (XOF et XAF = price_month), fixés par Eden Dev. */
  prices?: Record<string, number>;
}

export interface AccountOptions {
  shop_types: { code: string; label: string }[];
  countries: { code: string; label: string; currency: string }[];
  plans: PlanInfo[];
  payment_instructions: string;
  trial_days: number;
  /** Moyens de paiement de l'abonnement (réglés par Eden Dev dans gm_config). */
  payment?: {
    om_merchant_code: string;
    om_merchant_name: string;
    om_qr_payload: string;
    card_enabled: boolean;
    /** Devise par défaut de la carte Visa, et devises acceptées par le profil Cybersource. */
    card_currency?: string;
    card_currencies?: string[];
  };
}

export type SubscriptionMethod = "carte_bon" | "orange_money" | "carte_visa";

/** Paiement de l'abonnement (gm_pc_payments). */
export interface SubscriptionPayment {
  id: string;
  created_at: string;
  method: SubscriptionMethod | string;
  plan: PlanCode;
  plan_label: string;
  months: number | null;
  amount: number;
  currency?: string;
  /** pending (carte en cours), declared (à valider par Eden Dev), validated, refused */
  status: "pending" | "declared" | "validated" | "refused";
  note: string;
  starts_at: string | null;
  ends_at: string | null;
  abandoned: boolean;
}

export interface VoucherResult {
  voucher: { serial: string; plan: PlanCode; plan_label: string; months: number; starts_at: string; ends_at: string };
  sync_error: string | null;
}

export interface CardStart {
  payment_id: string;
  amount: number;
  currency: string;
  plan_label: string;
  months: number;
}

export interface StoreInput {
  name: string;
  owner_name: string;
  phone: string;
  country: string;
  city: string;
  address: string;
  shop_type: string;
}

export interface AccountStore {
  code: string;
  name: string;
  owner_name: string;
  phone: string;
  country: string;
  city: string;
  address: string;
  shop_type: string;
  status: string;
  currency: string | null;
  plan: PlanCode | null;
  plan_label: string | null;
  ends_at: string | null;
  trial: boolean | null;
  pcs: number;
}

export interface AccountLinkResult {
  status: "linked" | "confirm_email";
  store?: AccountStore;
  sync_error?: string | null;
}

export interface SessionInfo {
  id: string;
  user: string;
  role: Role;
  ip: string;
  route: "local" | "internet";
  local: boolean;
  active: boolean;
  idle_secs: number;
  since: string;
}
