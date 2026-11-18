import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Copy, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { errText, sb } from "../lib/sb";
import { dateOnly } from "../lib/fmt";
import { Badge, ErrorBox, Field, Modal, Spinner, useLoad, useToast } from "../ui";
import { MfaHelp } from "../MfaHelp";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

const digits6 = (s: string) => s.replace(/\D/g, "").slice(0, 6);

/**
 * Vérification à 2 étapes de la personne connectée : téléphone principal et téléphone de secours (un deuxième
 * Google Authenticator, sur un autre téléphone). Si le téléphone principal est perdu, le téléphone de secours
 * ouvre la console ; sinon, un autre membre de la Direction réinitialise la vérification (Équipe).
 */
export function MyFactors() {
  const toast = useToast();
  const list = useLoad(async () => {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    return data.totp.filter((f) => f.status === "verified") as Factor[];
  }, []);
  const [adding, setAdding] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Factor | null>(null);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      // Essai précédent pas terminé : retiré d'abord.
      const { data } = await sb.auth.mfa.listFactors();
      for (const f of data?.all.filter((x) => x.status !== "verified") ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
      const r = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Téléphone de secours ${new Date().toISOString().slice(0, 16)}` });
      if (r.error) throw r.error;
      setAdding({ id: r.data.id, secret: r.data.totp.secret, qr: await QRCode.toDataURL(r.data.totp.uri, { margin: 1, width: 220 }) });
      setCode("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: adding.id, code: digits6(code) });
      if (error) throw error;
      toast.ok("Téléphone de secours ajouté.");
      setAdding(null);
      list.reload();
    } catch (err) {
      setError(errText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const cancelAdd = async () => {
    if (adding) await sb.auth.mfa.unenroll({ factorId: adding.id }).catch(() => undefined);
    setAdding(null);
    setError("");
  };

  const remove = async () => {
    if (!removing) return;
    try {
      const { error } = await sb.auth.mfa.unenroll({ factorId: removing.id });
      if (error) throw error;
      toast.ok("Téléphone retiré de la vérification à 2 étapes.");
      setRemoving(null);
      list.reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  const factors = list.data ?? [];
  return (
    <section className="card stack">
      <h3 className="card-title">
        <ShieldCheck size={18} /> Ma vérification à 2 étapes
      </h3>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data ? (
        <Spinner />
      ) : (
        <>
          {factors.map((f, i) => (
            <div key={f.id} className="row-between">
              <span>
                <Smartphone size={15} className="inline" /> {f.friendly_name?.startsWith("Téléphone de secours") ? "Téléphone de secours" : i === 0 ? "Téléphone principal" : `Téléphone ${i + 1}`}{" "}
                <span className="muted small">· depuis le {dateOnly(f.created_at)}</span>
              </span>
              {factors.length > 1 && (
                <button className="btn btn-sm btn-danger-outline" onClick={() => setRemoving(f)}>
                  <Trash2 size={14} /> Retirer
                </button>
              )}
            </div>
          ))}
          {factors.length < 2 && (
            <div className="alert alert-warning small">
              Un seul téléphone : s'il est perdu, vous ne pourrez plus entrer dans la console sans l'aide d'un autre membre de la Direction.
              Ajoutez un téléphone de secours (celui d'un proche de confiance, ou un deuxième téléphone gardé à l'abri).
            </div>
          )}
          {!adding ? (
            <div className="row">
              <button className="btn" onClick={start} disabled={busy || factors.length >= 5}>
                <Smartphone size={15} /> {busy ? "Un instant…" : "Ajouter un téléphone de secours"}
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={verify}>
              <p className="muted small">
                Sur le <strong>téléphone de secours</strong> : ouvrez Google Authenticator, touchez <strong>+</strong>, puis scannez ce code.
                Tapez ensuite le code à 6 chiffres affiché sur ce téléphone.
              </p>
              <img className="mfa-qr" src={adding.qr} alt="Code QR du téléphone de secours" />
              <p className="muted small">
                Clé à taper sans caméra : <span className="mono break">{adding.secret}</span>{" "}
                <button type="button" className="icon-btn" aria-label="Copier la clé" onClick={() => navigator.clipboard?.writeText(adding.secret)}>
                  <Copy size={14} />
                </button>
              </p>
              <Field label="Code à 6 chiffres du téléphone de secours *">
                <input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits6(e.target.value))} autoFocus />
              </Field>
              <div className="row-end">
                <button type="button" className="btn" onClick={cancelAdd}>
                  Annuler
                </button>
                <button className="btn btn-primary" disabled={busy || code.length !== 6}>
                  {busy ? "Vérification…" : "Ajouter ce téléphone"}
                </button>
              </div>
            </form>
          )}
          {error && <ErrorBox error={error} />}
          {factors.length > 0 && <Badge tone="success">{factors.length} téléphone(s) peuvent ouvrir votre console</Badge>}
          <MfaHelp />
        </>
      )}
      {removing && (
        <Modal title="Retirer ce téléphone ?" onClose={() => setRemoving(null)}>
          <div className="stack">
            <p>Ce téléphone ne pourra plus donner de code pour votre console. Une alerte « vérification retirée » sera créée (sécurité).</p>
            <div className="row-end">
              <button className="btn" onClick={() => setRemoving(null)}>
                Annuler
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Retirer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
