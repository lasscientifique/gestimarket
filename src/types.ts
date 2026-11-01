// Types partagés avec le backend Rust (mêmes noms de champs, en snake_case).
// Les montants sont des entiers dans la plus petite unité de la devise.

export type Role = "admin" | "manager" | "cashier";
export type PaymentMethod = "cash" | "orange_money" | "mobile_money" | "card" | "other";
/** Mode de paiement résumé d'une vente : un moyen, « mixed » (plusieurs) ou « credit » (rien payé). */
export type SaleMethod = PaymentMethod | "credit" | "mixed";

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  has_pin: boolean;
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

export interface Location {
  id: number;
  bloc: string;
  etage: string;
  rangee: string;
  label: string | null;
  product_count: number;
  stock_value: number;
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
