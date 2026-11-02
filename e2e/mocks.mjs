// Doublures pour le test d'interface (CI Linux) :
//   node e2e/mocks.mjs tunnel    → faux tunnel Cloudflare : :8080 → :7878, ajoute cf-connecting-ip et cf-ray
//                                  (comme cloudflared, qui tourne sur le PC serveur et arrive depuis 127.0.0.1)
//   node e2e/mocks.mjs supabase  → fausse API Supabase sur :54321 (gm_publish_server / gm_get_server)
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
  http
    .createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
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
