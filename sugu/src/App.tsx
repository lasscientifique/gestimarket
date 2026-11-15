import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AUDIENCES, CONDITIONS, api, countryName, photoUrl, price, whatsappLink, type Home, type Item, type ProductPage, type Shop, type TaxNode } from "./api";

// ───────────────────────────── Pages derrière « # » ─────────────────────────────
// #/                         accueil
// #/r?q=riz&ville=Bamako     recherche (q, pays, ville, cat)
// #/p/<id>                   fiche produit
// #/b/<boutique>             page d'une boutique
// #/c/<classement>           catégorie, section ou sous-catégorie (« femmes/vetements/robes »)

type Route = { page: "home" | "results" | "product" | "shop" | "category" | "missing"; id: string; query: URLSearchParams };

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const query = new URLSearchParams(qs);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { page: "home", id: "", query };
  if (parts[0] === "r") return { page: "results", id: "", query };
  if (parts[0] === "p" && parts[1]) return { page: "product", id: decodeURIComponent(parts[1]), query };
  if (parts[0] === "b" && parts[1]) return { page: "shop", id: decodeURIComponent(parts[1]), query };
  if (parts[0] === "c" && parts[1]) return { page: "category", id: parts.slice(1).map(decodeURIComponent).join("/"), query };
  return { page: "missing", id: "", query };
}

function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

const go = (hash: string) => {
  window.location.hash = hash;
};

function searchHash(p: { q?: string; pays?: string; ville?: string; cat?: string }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  return `#/r?${q.toString()}`;
}

