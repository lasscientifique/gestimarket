import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, Download, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { exportCsv } from "../lib/files";
import { normalizeHeader, parseCsv, parseDate } from "../lib/csv";
import { parseNumber, toCsv, toMinor } from "../lib/format";
import type { ImportResult, ImportRow } from "../types";
import { Modal } from "./ui";

type Key = keyof ImportRow;

/** En-têtes reconnus pour chaque champ (comparaison sans accents ni majuscules). */
const SYNONYMS: Record<Key, string[]> = {
  barcode: ["code barres", "code barre", "codebarre", "code", "ean", "barcode", "gencod"],
  name: ["designation", "nom", "produit", "libelle", "article", "name", "description"],
  category: ["categorie", "famille", "rayon", "category"],
  subcategory: ["sous categorie", "souscategorie", "sous famille", "subcategory"],
  unit: ["unite", "unit"],
  purchase_price: ["prix d achat", "prix achat", "pa", "cout", "cout d achat", "prix de revient"],
  sale_price: ["prix de vente", "prix vente", "pv", "prix", "prix ttc", "prix de vente ttc"],
  tax_rate: ["tva", "taxe", "tva %", "taux tva"],
  stock: ["stock", "quantite", "qte", "quantite en stock"],
  min_stock: ["seuil", "seuil d alerte", "stock min", "stock minimum", "alerte"],
  bloc: ["bloc"],
  etage: ["etage", "niveau"],
  rangee: ["rangee", "rang", "allee", "rayonnage"],
  expiry_date: ["peremption", "date de peremption", "dlc", "dluo", "expiration", "date d expiration"],
  brand: ["marque", "brand", "fabricant"],
  sku: ["reference", "ref", "reference interne", "sku", "code article"],
};

const LABELS: Record<Key, string> = {
  barcode: "Code-barres",
  name: "Désignation",
  category: "Catégorie",
  subcategory: "Sous-catégorie",
  unit: "Unité",
  purchase_price: "Prix d'achat",
  sale_price: "Prix de vente",
  tax_rate: "TVA %",
  stock: "Stock",
  min_stock: "Seuil d'alerte",
  bloc: "Bloc",
  etage: "Étage",
  rangee: "Rangée",
  expiry_date: "Péremption",
  brand: "Marque",
  sku: "Référence",
};

