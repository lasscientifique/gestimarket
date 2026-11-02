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
import { tl } from "../lib/i18n";

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
  barcode: tl("Code-barres"),
  name: tl("Désignation"),
  category: tl("Catégorie"),
  subcategory: tl("Sous-catégorie"),
  unit: tl("Unité"),
  purchase_price: tl("Prix d'achat"),
  sale_price: tl("Prix de vente"),
  tax_rate: tl("TVA %"),
  stock: tl("Stock"),
  min_stock: tl("Seuil d'alerte"),
  bloc: tl("Bloc"),
  etage: tl("Étage"),
  rangee: tl("Rangée"),
  expiry_date: tl("Péremption"),
  brand: tl("Marque"),
  sku: tl("Référence"),
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
      if (await exportCsv("modele-import-produits.csv", csv)) toast.success(tl("Modèle enregistré. Ouvrez-le avec Excel."));
    } catch (e) {
      toast.error(e);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const pin = await askPin({ title: tl("Confirmer l'import"), level: "manager", message: <>{tl("Import de")} <strong>{data.length}</strong>  {tl("ligne(s) : confirmez avec votre code PIN.")}</> });
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
      title={tl("Importer des produits (Excel / CSV)")}
      onClose={onClose}
      width={900}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>{tl("Terminer")}</button>
        ) : (
          <>
            <button className="btn" style={{ marginRight: "auto" }} onClick={template}><Download size={16} />  {tl("Télécharger le modèle")}</button>
            <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
            <button className="btn btn-primary" disabled={busy || !data.length || missingName} onClick={submit}>
              {tl("Importer")} {data.length}  {tl("ligne(s)")}</button>
          </>
        )
      }
    >
      {result ? (
        <div className="import-result">
          <CheckCircle2 size={40} className="text-success" />
          <h3>{tl("Import terminé")}</h3>
          <p>{result.created}  {tl("produit(s) créé(s) ·")} {result.updated}  {tl("mis à jour")}</p>
          {result.errors.length > 0 && (
            <div className="alert alert-warning" style={{ textAlign: "left" }}>
              <strong>{result.errors.length}  {tl("ligne(s) ignorée(s) :")}</strong>
              <ul>{result.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <ol className="steps">
            <li>{tl("Dans Excel :")} <b>{tl("Fichier → Enregistrer sous → CSV (séparateur : point-virgule)")}</b>{tl(". Le modèle donne les colonnes attendues.")}</li>
            <li>{tl("Un produit existant (même code-barres) est")} <b>{tl("mis à jour")}</b>  {tl("; sinon il est créé. La colonne « Stock » fixe le stock (inventaire tracé).")}</li>
            <li>{tl("Les catégories inconnues sont créées automatiquement ; un meuble inconnu (colonne bloc : code du meuble, ex. A ou FR1) est posé sur le plan avec ses étages et ses cases.")}</li>
          </ol>
          <button className="file-drop" onClick={choose}>
            <FileUp size={26} />
            <strong>{file || tl("Choisir un fichier CSV…")}</strong>
            {file && <span className="muted">{data.length}  {tl("ligne(s) détectée(s)")}</span>}
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
              {missingName && <div className="alert alert-danger">{tl("Colonne « Désignation » introuvable dans le fichier.")}</div>}
              <div className="table-scroll">
                <table className="table compact">
                  <thead><tr><th>{tl("Code-barres")}</th><th>{tl("Désignation")}</th><th>{tl("Catégorie")}</th><th className="num">{tl("Achat")}</th><th className="num">{tl("Vente")}</th><th className="num">{tl("Stock")}</th><th>{tl("Emplacement")}</th><th>{tl("Péremption")}</th></tr></thead>
                  <tbody>
                    {data.slice(0, 12).map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.barcode}</td>
                        <td>{r.name || <span className="text-danger">manquant</span>}</td>
                        <td>{r.category}{r.subcategory ? ` › ${r.subcategory}` : ""}</td>
                        <td className="num">{rows[i + 1]?.[mapping.purchase_price ?? -1]}</td>
                        <td className="num">{rows[i + 1]?.[mapping.sale_price ?? -1]}</td>
                        <td className="num">{r.stock ?? ""}</td>
                        <td>{r.bloc ? tl("B{0} É{1} R{2}", [r.bloc, r.etage ?? "", r.rangee ?? ""]) : ""}</td>
                        <td className={r.expiry_date === "invalide" ? "text-danger" : ""}>{r.expiry_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length > 12 && <p className="muted small">{tl("… et")} {data.length - 12}  {tl("autre(s) ligne(s).")}</p>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
