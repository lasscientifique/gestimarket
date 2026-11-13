// Doublures pour le test d'interface (CI Linux) :
//   node e2e/mocks.mjs tunnel    → faux tunnel Cloudflare : :8080 → :7878, ajoute cf-connecting-ip et cf-ray
//                                  (comme cloudflared, qui tourne sur le PC serveur et arrive depuis 127.0.0.1)
//   node e2e/mocks.mjs supabase  → fausse API Supabase sur :54321 (gm_publish_server / gm_get_server, compte de la
//                                  propriétaire : connexion, boutiques, paiements, mot de passe oublié ou changé, licence)
import http from "node:http";

const mode = process.argv[2];

if (mode === "tunnel") {
  http
    .createServer((req, res) => {
      const headers = { ...req.headers, host: "127.0.0.1:7878", "cf-connecting-ip": "41.73.10.20", "cf-ray": "e2e-test" };
      const up = http.request({ host: "127.0.0.1", port: 7878, method: req.method, path: req.url, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("tunnel: serveur injoignable");
      });
      req.pipe(up);
    })
    .listen(8080, "127.0.0.1", () => console.log("tunnel prêt sur :8080"));
} else if (mode === "supabase") {
  let last = null;
  // Compte Eden Dev de la propriétaire (voir e2e/run.mjs) ; code « reçu par e-mail » après « mot de passe oublié »,
  // et code envoyé à la nouvelle adresse quand elle change d'e-mail (« Confirm email » activé).
  // 0.26 : numéro WhatsApp ajouté au compte (code 556677), puis « mot de passe oublié » par WhatsApp (code 778899).
  const owner = {
    email: "proprietaire@exemple.ml", password: "Proprietaire-2026", code: null, newEmail: null, changeCode: null,
    phone: "", otp: null, newPhone: null, phoneCode: null,
  };
  // Compte inscrit dont l'adresse n'est pas encore confirmée (code reçu à l'inscription).
  const pending = { email: "nouvelle@exemple.ml", password: "Nouvelle-2026", code: "135790", confirmed: false };
  // Compte créé avec un numéro WhatsApp, pas encore confirmé (code reçu sur WhatsApp : 112233).
  const wa = { phone: "22370000001", password: "Whatsapp-2026", code: "112233", confirmed: false };
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  // Formulaire d'inscription et options (connexion par WhatsApp ouverte).
  const OPTIONS = {
    shop_types: [{ code: "superette", label: "Supérette" }],
    countries: [{ code: "ML", label: "Mali", currency: "XOF" }],
    plans: [{ code: "pro", label: "PRO", price_month: 18000, max_postes: 3, features: ["write", "server", "internet"], description: "3 postes", prices: { XOF: 18000 } }],
    payment_instructions: "",
    trial_days: 14,
    payment: { om_merchant_code: "", om_merchant_name: "", om_qr_payload: "", card_enabled: false, card_currency: "XOF", card_currencies: ["XOF"] },
    whatsapp: true,
    whatsapp_number: "+22376000000",
  };
  const later = new Date(Date.now() + 20 * 86400e3).toISOString();
  // Boutique du compte : informations modifiables par la propriétaire (gm_update_store).
  const store = {
    code: "GM-E2E", name: "Boutique du compte E2E", owner_name: "Propriétaire E2E", phone: "", city: "Bamako", address: "ACI 2000",
    status: "active", plan: "pro", plan_label: "PRO", ends_at: later, trial: false,
  };
  http
    .createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const url = new URL(req.url, "http://127.0.0.1");
        const a = (() => {
          try {
            return JSON.parse(body || "{}");
          } catch {
            return {};
          }
        })();
        const send = (status, v) => {
          res.statusCode = status;
          res.end(JSON.stringify(v));
        };
        const auth = req.headers.authorization || "";
        const bearer = auth.startsWith("Bearer acces-");
        if (url.pathname === "/auth/v1/token") {
          if (url.searchParams.get("grant_type") === "refresh_token") return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-e2e" });
          if (a.email === owner.email && a.password === owner.password) return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-e2e" });
          if (a.email === pending.email && a.password === pending.password) {
            if (!pending.confirmed) return send(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
            return send(200, { access_token: "acces-nouvelle", refresh_token: "rafraichissement-nouvelle" });
          }
          if (a.phone && digits(a.phone) === wa.phone && a.password === wa.password) {
            if (!wa.confirmed) return send(400, { error_code: "phone_not_confirmed", msg: "Phone not confirmed" });
            return send(200, { access_token: "acces-whatsapp", refresh_token: "rafraichissement-whatsapp" });
          }
          if (a.phone && owner.phone && digits(a.phone) === owner.phone && a.password === owner.password) {
            return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-e2e" });
          }
          return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        if (url.pathname === "/auth/v1/recover") {
          if (a.email === owner.email) owner.code = "246810";
          return send(200, {});
        }
        if (url.pathname === "/auth/v1/resend") {
          if (a.type === "signup" && a.email === pending.email) pending.code = "135790";
          if (a.type === "sms" && digits(a.phone) === wa.phone) wa.code = "112233";
          return send(200, {});
        }
        // Code sur WhatsApp (connexion sans mot de passe, mot de passe oublié) : jamais de création de compte.
        if (url.pathname === "/auth/v1/otp") {
          if (digits(a.phone) === wa.phone) wa.code = "112233";
          else if (owner.phone && digits(a.phone) === owner.phone) owner.otp = "778899";
          else return send(422, { error_code: "otp_disabled", msg: "Signups not allowed for otp" });
          return send(200, {});
        }
        if (url.pathname === "/auth/v1/user" && req.method === "GET") {
          if (auth === "Bearer acces-whatsapp") return send(200, { id: "whatsapp-e2e", email: "", phone: wa.phone });
          if (!bearer) return send(401, { error_code: "bad_jwt", msg: "invalid JWT" });
          return send(200, { id: "proprietaire-e2e", email: owner.email, phone: owner.phone });
        }
        if (url.pathname === "/auth/v1/verify") {
          if (a.type === "recovery" && a.email === owner.email && owner.code && a.token === owner.code) {
            owner.code = null;
            return send(200, { access_token: "acces-recuperation", refresh_token: "rafraichissement-recuperation" });
          }
          if (a.type === "signup" && a.email === pending.email && pending.code && a.token === pending.code) {
            pending.confirmed = true;
            pending.code = null;
            return send(200, { access_token: "acces-nouvelle", refresh_token: "rafraichissement-nouvelle" });
          }
          if (a.type === "email_change" && owner.newEmail && a.email === owner.newEmail && a.token === owner.changeCode) {
            owner.email = owner.newEmail;
            owner.newEmail = owner.changeCode = null;
            return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-changement" });
          }
          if (a.type === "sms" && digits(a.phone) === wa.phone && wa.code && a.token === wa.code) {
            wa.confirmed = true;
            wa.code = null;
            return send(200, { access_token: "acces-whatsapp", refresh_token: "rafraichissement-whatsapp" });
          }
          if (a.type === "sms" && owner.phone && digits(a.phone) === owner.phone && owner.otp && a.token === owner.otp) {
            owner.otp = null;
            return send(200, { access_token: "acces-recuperation", refresh_token: "rafraichissement-recuperation" });
          }
          if (a.type === "phone_change" && owner.newPhone && digits(a.phone) === owner.newPhone && a.token === owner.phoneCode) {
            owner.phone = owner.newPhone;
            owner.newPhone = owner.phoneCode = null;
            return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-numero" });
          }
          return send(403, { error_code: "otp_expired", msg: "Token has expired or is invalid" });
        }
        if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
          if (!bearer) return send(401, { error_code: "bad_jwt", msg: "invalid JWT" });
          if (a.phone) {
            if (digits(a.phone) === wa.phone) return send(422, { error_code: "phone_exists", msg: "A user with this phone number has already been registered" });
            owner.newPhone = digits(a.phone);
            owner.phoneCode = "556677";
            return send(200, { id: "proprietaire-e2e", email: owner.email, phone: owner.phone, phone_change: owner.newPhone });
          }
          if (a.email) {
            if (a.email === pending.email) return send(422, { error_code: "email_exists", msg: "A user with this email address has already been registered" });
            owner.newEmail = a.email;
            owner.changeCode = "975310";
            return send(200, { id: "proprietaire-e2e", email: owner.email, new_email: a.email });
          }
          if (a.password === owner.password) return send(422, { error_code: "same_password", msg: "New password should be different" });
          owner.password = a.password;
          return send(200, { id: "proprietaire-e2e", email: owner.email });
        }
        if (url.pathname === "/rest/v1/rpc/gm_my_stores") {
          if (!bearer) return send(401, { message: "JWT expired" });
          return send(200, auth === "Bearer acces-nouvelle" || auth === "Bearer acces-whatsapp" ? [] : [store]);
        }
        if (url.pathname === "/rest/v1/rpc/gm_public_options") return send(200, OPTIONS);
        if (url.pathname === "/rest/v1/rpc/gm_update_store") {
          if (!bearer) return send(401, { message: "JWT expired" });
          if (a.p_store_code !== store.code) return send(400, { message: "Boutique introuvable sur ce compte." });
          for (const k of ["owner_name", "city", "address"]) {
            if (!String(a.p?.[k] ?? "").trim()) return send(400, { message: `Champ obligatoire manquant : ${k}` });
          }
          Object.assign(store, { owner_name: a.p.owner_name, phone: a.p.phone ?? "", city: a.p.city, address: a.p.address });
          return send(200, store);
        }
        if (url.pathname === "/rest/v1/rpc/gm_my_server") {
          return send(200, { found: true, active: true, url: "http://127.0.0.1:7878", public_url: "http://127.0.0.1:8080", version: "0.23.0", last_seen: new Date().toISOString(), seconds_ago: 5 });
        }
        if (url.pathname === "/rest/v1/rpc/gm_my_payments") {
          return send(200, [{ id: "paiement-e2e", created_at: new Date().toISOString(), method: "orange_money", plan: "pro", plan_label: "PRO", months: 1, amount: 18000, currency: "XOF", status: "pending" }]);
        }
        if (url.pathname === "/functions/v1/gm-license") return send(200, { status: "unregistered", server_time: new Date().toISOString() });
        if (req.url.endsWith("/rpc/gm_publish_server")) {
          const a = JSON.parse(body || "{}");
          last = { ...a, at: Date.now() };
          res.end(JSON.stringify({ ok: true, shop_code: a.p_shop_code }));
        } else if (req.url.endsWith("/rpc/gm_get_server")) {
          res.end(JSON.stringify(last ? { found: true, active: last.p_active, ...last.p_payload } : { found: false, active: false }));
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    })
    .listen(54321, "127.0.0.1", () => console.log("supabase factice prêt sur :54321"));
} else {
  console.error("usage : node e2e/mocks.mjs tunnel|supabase");
  process.exit(2);
}
