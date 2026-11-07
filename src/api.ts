import { local, rpc, setToken } from "./lib/transport";
import type {
  AccountLinkResult,
  AccountOptions,
  AccountStore,
  AuditEntry,
  BackupStatus,
  BoutiquesInfo,
  BusinessProfile,
  CardStart,
  CashMovement,
  CashSession,
  CashierStats,
  CatalogueSummary,
  Category,
  CellFill,
  FloorStatus,
  SalesMap,
  StockAlert,
  CloudStatus,
  Customer,
  Dashboard,
  ElectronicPayment,
  Fixture,
  FixtureContents,
  ImportResult,
  ImportRow,
  LayoutInput,
  LicenseStatus,
  LiveCart,
  LiveCartContent,
  Location,
  Place,
  PosteInfo,
  Product,
  ProductInput,
  Purchase,
  Role,
  Sale,
  SaleInput,
  SalesReport,
  ScanResult,
  SessionInfo,
  SessionUser,
  Settings,
  StatementLine,
  LoyaltyMove,
  StockMovement,
  StockSummary,
  StoreInput,
  StorePlanData,
  SubscriptionPayment,
  Supplier,
  TemplateNode,
  User,
  VoucherResult,
  TeamMember,
  LoginInfo,
  LoginUser,
  TrustedDevice,
  AccessCode,
  LayoutPreview,
  TunnelStatus,
  QuoteLine,
  CreditNote,
  SaleReturn,
  ReturnInput,
  Promotion,
  PromotionInput,
  ZData,
  ZReport,
} from "./types";
import { getDeviceToken, setDeviceToken } from "./lib/device";

const call = rpc;

async function withSession(p: Promise<{ user: SessionUser; token: string | null }>): Promise<SessionUser> {
  const r = await p;
  if (r.token) setToken(r.token);
  return r.user;
}

