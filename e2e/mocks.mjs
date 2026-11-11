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
  // Compte Eden Dev de la propriétaire (voir e2e/run.mjs) ; code « reçu par e-mail » après « mot de passe oublié ».
  const owner = { email: "proprietaire@exemple.ml", password: "Proprietaire-2026", code: null };
  const later = new Date(Date.now() + 20 * 86400e3).toISOString();
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
        const bearer = (req.headers.authorization || "").startsWith("Bearer acces-");
        if (url.pathname === "/auth/v1/token") {
          if (url.searchParams.get("grant_type") === "refresh_token") return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-e2e" });
          if (a.email === owner.email && a.password === owner.password) return send(200, { access_token: "acces-e2e", refresh_token: "rafraichissement-e2e" });
          return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        if (url.pathname === "/auth/v1/recover") {
          if (a.email === owner.email) owner.code = "246810";
          return send(200, {});
        }
        if (url.pathname === "/auth/v1/verify") {
          if (a.type === "recovery" && a.email === owner.email && owner.code && a.token === owner.code) {
            owner.code = null;
            return send(200, { access_token: "acces-recuperation", refresh_token: "rafraichissement-recuperation" });
          }
          return send(403, { error_code: "otp_expired", msg: "Token has expired or is invalid" });
        }
        if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
          if (!bearer) return send(401, { error_code: "bad_jwt", msg: "invalid JWT" });
          if (a.password === owner.password) return send(422, { error_code: "same_password", msg: "New password should be different" });
          owner.password = a.password;
          return send(200, { id: "proprietaire-e2e", email: owner.email });
        }
        if (url.pathname === "/rest/v1/rpc/gm_my_stores") {
          if (!bearer) return send(401, { message: "JWT expired" });
          return send(200, [{ code: "GM-E2E", name: "Boutique du compte E2E", city: "Bamako", status: "active", plan: "pro", plan_label: "PRO", ends_at: later, trial: false }]);
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
