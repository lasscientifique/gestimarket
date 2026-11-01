import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Field, Modal } from "./ui";

/** Mon compte : changer son mot de passe ou son code PIN. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { toast, setUser } = useApp();
  const [tab, setTab] = useState<"pin" | "password">("pin");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next !== confirmValue) return toast.error(tab === "pin" ? "Les deux codes PIN ne correspondent pas." : "Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    try {
      if (tab === "pin") {
        setUser(await api.setMyPin(current, next));
        toast.success("Code PIN modifié.");
      } else {
        await api.changePassword(current, next);
        toast.success("Mot de passe modifié.");
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
      title="Mon compte"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !current || !next} onClick={submit}>Enregistrer</button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={tab === "pin" ? "active" : ""} onClick={() => { setTab("pin"); setNext(""); setConfirmValue(""); }}>Code PIN</button>
        <button className={tab === "password" ? "active" : ""} onClick={() => { setTab("password"); setNext(""); setConfirmValue(""); }}>Mot de passe</button>
      </div>
      <div className="form-grid one">
        <Field label="Mot de passe actuel">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        {tab === "pin" ? (
          <>
            <Field label="Nouveau code PIN" hint="4 à 6 chiffres, évitez 1234 ou 0000">
              <input className="pin-input" type="password" inputMode="numeric" value={next} onChange={(e) => setNext(digits(e.target.value))} />
            </Field>
            <Field label="Confirmer le code PIN">
              <input className="pin-input" type="password" inputMode="numeric" value={confirmValue} onChange={(e) => setConfirmValue(digits(e.target.value))} onKeyDown={(e) => e.key === "Enter" && submit()} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Nouveau mot de passe" hint="6 caractères minimum">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirmer le nouveau mot de passe">
              <input type="password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