/** Jeton du téléphone autorisé pour l'accès Internet, envoyé avec les connexions. */
const withDevice = () => ({ device: getDeviceToken() });

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
    pin: string;
    team: TeamMember[];
    lang?: string;
    country?: string;
    currency_code?: string;
    currency_position?: string;
  }) =>
    call<{ user: SessionUser; token: string | null; team: TeamMember[] }>("initial_setup", { input }).then((r) => {
      if (r.token) setToken(r.token);
      return r;
    }),
  loginInfo: () => call<LoginInfo>("login_info", withDevice()),
  login: (username: string, pin: string) => withSession(call("login", { username, pin, ...withDevice() })),
  loginPin: (user_id: number, pin: string) => withSession(call("login_pin", { user_id, pin })),
  loginPassword: (username: string, password: string) => withSession(call("login_password", { username, password })),
  listLoginUsers: () => call<LoginUser[]>("list_login_users"),
  authorizeDeviceAccount: async (email: string, password: string, label: string) => {
    const r = await call<{ device: string }>("authorize_device_account", { email, password, label });
    setDeviceToken(r.device);
  },
  authorizeDeviceCode: async (username: string, pin: string, code: string, label: string) => {
    const r = await call<{ device: string; user: SessionUser; token: string | null }>("authorize_device_code", { username, pin, code, label });
    setDeviceToken(r.device);
    if (r.token) setToken(r.token);
    return r.user;
  },
  resetAdminPin: (email: string, password: string, pin: string, username?: string) =>
    call<{ username: string; full_name: string }>("reset_admin_pin", { email, password, pin, username }),
  setMyPin: (password: string, pin: string) => call<SessionUser>("set_my_pin", { password, pin }),
  changeMyPin: (current: string, pin: string) => call<void>("change_my_pin", { current, pin }),
  listApprovers: (level: string) => call<LoginUser[]>("list_approvers", { level }),
  verifyPin: (pin: string, level: string, action?: string) => call<{ id: number; full_name: string; role: Role }>("verify_pin", { pin, level, action }),
  logout: async () => {
    await call<void>("logout").catch(() => undefined);
    setToken(null);
  },
  currentUser: () => call<SessionUser | null>("current_user"),
  setMyLang: (lang: string) => call<SessionUser>("set_my_lang", { lang }),

  // Personnel
  listUsers: () => call<User[]>("list_users"),
  suggestStaff: (role: Role) => call<{ username: string; pin: string }>("suggest_staff", { role }),
  saveUser: (
    id: number | null,
    input: { username?: string; full_name: string; role: string; active: boolean; pin?: string; internet_access?: boolean },
    pin: string,
  ) => call<void>("save_user", { id, input, pin }),
  resetUserPin: (id: number, new_pin: string, pin: string) => call<void>("reset_user_pin", { id, new_pin, pin }),
  deleteUser: (id: number, pin: string) => call<{ erased: boolean }>("delete_user", { id, pin }),
  listDevices: () => call<TrustedDevice[]>("list_devices"),
  revokeDevice: (id: number) => call<void>("revoke_device", { id }),
  createAccessCode: (user_id: number, pin: string) => call<AccessCode>("create_access_code", { user_id, pin }),

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
  setBusinessType: (ids: string[], features: string[] | null, seed: boolean, pin?: string) =>
    call<{ created: number; settings: Settings }>("set_business_type", { ids, id: ids[0], features, seed, pin }),
  scanCode: (code: string) => call<ScanResult | null>("scan_code", { code }),
  deleteCategory: (id: number, pin: string) => call<void>("delete_category", { id, pin }),
  listProducts: (filter: {
    search?: string;
    category_id?: number | null;
    supplier_id?: number | null;
    location_id?: number | null;
    bloc?: string | null;
    fixture_id?: number | null;
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
  deleteLocation: (id: number, pin: string) => call<void>("delete_location", { id, pin }),
  generateLocations: (input: { bloc: string; bloc_to: string | null; etage_from: number; etage_to: number; rangee_from: number; rangee_to: number; label: string | null }) =>
    call<number>("generate_locations", { input }),
  assignLocation: (location: number | null, products: number[]) => call<void>("assign_location", { location, products }),
  planGet: () => call<StorePlanData>("plan_get"),
  planFixtureContents: (id: number) => call<FixtureContents>("plan_fixture_contents", { id }),
  productPlaces: (product_id: number) => call<Place[]>("product_places", { product_id }),
  planSaveFloor: (id: number | null, input: { name: string; width: number; depth: number; wall_height?: number; floor_style?: string }) =>
    call<number>("plan_save_floor", { id, input }),
  planFloorFill: (floor_id: number) => call<CellFill[]>("plan_floor_fill", { floor_id }),
  planFloorStatus: (floor_id: number) => call<FloorStatus>("plan_floor_status", { floor_id }),
  planFixtureAlerts: (id: number) => call<StockAlert[]>("plan_fixture_alerts", { id }),
  planSalesMap: (from: string, to: string) => call<SalesMap>("plan_sales_map", { from, to }),
  planGenerateLayout: (input: LayoutInput) => call<number>("plan_generate_layout", { input }),
  planPreviewLayout: (input: LayoutInput) => call<LayoutPreview>("plan_preview_layout", { input }),
  planSetBackdrop: (input: { floor_id: number; media_id: number | null; x?: number; y?: number; w?: number; h?: number; opacity?: number }) =>
    call<void>("plan_set_backdrop", { input }),
  planDeleteFloor: (id: number, pin: string) => call<void>("plan_delete_floor", { id, pin }),
  planSaveFixture: (id: number | null, input: Partial<Omit<Fixture, "id" | "color">> & { color?: string | null }) =>
    call<Fixture>("plan_save_fixture", { id, input }),
  planMoveFixtures: (items: { id: number; x: number; y: number; w: number; h: number; rotation: number }[]) =>
    call<void>("plan_move_fixtures", { items }),
  planDeleteFixture: (id: number, pin?: string | null) => call<number>("plan_delete_fixture", { id, pin }),
  planSaveType: (
    id: number | null,
    input: {
      name: string;
      category: string;
      prefix: string;
      color: string;
      width: number;
      depth: number;
      levels: number;
      sections: number;
      model?: string;
      height?: number;
    },
  ) => call<number>("plan_save_type", { id, input }),
  planDeleteType: (id: number) => call<void>("plan_delete_type", { id }),
  planPut: (input: { product_id: number; location_id: number; from_location_id?: number | null; primary?: boolean }) =>
    call<Place[]>("plan_put", { input }),
  planTake: (product_id: number, location_id: number) => call<Place[]>("plan_take", { product_id, location_id }),
  planSetPrimary: (product_id: number, location_id: number) => call<Place[]>("plan_set_primary", { product_id, location_id }),

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
  listCustomers: (filter: { search?: string; with_debt?: boolean; with_funds?: boolean } = {}) =>
    call<Customer[]>("list_customers", { filter }),
  saveCustomer: (id: number | null, input: Partial<Customer> & { name: string }) =>
    call<Customer>("save_customer", { id, input }),
  archiveCustomer: (id: number, pin: string) => call<void>("archive_customer", { id, pin }),
  recordCustomerPayment: (input: { customer_id: number; amount: number; method: string; reference: string | null; phone: string | null; note: string | null }) =>
    call<Customer>("record_customer_payment", { input }),
  customerStatement: (id: number) => call<StatementLine[]>("customer_statement", { id }),
  /** Fonds rendus au client : PIN d'un gestionnaire ou de l'administrateur. */
  refundCustomerFunds: (
    input: { customer_id: number; amount: number; method: string; reference: string | null; phone: string | null; note: string | null },
    pin: string,
  ) => call<Customer>("refund_customer_funds", { input, pin }),
  customerLoyaltyHistory: (id: number) => call<LoyaltyMove[]>("customer_loyalty_history", { id }),
  customerCard: (id: number) => call<string>("customer_card", { id }),
  customerByCard: (code: string) => call<Customer | null>("customer_by_card", { code }),
  loyaltyConvertPoints: (perPoint: number) => call<number>("loyalty_convert_points", { per_point: perPoint }),

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
  saleQuote: (items: { product_id: number; quantity: number; packaging_id: number | null }[], customer_id: number | null) =>
    call<QuoteLine[]>("sale_quote", { items, customer_id }),
  // Retours et avoirs (validés par le PIN d'un gestionnaire ou de l'administrateur)
  createReturn: (input: ReturnInput, pin: string) => call<SaleReturn>("create_return", { input, pin }),
  listReturns: (filter?: { from?: string; to?: string; sale_id?: number; session_id?: number }) => call<SaleReturn[]>("list_returns", { filter }),
  getReturn: (id: number) => call<SaleReturn>("get_return", { id }),
  getCreditNote: (code: string) => call<CreditNote>("get_credit_note", { code }),
  listCreditNotes: (filter?: { search?: string; status?: string }) => call<CreditNote[]>("list_credit_notes", { filter }),
  // Promotions
  listPromotions: () => call<Promotion[]>("list_promotions"),
  savePromotion: (input: PromotionInput) => call<Promotion>("save_promotion", { input }),
  deletePromotion: (id: number) => call<{ ok: boolean }>("delete_promotion", { id }),
  // Rapports X (caisse en cours) et Z (clôtures)
  cashXReport: (session_id?: number) => call<ZData>("cash_x_report", { session_id: session_id ?? null }),
  listZReports: (filter?: { from?: string; to?: string }) => call<ZReport[]>("list_z_reports", { filter }),
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
  tunnelStatus: () => call<TunnelStatus>("tunnel_status"),
  tunnelSetup: (email: string, password: string) => call<TunnelStatus>("tunnel_setup", { email, password }),
  tunnelRemove: () => call<TunnelStatus>("tunnel_remove"),
  cashierStats: () => call<CashierStats>("cashier_stats"),
  closeCashSession: (input: { counted_amount: number; note: string | null }, pin: string) =>
    call<CashSession>("close_cash_session", { input, pin }),
  listCashSessions: (filter: { from?: string; to?: string; limit?: number } = {}) =>
    call<CashSession[]>("list_cash_sessions", { filter }),

  // Rapports & système
  dashboard: () => call<Dashboard>("dashboard"),
  salesReport: (from: string, to: string) => call<SalesReport>("sales_report", { from, to }),
  listAuditLog: (filter: { search?: string; from?: string; to?: string; limit?: number; user_id?: number } = {}) =>
    call<AuditEntry[]>("list_audit_log", { filter }),
  appInfo: () => call<{ version: string; db_path: string; last_auto_backup: string | null }>("app_info"),
  backupDatabase: (path: string) => call<void>("backup_database", { path }),
  runAutoBackup: () => call<string>("run_auto_backup"),
  backupStatus: () => call<BackupStatus>("backup_status"),
  saveTextFile: (path: string, contents: string) => local<void>("save_text_file", { path, contents }),
  saveBinaryFile: (path: string, base64: string) => local<void>("save_binary_file", { path, base64 }),
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
