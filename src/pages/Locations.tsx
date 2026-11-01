import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, LayoutGrid, Pencil, Trash2, PackagePlus, X, MapPin, Printer } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Empty, Field, Modal, PageHeader, StatCard, Thumb } from "../components/ui";
import { StorePlan } from "../components/StorePlan";
import { ProductPicker } from "../components/ProductPicker";
import { LocationSelect } from "../components/LocationSelect";
import { locationText, money, qty } from "../lib/format";
import { printHtml } from "../lib/receipt";
import type { Location, Product } from "../types";

export default function LocationsPage() {
  const { toast, confirm, settings, askPin } = useApp();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<Location | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [unplaced, setUnplaced] = useState<Product[]>([]);
  const [bloc, setBloc] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "generate" | "new" | Location>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listLocations();
      setLocations(list);
      setSelected((s) => (s ? list.find((l) => l.id === s.id) ?? null : null));
      setUnplaced(await api.listProducts({ without_location: true, limit: 500 }));
    } catch (e) {
      toast.error(e);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return setProducts([]);
    api.listProducts({ location_id: selected.id, limit: 1000 }).then(setProducts).catch(toast.error);
  }, [selected, toast]);

  const blocs = useMemo(() => [...new Set(locations.map((l) => l.bloc))], [locations]);
  const placedCount = locations.reduce((s, l) => s + l.product_count, 0);

  const assign = async (location: number | null, ids: number[]) => {
    try {
      await api.assignLocation(location, ids);
      await load();
      if (selected) setProducts(await api.listProducts({ location_id: selected.id, limit: 1000 }));
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async (l: Location) => {
    if (!(await confirm({ title: "Supprimer l'emplacement", message: `Supprimer ${locationText(l)} ? Les ${l.product_count} produit(s) rangés ici deviendront « non rangés ».`, danger: true, confirmLabel: "Supprimer" })))
      return;
    try {
      const pin = await askPin({ title: "Supprimer l'emplacement", level: "manager" });
      if (!pin) return;
      await api.deleteLocation(l.id, pin);
      setSelected(null);
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  /** Fiche à afficher en rayon : emplacement + liste des produits. */
  const printShelf = () => {
    if (!selected) return;
    printHtml(`
      <div class="report-print">
        <h1>${settings.shop_name} — ${locationText(selected)}</h1>
        ${selected.label ? `<p>${selected.label}</p>` : ""}
        <table><thead><tr><th>Produit</th><th>Code-barres</th><th>Prix</th></tr></thead><tbody>
        ${products.map((p) => `<tr><td>${p.name}</td><td>${p.barcode ?? ""}</td><td>${money(p.sale_price)}</td></tr>`).join("")}
        </tbody></table>
      </div>`);
  };

  return (
    <div className="page">
      <PageHeader
        help="locations"
        title="Emplacements du magasin"
        subtitle="Organisez vos rayons par bloc, étage et rangée, puis rangez-y vos produits."
        actions={
          <>
            <button className="btn" onClick={() => setModal("new")}><Plus size={16} /> Emplacement</button>
            <button className="btn btn-primary" onClick={() => setModal("generate")}><LayoutGrid size={16} /> Créer des blocs</button>
            <HelpTip k="generate_blocs" side="left" />
          </>
        }
      />

      <div className="stats">
        <StatCard label="Blocs" value={blocs.length} icon={<LayoutGrid size={18} />} tone="accent" />
        <StatCard label="Emplacements" value={locations.length} icon={<MapPin size={18} />} />
        <StatCard label="Produits rangés" value={placedCount} tone="success" />
        <StatCard label="Produits non rangés" value={unplaced.length} tone={unplaced.length ? "warning" : "default"} />
      </div>

      <div className="grid-plan">
        <div className="card">
          <div className="card-header">
            <h3>Plan du magasin <HelpTip k="plan" /></h3>
            <div className="chips">
              <button className={`chip ${bloc === null ? "active" : ""}`} onClick={() => setBloc(null)}>Tous les blocs</button>
              {blocs.map((b) => (
                <button key={b} className={`chip ${bloc === b ? "active" : ""}`} onClick={() => setBloc(b)}>Bloc {b}</button>
              ))}
            </div>
          </div>
          {locations.length === 0 ? (
            <Empty title="Aucun emplacement">
              Commencez par « Créer un bloc complet » : par exemple Bloc 1, étages 1 à 3, rangées 1 à 10.
            </Empty>
          ) : (
            <>
              <StorePlan locations={locations} selectedId={selected?.id} onSelect={setSelected} onlyBloc={bloc} />
              <p className="muted small" style={{ marginTop: 10 }}>Cliquez sur une case pour voir et ranger ses produits. Le chiffre indique le nombre de produits rangés.</p>
            </>
          )}
        </div>

        <div className="card sticky">
          {!selected ? (
            <Empty title="Aucun emplacement sélectionné">Sélectionnez une case du plan.</Empty>
          ) : (
            <>
              <div className="card-header">
                <div>
                  <h3><MapPin size={18} /> {locationText(selected)}</h3>
                  {selected.label && <span className="muted">{selected.label}</span>}
                </div>
                <div className="row-end">
                  <button className="icon-btn" title="Imprimer la fiche de rayon" onClick={printShelf}><Printer size={16} /></button>
                  <button className="icon-btn" title="Modifier" onClick={() => setModal(selected)}><Pencil size={16} /></button>
                  <button className="icon-btn danger" title="Supprimer" onClick={() => remove(selected)}><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="summary-bar">
                <span><strong>{products.length}</strong> produit(s)</span>
                <span>Valeur : <strong>{money(selected.stock_value)}</strong></span>
              </div>
              <div style={{ marginBottom: 10 }}>
                <ProductPicker onPick={(p) => assign(selected.id, [p.id])} placeholder="Ranger un produit ici (recherche ou douchette)…" />
              </div>
              <div className="pick-list tall">
                {products.map((p) => (
                  <div key={p.id} className="pick-item static">
                    <Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong className="ellipsis">{p.name}</strong>
                      <div className="muted small">{money(p.sale_price)} · stock {qty(p.stock)} {p.unit}</div>
                    </div>
                    <button className="icon-btn danger" title="Retirer de cet emplacement" onClick={() => assign(null, [p.id])}><X size={15} /></button>
                  </div>
                ))}
                {products.length === 0 && <div className="muted center pad"><PackagePlus size={20} /> Aucun produit rangé ici.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {unplaced.length > 0 && locations.length > 0 && (
        <div className="card no-pad">
          <div className="card-header pad-h">
            <h3>Produits non rangés ({unplaced.length})</h3>
          </div>
          <table className="table compact">
            <thead><tr><th>Produit</th><th>Catégorie</th><th className="num">Stock</th><th style={{ width: 360 }}>Ranger dans…</th></tr></thead>
            <tbody>
              {unplaced.slice(0, 200).map((p) => (
                <tr key={p.id}>
                  <td><div className="cell-product"><Thumb imageId={p.image_id} name={p.name} color={p.category_color} size={32} /> {p.name}</div></td>
                  <td>{p.category_name ?? <span className="muted">—</span>}</td>
                  <td className="num">{qty(p.stock)} {p.unit}</td>
                  <td><LocationSelect locations={locations} value={null} onChange={(id) => id && assign(id, [p.id])} emptyLabel="Choisir un emplacement…" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === "generate" && <GenerateModal existing={blocs} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && modal !== "generate" && (
        <LocationForm location={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}

function GenerateModal({ existing, onClose, onDone }: { existing: string[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  // Prochain bloc libre : lettres A → Z (ou nombres si le magasin utilise des numéros).
  const letters = existing.filter((b) => /^[A-Z]$/.test(b)).sort();
  const numeric = existing.length > 0 && existing.every((b) => /^\d+$/.test(b));
  const next = numeric
    ? String(Math.max(...existing.map(Number)) + 1)
    : letters.length
      ? String.fromCharCode(Math.min(90, letters[letters.length - 1].charCodeAt(0) + 1))
      : "A";
  const [f, setF] = useState({ bloc: next, bloc_to: "", label: "", etage_from: "1", etage_to: "3", rangee_from: "1", rangee_to: "10" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const blocCount = (() => {
    const a = f.bloc.trim().toUpperCase();
    const b = f.bloc_to.trim().toUpperCase();
    if (!b) return 1;
    if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) return Math.max(0, b.charCodeAt(0) - a.charCodeAt(0) + 1);
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Math.max(0, Number(b) - Number(a) + 1);
    return 0;
  })();
  const count = blocCount * Math.max(0, n(f.etage_to) - n(f.etage_from) + 1) * Math.max(0, n(f.rangee_to) - n(f.rangee_from) + 1);
  const submit = async () => {
    try {
      const created = await api.generateLocations({
        bloc: f.bloc,
        bloc_to: f.bloc_to || null,
        label: f.label || null,
        etage_from: n(f.etage_from),
        etage_to: n(f.etage_to),
        rangee_from: n(f.rangee_from),
        rangee_to: n(f.rangee_to),
      });
      toast.success(`${created} emplacement(s) créé(s).`);
      onDone();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={<>Créer des blocs (A à Z) <HelpTip k="generate_blocs" /></>}
      onClose={onClose}
      width={520}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!f.bloc.trim() || count === 0} onClick={submit}>Créer {count} emplacement(s)</button></>}
    >
      <div className="form-grid">
        <Field label="Bloc *" hint="Lettre (A, B, C…) ou numéro"><input value={f.bloc} onChange={(e) => setF({ ...f, bloc: e.target.value.toUpperCase() })} autoFocus /></Field>
        <Field label="…jusqu'au bloc (facultatif)" hint="Ex. A à F pour créer 6 blocs d'un coup"><input value={f.bloc_to} onChange={(e) => setF({ ...f, bloc_to: e.target.value.toUpperCase() })} placeholder="—" /></Field>
        <Field label="Nom du rayon (facultatif)" span={2}><input value={f.label} onChange={set("label")} placeholder="Ex. Boissons, Épicerie…" /></Field>
        <Field label="Étages : du"><input inputMode="numeric" value={f.etage_from} onChange={set("etage_from")} /></Field>
        <Field label="au"><input inputMode="numeric" value={f.etage_to} onChange={set("etage_to")} /></Field>
        <Field label="Rangées : de"><input inputMode="numeric" value={f.rangee_from} onChange={set("rangee_from")} /></Field>
        <Field label="à"><input inputMode="numeric" value={f.rangee_to} onChange={set("rangee_to")} /></Field>
      </div>
      <p className="muted small">Les emplacements déjà existants sont conservés. L'étage peut désigner l'étage du bâtiment ou le niveau de l'étagère.</p>
    </Modal>
  );
}

function LocationForm({ location, onClose, onSaved }: { location: Location | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ bloc: location?.bloc ?? "", etage: location?.etage ?? "", rangee: location?.rangee ?? "", label: location?.label ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      await api.saveLocation(location?.id ?? null, { ...f, label: f.label || null });
      toast.success("Emplacement enregistré.");
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={location ? "Modifier l'emplacement" : "Nouvel emplacement"}
      onClose={onClose}
      width={480}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!f.bloc.trim()} onClick={submit}>Enregistrer</button></>}
    >
      <div className="form-grid three">
        <Field label="Bloc *"><input value={f.bloc} onChange={set("bloc")} autoFocus /></Field>
        <Field label="Étage"><input value={f.etage} onChange={set("etage")} /></Field>
        <Field label="Rangée"><input value={f.rangee} onChange={set("rangee")} /></Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Libellé (facultatif)"><input value={f.label} onChange={set("label")} placeholder="Ex. Produits laitiers — frigo" /></Field>
      </div>
    </Modal>
  );
}