export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast, askPin } = useApp();
  const [rows, setRows] = useState<string[][]>([]);
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const mapping = useMemo(() => {
    const headers = (rows[0] ?? []).map(normalizeHeader);
    const map: Partial<Record<Key, number>> = {};
    (Object.keys(SYNONYMS) as Key[]).forEach((k) => {
      const idx = headers.findIndex((h) => SYNONYMS[k].includes(h));
      if (idx >= 0) map[k] = idx;
    });
    return map;
  }, [rows]);

  const data: ImportRow[] = useMemo(() => {
    const get = (r: string[], k: Key) => (mapping[k] !== undefined ? (r[mapping[k]!] ?? "").trim() : "");
    const num = (s: string) => {
      const n = parseNumber(s);
      return s === "" || !Number.isFinite(n) ? null : n;
    };
    return rows.slice(1).map((r) => {
      const pp = num(get(r, "purchase_price"));
      const sp = num(get(r, "sale_price"));
      const exp = get(r, "expiry_date");
      return {
        barcode: get(r, "barcode") || null,
        name: get(r, "name"),
        category: get(r, "category") || null,
        subcategory: get(r, "subcategory") || null,
        brand: get(r, "brand") || null,
        sku: get(r, "sku") || null,
        unit: get(r, "unit") || null,
        purchase_price: pp === null ? null : toMinor(pp),
        sale_price: sp === null ? null : toMinor(sp),
        tax_rate: num(get(r, "tax_rate")),
        stock: num(get(r, "stock")),
        min_stock: num(get(r, "min_stock")),
        bloc: get(r, "bloc") || null,
        etage: get(r, "etage") || null,
        rangee: get(r, "rangee") || null,
        expiry_date: exp ? parseDate(exp) : null,
      };
    });
  }, [rows, mapping]);

  const choose = async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "Fichier CSV", extensions: ["csv", "txt"] }] });
      if (!path || Array.isArray(path)) return;
      const text = await api.readTextFile(path);
      setRows(parseCsv(text));
      setFile(path.split(/[\\/]/).pop() ?? path);
      setResult(null);
    } catch (e) {
      toast.error(e);
    }
  };

  const template = async () => {
    const csv = toCsv(
      Object.values(LABELS),
      [["6001234567890", "Riz parfumé 5kg", "Épicerie", "Riz et céréales", "pce", "3000", "3750", "0", "40", "5", "A", "2", "4", "31/12/2027"]],
    );
    try {
      if (await exportCsv("modele-import-produits.csv", csv)) toast.success("Modèle enregistré. Ouvrez-le avec Excel.");
    } catch (e) {
      toast.error(e);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const pin = await askPin({ title: "Confirmer l'import", level: "manager", message: <>Import de <strong>{data.length}</strong> ligne(s) : confirmez avec votre code PIN.</> });
      if (!pin) return;
      const r = await api.importProducts(data, pin);
      setResult(r);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const missingName = mapping.name === undefined;

  return (
    <Modal
      title="Importer des produits (Excel / CSV)"
      onClose={onClose}
      width={900}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>Terminer</button>
        ) : (
          <>
            <button className="btn" style={{ marginRight: "auto" }} onClick={template}><Download size={16} /> Télécharger le modèle</button>
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" disabled={busy || !data.length || missingName} onClick={submit}>
              Importer {data.length} ligne(s)
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="import-result">
          <CheckCircle2 size={40} className="text-success" />
          <h3>Import terminé</h3>
          <p>{result.created} produit(s) créé(s) · {result.updated} mis à jour</p>
          {result.errors.length > 0 && (
            <div className="alert alert-warning" style={{ textAlign: "left" }}>
              <strong>{result.errors.length} ligne(s) ignorée(s) :</strong>
              <ul>{result.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <ol className="steps">
            <li>Dans Excel : <b>Fichier → Enregistrer sous → CSV (séparateur : point-virgule)</b>. Le modèle donne les colonnes attendues.</li>
            <li>Un produit existant (même code-barres) est <b>mis à jour</b> ; sinon il est créé. La colonne « Stock » fixe le stock (inventaire tracé).</li>
            <li>Les catégories inconnues sont créées automatiquement ; un meuble inconnu (colonne bloc : code du meuble, ex. A ou FR1) est posé sur le plan avec ses étages et ses cases.</li>
          </ol>
          <button className="file-drop" onClick={choose}>
            <FileUp size={26} />
            <strong>{file || "Choisir un fichier CSV…"}</strong>
            {file && <span className="muted">{data.length} ligne(s) détectée(s)</span>}
          </button>
          {rows.length > 0 && (
            <>
              <div className="mapping">
                {(Object.keys(LABELS) as Key[]).map((k) => (
                  <span key={k} className={`badge ${mapping[k] !== undefined ? "badge-success" : ""}`}>
                    {LABELS[k]} {mapping[k] !== undefined ? "✓" : "—"}
                  </span>
                ))}
              </div>
              {missingName && <div className="alert alert-danger">Colonne « Désignation » introuvable dans le fichier.</div>}
              <div className="table-scroll">
                <table className="table compact">
                  <thead><tr><th>Code-barres</th><th>Désignation</th><th>Catégorie</th><th className="num">Achat</th><th className="num">Vente</th><th className="num">Stock</th><th>Emplacement</th><th>Péremption</th></tr></thead>
                  <tbody>
                    {data.slice(0, 12).map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.barcode}</td>
                        <td>{r.name || <span className="text-danger">manquant</span>}</td>
                        <td>{r.category}{r.subcategory ? ` › ${r.subcategory}` : ""}</td>
                        <td className="num">{rows[i + 1]?.[mapping.purchase_price ?? -1]}</td>
                        <td className="num">{rows[i + 1]?.[mapping.sale_price ?? -1]}</td>
                        <td className="num">{r.stock ?? ""}</td>
                        <td>{r.bloc ? `B${r.bloc} É${r.etage ?? ""} R${r.rangee ?? ""}` : ""}</td>
                        <td className={r.expiry_date === "invalide" ? "text-danger" : ""}>{r.expiry_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length > 12 && <p className="muted small">… et {data.length - 12} autre(s) ligne(s).</p>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
