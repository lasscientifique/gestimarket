import { useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { chooseAndUploadImage } from "../lib/media";
import { mediaUrl } from "../lib/media";
import { tl } from "../lib/i18n";

/** Photos d'un produit en plus de la principale : 7 au plus, dans l'ordre (Sugu Eden les montre toutes). */
export function ProductPhotos({ value, onChange }: { value: number[]; onChange: (photos: number[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await chooseAndUploadImage({ maxSize: 1000 });
      if (id) onChange([...value, id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, d: number) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="product-photos">
      <span className="field-label">{tl("Autres photos ({0}/7)", [value.length])}</span>
      <div className="product-photos-row">
        {value.map((id, i) => (
          <div key={id} className="product-photo">
            <img src={mediaUrl(id, 160) ?? ""} alt="" />
            <div className="product-photo-actions">
              <button type="button" className="icon-btn" title={tl("Avant")} disabled={i === 0} onClick={() => move(i, -1)}><ChevronLeft size={14} /></button>
              <button type="button" className="icon-btn danger" title={tl("Retirer")} onClick={() => onChange(value.filter((x) => x !== id))}><Trash2 size={14} /></button>
              <button type="button" className="icon-btn" title={tl("Après")} disabled={i === value.length - 1} onClick={() => move(i, 1)}><ChevronRight size={14} /></button>
            </div>
          </div>
        ))}
        {value.length < 7 && (
          <button type="button" className="image-drop product-photo-add" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="spin" size={20} /> : <><ImagePlus size={20} /><span>{tl("Ajouter")}</span></>}
          </button>
        )}
      </div>
      {error && <span className="text-danger small">{error}</span>}
    </div>
  );
}
