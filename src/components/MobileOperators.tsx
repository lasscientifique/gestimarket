import { useState } from "react";
import { Plus, Smartphone, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Field, ImageField } from "./ui";
import { MerchantQr, operatorTheme } from "./OrangeMoneyQr";
import { newOperator, OPERATOR_PRESETS, operatorId, parseOperators, type MobileOperator } from "../lib/mobile";
import { tl } from "../lib/i18n";

/** Paramètres → Paiements : opérateurs de mobile money proposés en caisse (en plus d'Orange Money). */
export function MobileOperatorsEditor({ value, onChange }: { value: string | undefined; onChange: (json: string) => void }) {
  const { confirm } = useApp();
  const [preset, setPreset] = useState("");
  const list = parseOperators(value);
  const save = (next: MobileOperator[]) => onChange(next.length ? JSON.stringify(next) : "");
  const update = (i: number, patch: Partial<MobileOperator>) => save(list.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const add = () => {
    const p = OPERATOR_PRESETS.find((x) => x.id === preset);
    const name = p ? p.name : tl("Nouvel opérateur");
    save([...list, newOperator(operatorId(p ? p.id : name, list.map((o) => o.id)), name, p?.color)]);
    setPreset("");
  };

  const remove = async (i: number) => {
    const ok = await confirm({
      title: tl("Supprimer l'opérateur"),
      message: tl("Supprimer {0} ? Pour garder son nom dans l'historique des ventes, décochez plutôt « Proposé en caisse ».", [list[i].name]),
      confirmLabel: tl("Supprimer"),
      danger: true,
    });
    if (ok) save(list.filter((_, j) => j !== i));
  };

  return (
    <div className="card">
      <h3 className="card-title"><Smartphone size={18} />  {tl("Autres opérateurs de paiement mobile")}</h3>
      <p className="muted small">
        {tl("Wave, Moov Money, MTN MoMo, M-Pesa… Chaque opérateur a son bouton en caisse, son numéro marchand et son QR code.")}
      </p>
      {list.map((o, i) => (
        <div key={o.id} className="mm-op" style={operatorTheme(o.color)}>
          <div className="mm-op-head">
            <input type="color" value={o.color} onChange={(e) => update(i, { color: e.target.value })} aria-label={tl("Couleur")} />
            <input className="mm-op-name" value={o.name} onChange={(e) => update(i, { name: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={o.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />  {tl("Proposé en caisse")}
            </label>
            <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={tl("Supprimer")}><Trash2 size={16} /></button>
          </div>
          <div className="settings-split">
            <div className="om-preview">
              <MerchantQr size={120} imageId={o.qr_image_id} payload={o.qr_payload} merchant={o.merchant} merchantName={o.merchant_name} hint={tl("Ajoutez la photo du QR code")} />
            </div>
            <div className="form-grid">
              <Field label={tl("Numéro marchand")}><input value={o.merchant} onChange={(e) => update(i, { merchant: e.target.value })} /></Field>
              <Field label={tl("Nom du compte marchand")}><input value={o.merchant_name} onChange={(e) => update(i, { merchant_name: e.target.value })} /></Field>
              <div className="span-2">
                <ImageField label={tl("Photo du QR code marchand")} value={o.qr_image_id} onChange={(id) => update(i, { qr_image_id: id })} size={70} keepPng maxSize={800} />
              </div>
              <Field label={tl("…ou contenu texte du QR code (si vous le connaissez)")} span={2}>
                <input className="mono" value={o.qr_payload} onChange={(e) => update(i, { qr_payload: e.target.value })} />
              </Field>
              <label className="check span-2">
                <input type="checkbox" checked={o.require_ref} onChange={(e) => update(i, { require_ref: e.target.checked })} />  {tl("Exiger l'ID de transaction")}
              </label>
            </div>
          </div>
        </div>
      ))}
      <div className="toolbar">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">{tl("Choisir un opérateur…")}</option>
          {OPERATOR_PRESETS.filter((p) => !list.some((o) => o.id === p.id)).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="_other">{tl("Autre opérateur")}</option>
        </select>
        <button type="button" className="btn" disabled={!preset} onClick={add}><Plus size={16} />  {tl("Ajouter")}</button>
      </div>
    </div>
  );
}