// Pays et ville choisis : gardés sur ce téléphone (rien n'est envoyé).
function remembered(key: string): string {
  try {
    return localStorage.getItem(`sugu-${key}`) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(`sugu-${key}`, value);
  } catch {
    /* stockage indisponible */
  }
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    load().then(
      (data) => live && setState({ data, error: null }),
      (e: Error) => live && setState({ data: null, error: e.message }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// ───────────────────────────── Morceaux communs ─────────────────────────────

function Header({ q }: { q?: string }) {
  const [text, setText] = useState(q ?? "");
  useEffect(() => setText(q ?? ""), [q]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(searchHash({ q: text.trim(), pays: remembered("pays"), ville: remembered("ville") }));
  };
  return (
    <header className="top">
      <a className="brand" href="#/">
        <img src="./sugu.svg" alt="" width={34} height={34} />
        <span>
          <strong>Sugu Eden</strong>
          <small>Les boutiques près de chez vous</small>
        </span>
      </a>
      <form className="search" onSubmit={submit} role="search">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Riz, savon, téléphone, pièce auto…" aria-label="Rechercher un produit" enterKeyHint="search" />
        <button type="submit">Chercher</button>
      </form>
    </header>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <p>
        <strong>Sugu Eden</strong>, la place de marché d'<strong>Eden Dev</strong>. Chaque produit vient d'une vraie boutique, équipée du logiciel de
        caisse GestiMarket : prix et disponibilité suivent la boutique.
      </p>
      <p>Vous commandez directement à la boutique (WhatsApp ou appel) ; vous payez la boutique, au retrait ou à la livraison.</p>
      <p>
        Vous avez une boutique ? <a href="https://wa.me/22397126202?text=Sugu%20Eden%20:%20je%20veux%20publier%20ma%20boutique">Contactez Eden Dev</a>.
      </p>
    </footer>
  );
}

function Layout({ q, children }: { q?: string; children: ReactNode }) {
  return (
    <div className="app">
      <Header q={q} />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

function Photo({ path, alt, big }: { path: string | null; alt: string; big?: boolean }) {
  const src = photoUrl(path);
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={`photo empty ${big ? "big" : ""}`} aria-hidden>{alt.slice(0, 1).toUpperCase()}</div>;
  return <img className={`photo ${big ? "big" : ""}`} src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

function Card({ item }: { item: Item }) {
  return (
    <a className="card" href={`#/p/${item.id}`}>
      <Photo path={item.photo} alt={item.name} />
      <div className="card-body">
        <div className="name">{item.name}</div>
        <div className="price">{price(item)}{item.unit && item.unit !== "pce" ? <small> / {item.unit}</small> : null}</div>
        <div className="where">{item.shop.name} · {item.shop.city}</div>
        {!item.in_stock && <span className="tag out">Épuisé</span>}
      </div>
    </a>
  );
}

function Grid({ items }: { items: Item[] }) {
  return (
    <div className="grid">
      {items.map((i) => (
        <Card key={i.id} item={i} />
      ))}
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="message">{children}</div>;
}

function Loading() {
  return <Message>Chargement…</Message>;
}

// ───────────────────────────── Accueil ─────────────────────────────

function HomePage() {
  const [country, setCountry] = useState(remembered("pays"));
  const home = useLoad<Home>(() => api.home(country), [country]);
  const latest = useLoad(() => api.search({ country, limit: 24 }), [country]);
  const pick = (c: string) => {
    remember("pays", c);
    remember("ville", "");
    setCountry(c);
  };
  const h = home.data;
  return (
    <Layout>
      <section className="hero">
        <h1>Les produits des boutiques de votre ville</h1>
        <p>Prix réels, disponibilité à jour. Commandez par WhatsApp, directement à la boutique.</p>
        {h && h.countries.length > 1 && (
          <label className="country">
            Pays{" "}
            <select value={country} onChange={(e) => pick(e.target.value)}>
              <option value="">Tous les pays</option>
              {h.countries.map((c) => (
                <option key={c.code} value={c.code}>{countryName(c.code)}</option>
              ))}
            </select>
          </label>
        )}
      </section>
      {home.error && <Message>{home.error}</Message>}
      {h && h.cities.length > 0 && (
        <section>
          <h2>Villes</h2>
          <div className="chips">
            {h.cities.map((c) => (
              <a key={c.city} className="chip" href={searchHash({ pays: country, ville: c.city })} onClick={() => remember("ville", c.city)}>
                {c.city} <small>{c.shops}</small>
              </a>
            ))}
          </div>
        </section>
      )}
      {h && h.categories.length > 0 && (
        <section>
          <h2>Catégories</h2>
          <div className="chips">
            {h.categories.map((c) => (
              <a key={c.code ?? c.category} className="chip" href={c.code ? `#/c/${c.code}` : searchHash({ pays: country, ville: remembered("ville"), cat: c.category })}>
                {c.category} <small>{c.products}</small>
              </a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>Nouveautés</h2>
        {latest.error && <Message>{latest.error}</Message>}
        {!latest.data && !latest.error && <Loading />}
        {latest.data && latest.data.items.length === 0 && (
          <Message>Les premières boutiques arrivent bientôt sur Sugu Eden. Revenez vite !</Message>
        )}
        {latest.data && <Grid items={latest.data.items} />}
      </section>
      {h && h.shops.length > 0 && (
        <section>
          <h2>Boutiques</h2>
          <div className="shops">
            {h.shops.map((s) => (
              <a key={s.slug} className="shop-tile" href={`#/b/${s.slug}`}>
                <Photo path={s.logo} alt={s.name} />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.city} · {s.products} produit(s)</small>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </Layout>
  );
}

// ───────────────────────────── Recherche ─────────────────────────────

function ResultsPage({ query }: { query: URLSearchParams }) {
  const q = query.get("q") ?? "";
  const country = query.get("pays") ?? "";
  const city = query.get("ville") ?? "";
  const category = query.get("cat") ?? "";
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = `${q}|${country}|${city}|${category}`;

  const fetchPage = (offset: number) => {
    setBusy(true);
    api
      .search({ q, country, city, category, offset })
      .then((r) => {
        setItems((old) => (offset === 0 ? r.items : [...old, ...r.items]));
        setTotal(r.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    setItems([]);
    setTotal(null);
    fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const filters = [
    q && `« ${q} »`,
    category,
    city,
    country && countryName(country),
  ].filter(Boolean);
  return (
    <Layout q={q}>
      <section>
        <h1 className="results-title">{total === null ? "Recherche…" : `${total} produit(s)`}</h1>
        {filters.length > 0 && (
          <div className="chips">
            {filters.map((f) => <span key={f as string} className="chip static">{f}</span>)}
            <a className="chip clear" href="#/">Tout effacer</a>
          </div>
        )}
        {error && <Message>{error}</Message>}
        {total === 0 && <Message>Aucun produit trouvé. Essayez un autre mot, ou une autre ville.</Message>}
        <Grid items={items} />
        {total !== null && items.length < total && (
          <button className="more" disabled={busy} onClick={() => fetchPage(items.length)}>{busy ? "Chargement…" : "Voir plus"}</button>
        )}
      </section>
    </Layout>
  );
}

// ───────────────────────────── Fiche produit ─────────────────────────────

function ContactButtons({ shop, message }: { shop: Shop; message: string }) {
  const wa = whatsappLink(shop.whatsapp, message);
  const phone = (shop.phone || shop.whatsapp).replace(/[^0-9+]/g, "");
  return (
    <div className="contact">
      {wa && <a className="btn wa" href={wa} target="_blank" rel="noopener noreferrer">Commander sur WhatsApp</a>}
      {phone && <a className="btn call" href={`tel:${phone}`}>Appeler la boutique</a>}
    </div>
  );
}

function ProductView({ id }: { id: string }) {
  const page = useLoad<ProductPage>(() => api.product(id), [id]);
  if (page.error) return <Layout><Message>{page.error}</Message></Layout>;
  if (!page.data) return <Layout><Loading /></Layout>;
  const { product: p, shop, more } = page.data;
  if (!page.data.found || !p || !shop) {
    return <Layout><Message>Ce produit n'est plus sur Sugu Eden. <a href="#/">Voir les autres produits</a></Message></Layout>;
  }
  const link = window.location.href;
  const message = `Bonjour ${shop.name}, je souhaite commander : ${p.name} (${price(p)}), vu sur Sugu Eden : ${link}`;
  const gallery = p.photos && p.photos.length ? p.photos : p.photo ? [p.photo] : [];
  return (
    <Layout>
      {p.code && <Breadcrumb code={p.code} />}
      <article className="product">
        <Gallery photos={gallery} alt={p.name} />
        <div className="product-info">
          <h1>{p.name}</h1>
          {(p.condition && p.condition !== "new") || p.audience ? (
            <div className="tags">
              {p.condition && p.condition !== "new" && <span className="tag">{CONDITIONS[p.condition]}</span>}
              {p.audience && <span className="tag">{AUDIENCES[p.audience]}</span>}
            </div>
          ) : null}
          <div className="price big">{price(p)}{p.unit && p.unit !== "pce" ? <small> / {p.unit}</small> : null}</div>
          <p className={p.in_stock ? "stock in" : "stock out"}>
            {p.in_stock ? (p.stock !== null ? `En stock : ${p.stock}` : "En stock") : "Épuisé pour le moment"}
          </p>
          {(p.brand || p.category) && <p className="muted">{[p.brand, p.category].filter(Boolean).join(" · ")}</p>}
          {p.description && <p className="desc">{p.description}</p>}
          <a className="shop-line" href={`#/b/${shop.slug}`}>
            <Photo path={shop.logo} alt={shop.name} />
            <span>
              <strong>{shop.name}</strong>
              <small>{[shop.address, shop.city, countryName(shop.country)].filter(Boolean).join(", ")}</small>
            </span>
          </a>
          <ContactButtons shop={shop} message={message} />
          <p className="muted small">Vous payez directement la boutique, au retrait ou à la livraison convenue avec elle.</p>
        </div>
      </article>
      {more && more.length > 0 && (
        <section>
          <h2>Aussi chez {shop.name}</h2>
          <Grid items={more} />
        </section>
      )}
    </Layout>
  );
}

/** Photos du produit : la grande, puis les petites à toucher pour la changer. */
function Gallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
  if (photos.length === 0) return <Photo path={null} alt={alt} big />;
  return (
    <div className="gallery">
      <Photo path={photos[Math.min(index, photos.length - 1)]} alt={alt} big />
      {photos.length > 1 && (
        <div className="thumbs">
          {photos.map((ph, i) => (
            <button key={ph} type="button" className={i === index ? "active" : ""} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`}>
              <Photo path={ph} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** « Femmes › Vêtements › Robes », chaque niveau cliquable. */
function Breadcrumb({ code }: { code: string }) {
  const tax = useLoad(() => api.taxonomy(), []);
  const nodes = tax.data ?? [];
  const chain: TaxNode[] = [];
  let at: string | null = code;
  while (at) {
    const node: TaxNode | undefined = nodes.find((n) => n.code === at);
    if (!node) break;
    chain.unshift(node);
    at = node.parent;
  }
  if (chain.length === 0) return null;
  return (
    <nav className="crumbs">
      <a href="#/">Accueil</a>
      {chain.map((n) => (
        <span key={n.code}> › <a href={`#/c/${n.code}`}>{n.name}</a></span>
      ))}
    </nav>
  );
}

// ───────────────────────────── Catégorie, section, sous-catégorie ─────────────────────────────

function CategoryPage({ code }: { code: string }) {
  const country = remembered("pays");
  const tax = useLoad(() => api.taxonomy(), []);
  const counts = useLoad(() => api.counts(country), [country]);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchPage = (offset: number) => {
    setBusy(true);
    api
      .search({ code, country, offset })
      .then((r) => {
        setItems((old) => (offset === 0 ? r.items : [...old, ...r.items]));
        setTotal(r.total);
      })
      .catch(() => setTotal(0))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    setItems([]);
    setTotal(null);
    fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, country]);
  const nodes = tax.data ?? [];
  const node = nodes.find((n) => n.code === code);
  const children = nodes.filter((n) => n.parent === code && (counts.data?.[n.code] ?? 0) > 0);
  if (tax.data && !node) return <Layout><Message>Rayon introuvable. <a href="#/">Retour à l'accueil</a></Message></Layout>;
  return (
    <Layout>
      <Breadcrumb code={code} />
      <section>
        <h1 className="results-title">{node?.name ?? "…"} {total !== null && <small className="muted">· {total} produit(s)</small>}</h1>
        {children.length > 0 && (
          <div className="chips">
            {children.map((c) => (
              <a key={c.code} className="chip" href={`#/c/${c.code}`}>
                {c.name} <small>{counts.data?.[c.code]}</small>
              </a>
            ))}
          </div>
        )}
        {total === 0 && <Message>Pas encore de produits ici. <a href="#/">Voir les autres rayons</a></Message>}
        <Grid items={items} />
        {total !== null && items.length < total && (
          <button className="more" disabled={busy} onClick={() => fetchPage(items.length)}>{busy ? "Chargement…" : "Voir plus"}</button>
        )}
      </section>
    </Layout>
  );
}

// ───────────────────────────── Boutique ─────────────────────────────

function ShopView({ slug }: { slug: string }) {
  const shop = useLoad<Shop>(() => api.shop(slug), [slug]);
  const items = useLoad(() => api.search({ shop: slug, limit: 60 }), [slug]);
  if (shop.error) return <Layout><Message>{shop.error}</Message></Layout>;
  if (!shop.data) return <Layout><Loading /></Layout>;
  const s = shop.data;
  if (!s.found) return <Layout><Message>Cette boutique n'est pas (ou plus) sur Sugu Eden. <a href="#/">Voir les autres boutiques</a></Message></Layout>;
  const message = `Bonjour ${s.name}, je vous écris depuis Sugu Eden : ${window.location.href}`;
  return (
    <Layout>
      <section className="shop-head">
        <Photo path={s.logo} alt={s.name} />
        <div>
          <h1>{s.name}</h1>
          <p className="muted">{[s.address, s.city, countryName(s.country)].filter(Boolean).join(", ")}</p>
          {s.description && <p className="desc">{s.description}</p>}
          <ContactButtons shop={s} message={message} />
        </div>
      </section>
      <section>
        <h2>{s.products ?? 0} produit(s)</h2>
        {items.error && <Message>{items.error}</Message>}
        {!items.data && !items.error && <Loading />}
        {items.data && <Grid items={items.data.items} />}
      </section>
    </Layout>
  );
}

export function App() {
  const route = useRoute();
  switch (route.page) {
    case "home":
      return <HomePage />;
    case "results":
      return <ResultsPage query={route.query} />;
    case "product":
      return <ProductView id={route.id} />;
    case "shop":
      return <ShopView slug={route.id} />;
    case "category":
      return <CategoryPage code={route.id} />;
    default:
      return (
        <Layout>
          <Message>Page introuvable. <a href="#/">Retour à l'accueil</a></Message>
        </Layout>
      );
  }
}
