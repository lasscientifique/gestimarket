import { useState } from "react";
import QRCode from "qrcode";
import { Plus, Printer, Smartphone, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Field, ImageField } from "./ui";
import { MerchantQr, operatorTheme, pispiQrText } from "./OrangeMoneyQr";
import { isPispi, newOperator, OPERATOR_PRESETS, operatorId, parseOperators, type MobileOperator } from "../lib/mobile";
import { isPispiAlias, pispiAliasFrom } from "../lib/pispi";
import { printHtml } from "../lib/receipt";
import { tl, ts } from "../lib/i18n";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Paramètres → Paiements : opérateurs de mobile money proposés en caisse (en plus d'Orange Money). */
export function MobileOperatorsEditor({ value, onChange }: { value: string | undefined; onChange: (json: string) => void }) {
  const { confirm, settings, toast } = useApp();
  const [preset, setPreset] = useState("");
  const list = parseOperators(value);
  const save = (next: MobileOperator[]) => onChange(next.length ? JSON.stringify(next) : "");
  const update = (i: number, patch: Partial<MobileOperator>) => save(list.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const add = () => {
    const p = OPERATOR_PRESETS.find((x) => x.id === preset);
    const name = p ? p.name : tl("Nouvel opérateur");
    save([...list, newOperator(operatorId(p ? p.id : name, list.map((o) => o.id)), name, p?.color, p?.kind)]);
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

  // PI-SPI : QR fixe (sans montant) à imprimer et poser sur le comptoir.
  const printPispi = async (o: MobileOperator) => {
    const text = pispiQrText(o, settings);
    if (!text) return;
    try {
      const img = await QRCode.toDataURL(text, { margin: 2, width: 640, errorCorrectionLevel: "M" });
      printHtml(
        `<div style="text-align:center;font-family:sans-serif;padding-top:20mm">
          <div style="font-size:28pt;font-weight:700">${esc(settings.shop_name ?? "")}</div>
          <div style="font-size:16pt;margin:4mm 0 8mm">${esc(ts("Payez par PI-SPI : toutes les banques et tous les portefeuilles de l'UEMOA"))}</div>
          <img src="${img}" alt="" style="width:120mm;height:120mm" />
          <div style="font-size:16pt;margin-top:6mm">${esc(o.merchant_name || o.name)}</div>
          <div style="font-size:12pt;margin-top:4mm">${esc(ts("Scannez avec l'application de votre banque ou de votre portefeuille, saisissez le montant, puis montrez la confirmation à la caisse."))}</div>
        </div>`,
      );
    } catch (e) {
      toast.error(e);
    }
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
          {isPispi(o) ? (
            <div className="settings-split">
              <div className="om-preview">
                <MerchantQr size={120} imageId={null} payload={pispiQrText(o, settings)} merchant="" merchantName={o.merchant_name || o.name} hint={tl("Saisissez l'alias PI-SPI")} />
              </div>
              <div className="form-grid">
                <Field
                  label={tl("Alias PI-SPI (36 caractères) *")}
                  span={2}
                  hint={
                    o.merchant && !isPispiAlias(o.merchant)
                      ? tl("Alias invalide : copiez-le depuis l'application de votre banque ou de votre portefeuille (PI-SPI → Détails du compte), ou collez le texte de votre QR PI-SPI.")
                      : tl("Dans l'application de votre banque ou de votre portefeuille : PI-SPI → Détails du compte → Alias. Vous pouvez aussi coller le texte de votre QR PI-SPI.")
                  }
                >
                  <input
                    className="mono"
                    value={o.merchant}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    onChange={(e) => update(i, { merchant: pispiAliasFrom(e.target.value) ?? e.target.value.trim() })}
                  />
                </Field>
                <Field label={tl("Nom du compte")}><input value={o.merchant_name} onChange={(e) => update(i, { merchant_name: e.target.value })} /></Field>
                <div className="row-end">
                  <button type="button" className="btn" disabled={!isPispiAlias(o.merchant)} onClick={() => void printPispi(o)}>
                    <Printer size={16} />  {tl("Imprimer le QR du comptoir")}</button>
                </div>
                <p className="muted small span-2">
                  {tl("En caisse, GestiMarket affiche un QR avec le montant exact et la référence de la vente : le client paie depuis n'importe quelle banque ou portefeuille de l'UEMOA. Vérifiez l'arrivée du paiement sur le téléphone de la boutique, puis validez la vente.")}</p>
                {(settings.currency_code ?? "XOF").toUpperCase() !== "XOF" && (
                  <div className="alert alert-warning span-2">{tl("PI-SPI fonctionne en francs CFA (XOF) : le QR ne contiendra pas le montant.")}</div>
                )}
                <label className="check span-2">
                  <input type="checkbox" checked={o.require_ref} onChange={(e) => update(i, { require_ref: e.target.checked })} />  {tl("Exiger l'ID de transaction")}
                </label>
              </div>
            </div>
          ) : (
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
          )}
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
