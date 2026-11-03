import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Field, Modal } from "./ui";
import { tl } from "../lib/i18n";

/** Mon compte : changer son code PIN (l'actuel est demandé). Pas de mot de passe : identifiant et PIN seulement. */
export function ChangePinModal({ onClose }: { onClose: () => void }) {
  const { toast, user } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = user?.role === "admin";

  const submit = async () => {
    if (next !== confirmValue) return toast.error(tl("Les deux codes PIN ne correspondent pas."));
    setBusy(true);
    try {
      await api.changeMyPin(current, next);
      toast.success(tl("Code PIN modifié."));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  return (
    <Modal
      title={tl("Mon code PIN")}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || current.length < 4 || next.length < (admin ? 6 : 4)} onClick={submit}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {user?.full_name} · {tl("identifiant")} <strong className="mono">{user?.username}</strong>
      </p>
      <div className="form-grid one">
        <Field label={tl("Code PIN actuel")}>
          <input className="pin-input" type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(digits(e.target.value))} autoFocus />
        </Field>
        <Field label={tl("Nouveau code PIN")} hint={admin ? tl("6 chiffres, évitez 123456 ou 000000") : tl("4 à 6 chiffres, évitez 1234 ou 0000")}>
          <input className="pin-input" type="password" inputMode="numeric" value={next} onChange={(e) => setNext(digits(e.target.value))} />
        </Field>
        <Field label={tl("Confirmer le code PIN")}>
          <input className="pin-input" type="password" inputMode="numeric" value={confirmValue} onChange={(e) => setConfirmValue(digits(e.target.value))} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
      </div>
      <p className="muted small">{tl("Code oublié ? L'administrateur vous en donne un nouveau (menu Personnel).")}</p>
    </Modal>
  );
}
