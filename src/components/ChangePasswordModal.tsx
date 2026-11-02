import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Field, Modal } from "./ui";
import { tl } from "../lib/i18n";

/** Mon compte : changer son mot de passe ou son code PIN. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { toast, setUser } = useApp();
  const [tab, setTab] = useState<"pin" | "password">("pin");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next !== confirmValue) return toast.error(tab === "pin" ? tl("Les deux codes PIN ne correspondent pas.") : tl("Les deux mots de passe ne correspondent pas."));
    setBusy(true);
    try {
      if (tab === "pin") {
        setUser(await api.setMyPin(current, next));
        toast.success(tl("Code PIN modifié."));
      } else {
        await api.changePassword(current, next);
        toast.success(tl("Mot de passe modifié."));
      }
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
      title={tl("Mon compte")}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !current || !next} onClick={submit}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={tab === "pin" ? "active" : ""} onClick={() => { setTab("pin"); setNext(""); setConfirmValue(""); }}>{tl("Code PIN")}</button>
        <button className={tab === "password" ? "active" : ""} onClick={() => { setTab("password"); setNext(""); setConfirmValue(""); }}>{tl("Mot de passe")}</button>
      </div>
      <div className="form-grid one">
        <Field label={tl("Mot de passe actuel")}>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        {tab === "pin" ? (
          <>
            <Field label={tl("Nouveau code PIN")} hint={tl("4 à 6 chiffres, évitez 1234 ou 0000")}>
              <input className="pin-input" type="password" inputMode="numeric" value={next} onChange={(e) => setNext(digits(e.target.value))} />
            </Field>
            <Field label={tl("Confirmer le code PIN")}>
              <input className="pin-input" type="password" inputMode="numeric" value={confirmValue} onChange={(e) => setConfirmValue(digits(e.target.value))} onKeyDown={(e) => e.key === "Enter" && submit()} />
            </Field>
          </>
        ) : (
          <>
            <Field label={tl("Nouveau mot de passe")} hint={tl("6 caractères minimum")}>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label={tl("Confirmer le nouveau mot de passe")}>
              <input type="password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
