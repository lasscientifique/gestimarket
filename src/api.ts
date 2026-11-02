import { local, rpc, setToken } from "./lib/transport";
import type {
  AccountLinkResult,
  AccountOptions,
  AccountStore,
  CardStart,
  LicenseStatus,
  SessionInfo,
  StoreInput,
  SubscriptionPayment,
  VoucherResult,
  AuditEntry,
  CashMovement,
  CashSession,
  CashierStats,
  BoutiquesInfo,
  CloudStatus,
  LiveCart,
  LiveCartContent,
  PosteInfo,
  Category,
  BusinessProfile,
  CatalogueSummary,
  ScanResult,
  TemplateNode,
  Customer,
  Dashboard,
  ElectronicPayment,
  ImportResult,
  ImportRow,
  Location,
  Product,
  ProductInput,
  Purchase,
  Sale,
  SaleInput,
  SalesReport,
  SessionUser,
  Role,
  Settings,
  StatementLine,
  StockMovement,
  StockSummary,
  Supplier,
  User,
} from "./types";

const call = rpc;

async function withSession(p: Promise<{ user: SessionUser; token: string | null }>): Promise<SessionUser> {
  const r = await p;
  if (r.token) setToken(r.token);
  return r.user;
}

export const api = {
  // Authentification
  needsSetup: () => call<boolean>("needs_setup"),
  initialSetup: (input: {
    shop_name: string;
    shop_phone: string | null;
    shop_address: string | null;
    currency_symbol: string;
    currency_decimals: number;
    full_name: string;
    username: string;
    password: string;
  }) => withSession(call("initial_setup", { input })),
  login: (username: string, password: string) => withSession(call("login", { username, password })),
  loginPin: (user_id: number, pin: string) => withSession(call("login_pin", { user_id, pin })),
  listLoginUsers: () => call<{ id: number; username: string; full_name: string; role: Role; has_pin: boolean }[]>("list_login_users"),
  setMyPin: (password: string, pin: string) => call<SessionUser>("set_my_pin", { password, pin }),
  verifyPin: (pin: string, level: string, action?: string) => call<{ id: number; full_name: string; role: Role }>("verify_pin", { pin, level, action }),
  logout: async () => {
    await call<void>("logout").catch(() => undefined);
    setToken(null);
  },
  currentUser: () => call<SessionUser | null>("current_user"),
  changePassword: (current: string, password: string) => call<void>("change_password", { current, password }),

  // Utilisateurs
  listUsers: () => call<User[]>("list_users"),
  saveUser: (
    id: number | null,
    input: { username?: string; full_name: string; role: string; active: boolean; password?: string },
    pin: string,
  ) => call<void>("save_user", { id, input, pin }),
  resetUserPassword: (id: number, password: string, pin: string) => call<void>("reset_user_password", { id, password, pin }),
  resetUserPin: (id: number, new_pin: string, pin: string) => call<void>("reset_user_pin", { id, new_pin, pin }),

  // Paramètres
  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (values: Settings, pin: string) => call<Settings>("update_settings", { values, pin }),

  // Catalogue
  listCategories: () => call<Category[]>("list_categories"),
  saveCategory: (
    id: number | null,
    input: { name: string; color: string; image_id: number | null; parent_id: number | null; sort_order?: number; active?: boolean },
  ) => call<number>("save_category", { id, input }),
  setCategoryActive: (id: number, active: boolean) => call<void>("set_category_active", { id, active }),
  importCategories: (paths: string[]) => call<number>("import_categories", { paths }),
  businessProfiles: () => call<{ profiles: BusinessProfile[]; catalogue: CatalogueSummary[] }>("business_profiles"),
  catalogueTree: () => call<TemplateNode[]>("catalogue_tree"),
  seedCatalogue: (indexes: number[]) => call<number>("seed_catalogue", { indexes }),
  setBusinessType: (id: string, features: string[] | null, seed: boolean, pin?: string) =>
    call<{ created: number; settings: Settings }>("set_business_type", { id, features, seed, pin }),
  scanCode: (code: string) => call<ScanResult | null>("scan_code", { code }),
  deleteCategory: (id: number, pin: string) => call<void>("delete_category", { id, pin }),
  listProducts: (filter: {
    search?: string;
    category_id?: number | null;
    supplier_id?: number | null;
    location_id?: number | null;
    bloc?: string | null;
    without_location?: boolean;
    without_category?: boolean;
    expiring_days?: number;
    low_stock?: boolean;
    include_inactive?: boolean;
    limit?: number;
  } = {}) => call<Product[]>("list_products", { filter }),
  getProduct: (id: number) => call<Product>("get_product", { id }),
  findProductByBarcode: (code: string) => call<Product | null>("find_product_by_barcode", { code }),
  saveProduct: (id: number | null, input: ProductInput, pin?: string) => call<Product>("save_product", { id, input, pin }),
  archiveProduct: (id: number, pin: string) => call<void>("archive_product", { id, pin }),
  generateBarcode: () => call<string>("generate_barcode"),
  importProducts: (rows: ImportRow[], pin: string) => call<ImportResult>("import_products", { rows, pin }),
  uploadImage: (mime: string, data: string) => call<number>("upload_image", { mime, data }),

  // Emplacements
  listLocations: () => call<Location[]>("list_locations"),
  saveLocation: (id: number | null, input: { bloc: string; etage: string; rangee: string; label: string | null }) =>
    call<number>("save_location", { id, input }),
  deleteLocation: (id: number, pin: string) => call<void>("delete_location", { id, pin }),
  generateLocations: (input: { bloc: string; bloc_to: string | null; etage_from: number; etage_to: number; rangee_from: number; rangee_to: number; label: string | null }) =>
    call<number>("generate_locations", { input }),
  assignLocation: (location: number | null, products: number[]) => call<void>("assign_location", { location, products }),

  // Stock
  adjustStock: (input: { product_id: number; mode: "set" | "add" | "remove"; quantity: number; kind: string; note: string | null }, pin: string) =>
    call<number>("adjust_stock", { input, pin }),
  listStockMovements: (filter: { product_id?: number; kind?: string; from?: string; to?: string; limit?: number } = {}) =>
    call<StockMovement[]>("list_stock_movements", { filter }),
  stockSummary: () => call<StockSummary>("stock_summary"),

  // Fournisseurs
  listSuppliers: (search?: string) => call<Supplier[]>("list_suppliers", { search }),
  saveSupplier: (id: number | null, input: Partial<Supplier> & { name: string }) =>
    call<number>("save_supplier", { id, input }),
  archiveSupplier: (id: number, pin: string) => call<void>("archive_supplier", { id, pin }),

  // Clients
  listCustomers: (filter: { search?: string; with_debt?: boolean } = {}) =>
    call<Customer[]>("list_customers", { filter }),
  saveCustomer: (id: number | null, input: Partial<Customer> & { name: string }) =>
    call<Customer>("save_customer", { id, input }),
  archiveCustomer: (id: number, pin: string) => call<void>("archive_customer", { id, pin }),
  recordCustomerPayment: (input: { customer_id: number; amount: number; method: string; reference: string | null; phone: string | null; note: string | null }) =>
    call<Customer>("record_customer_payment", { input }),
  customerStatement: (id: number) => call<StatementLine[]>("customer_statement", { id }),

  // Ventes
  createSale: (input: SaleInput) => call<Sale>("create_sale", { input }),
  listSales: (filter: {
    from?: string;
    to?: string;
    search?: string;
    status?: string;
    payment_method?: string;
    customer_id?: number;
    session_id?: number;
    limit?: number;
  } = {}) => call<Sale[]>("list_sales", { filter }),
  getSale: (id: number) => call<Sale>("get_sale", { id }),
  cancelSale: (id: number, reason: string, pin: string) => call<Sale>("cancel_sale", { id, reason, pin }),
  listElectronicPayments: (filter: { from?: string; to?: string; method?: string; search?: string } = {}) =>
    call<ElectronicPayment[]>("list_electronic_payments", { filter }),

  // Achats
  createPurchase: (input: {
    supplier_id: number | null;
    items: { product_id: number; quantity: number; unit_cost: number; expiry_date: string | null }[];
    note: string | null;
    update_costs: boolean;
    new_sale_prices: [number, number][];
  }) => call<Purchase>("create_purchase", { input }),
  listPurchases: (filter: { from?: string; to?: string; supplier_id?: number } = {}) =>
    call<Purchase[]>("list_purchases", { filter }),
  getPurchase: (id: number) => call<Purchase>("get_purchase", { id }),

  // Caisse
  currentCashSession: () => call<CashSession | null>("current_cash_session"),
  openCashSession: (amount: number) => call<CashSession>("open_cash_session", { amount }),
  addCashMovement: (input: { kind: "in" | "out"; amount: number; reason: string }, pin: string) =>
    call<CashSession>("add_cash_movement", { input, pin }),
  listCashMovements: (id: number) => call<CashMovement[]>("list_cash_movements", { id }),
  forceCloseCashSession: (id: number, input: { counted_amount: number; note: string | null }, pin: string) =>
    call<CashSession>("force_close_cash_session", { id, input, pin }),
  listPostes: () => call<{ postes: PosteInfo[]; online: number }>("list_postes"),
  liveCartUpdate: (poste_id: string, poste: string, cart: LiveCartContent, status: string) =>
    call<{ taken_by: string | null }>("live_cart_update", { poste_id, poste, cart, status }),
  liveCarts: (except: string) => call<LiveCart[]>("live_carts", { except }),
  liveCartTake: (poste_id: string, pin: string) => call<LiveCart>("live_cart_take", { poste_id, pin }),
  cloudStatus: () => call<CloudStatus>("cloud_status"),
  cloudPublishNow: () => call<CloudStatus>("cloud_publish_now"),
  cashierStats: () => call<CashierStats>("cashier_stats"),
  closeCashSession: (input: { counted_amount: number; note: string | null }, pin: string) =>
    call<CashSession>("close_cash_session", { input, pin }),
  listCashSessions: (filter: { from?: string; to?: string; limit?: number } = {}) =>
    call<CashSession[]>("list_cash_sessions", { filter }),

  // Rapports & système
  dashboard: () => call<Dashboard>("dashboard"),
  salesReport: (from: string, to: string) => call<SalesReport>("sales_report", { from, to }),
  listAuditLog: (filter: { search?: string; from?: string; to?: string; limit?: number } = {}) =>
    call<AuditEntry[]>("list_audit_log", { filter }),
  appInfo: () => call<{ version: string; db_path: string; last_auto_backup: string | null }>("app_info"),
  backupDatabase: (path: string) => call<void>("backup_database", { path }),
  runAutoBackup: () => call<string>("run_auto_backup"),
  saveTextFile: (path: string, contents: string) => local<void>("save_text_file", { path, contents }),
  readTextFile: (path: string) => local<string>("read_text_file", { path }),

  // Plusieurs boutiques sur ce PC
  listBoutiques: () => local<BoutiquesInfo>("list_boutiques"),
  openBoutique: (slot: number) => local<string>("open_boutique", { slot }),
  createBoutique: () => local<number>("create_boutique"),

  // Écran client
  displayUpdate: (poste: string, state: unknown) => call<void>("display_update", { poste, state }),
  displayState: <T,>(poste: string) => call<T | null>("display_state", { poste }),
  serverInfo: () => call<{ shop_name: string; version: string }>("server_info"),

  // Abonnement et licence (Eden Dev)
  licenseStatus: () => call<LicenseStatus>("license_status"),
  licenseSync: () => call<LicenseStatus>("license_sync"),
  licenseImport: (text: string) => call<LicenseStatus>("license_import", { text }),
  accountOptions: () => call<AccountOptions>("account_options"),
  accountSignup: (input: StoreInput & { email: string; password: string }) => call<AccountLinkResult>("account_signup", { input }),
  accountLogin: (email: string, password: string) => call<{ email: string; stores: AccountStore[] }>("account_login", { email, password }),
  accountCreateStore: (input: StoreInput) => call<AccountLinkResult>("account_create_store", { input }),
  accountLink: (store_code: string) => call<AccountLinkResult>("account_link", { store_code }),
  accountPayments: () => call<SubscriptionPayment[]>("account_payments"),
  accountRedeemVoucher: (code: string) => call<VoucherResult>("account_redeem_voucher", { code }),
  accountDeclareOrangeMoney: (input: { plan: string; months: number; reference: string; payer_phone: string }) =>
    call<{ payment_id: string; amount: number; plan_label: string; months: number }>("account_declare_orange_money", input),
  accountCardStart: (plan: string, months: number) => call<CardStart>("account_card_start", { plan, months }),

  // Postes connectés
  listSessions: () => call<{ sessions: SessionInfo[]; max: number; used: number }>("list_sessions"),
  kickSession: (id: string) => call<void>("kick_session", { id }),
};
