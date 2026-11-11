import { useEffect, useState } from "react";
import { FileCheck2, FileText, LogOut, Scale, ShieldCheck } from "lucide-react";
import frConditions from "../../docs/conditions/fr/1-conditions.md?raw";
import frLicence from "../../docs/conditions/fr/2-licence.md?raw";
import frDonnees from "../../docs/conditions/fr/3-donnees.md?raw";
import enTerms from "../../docs/conditions/en/1-terms.md?raw";
import enLicence from "../../docs/conditions/en/2-licence.md?raw";
import enPrivacy from "../../docs/conditions/en/3-privacy.md?raw";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { dateTime } from "../lib/format";
import { getLang, tl } from "../lib/i18n";
import type { TermsStatus } from "../types";
import { Modal } from "./ui";

/*
 * Conditions générales d'utilisation, contrat de licence et politique de données personnelles (textes dans
 * docs/conditions, en français et en anglais ; le français fait foi). Acceptés par l'administrateur à la
 * première configuration, puis de nouveau quand leur version change ; lisibles à tout moment dans les
 * Paramètres (onglet « Aide, conditions et licence »).
 */

export type TermsDoc = "conditions" | "licence" | "donnees";
export const TERMS_DOCS: TermsDoc[] = ["conditions", "licence", "donnees"];

const TEXTS: Record<"fr" | "en", Record<TermsDoc, string>> = {
  fr: { conditions: frConditions, licence: frLicence, donnees: frDonnees },
  en: { conditions: enTerms, licence: enLicence, donnees: enPrivacy },
};

export const termsTitle = (doc: TermsDoc) =>
  ({ conditions: tl("Conditions générales d'utilisation"), licence: tl("Contrat de licence"), donnees: tl("Données personnelles") })[doc];

const termsSummary = (doc: TermsDoc) =>
  ({
    conditions: tl("Usage licite de GestiMarket, compte et mot de passe du propriétaire, personnel et codes PIN, obligations fiscales du commerçant, sauvegardes à garder hors de l'appareil, services en ligne, assistance."),
    licence: tl("GestiMarket appartient à Eden Dev : droit d'utilisation pour une boutique selon la formule, essai de 14 jours une fois par boutique, pas de renouvellement automatique, lecture seule à la fin de l'abonnement (données jamais effacées), copie et contournement interdits."),
    donnees: tl("Les ventes, clients et dettes restent sur vos appareils. Eden Dev reçoit seulement le compte, la boutique, l'appareil, les paiements et les rapports de panne (sans données commerciales), hébergés chez Supabase en Irlande."),
  })[doc];

const ICONS: Record<TermsDoc, React.ReactNode> = {
  conditions: <FileText size={18} />,
  licence: <Scale size={18} />,
  donnees: <ShieldCheck size={18} />,
};

/** Texte complet, mis en forme (titres, listes, tableaux). */
export function TermsText({ doc }: { doc: TermsDoc }) {
  const text = TEXTS[getLang() === "en" ? "en" : "fr"][doc];
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("marked")
      .then(({ marked }) => alive && setHtml(marked.parse(text, { async: false }) as string))
      .catch(() => alive && setHtml(null));
    return () => {
      alive = false;
    };
  }, [text]);
  // Textes de GestiMarket lui-même (fichiers du programme), jamais une saisie : affichage direct.
  return html ? <div className="terms-text" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="terms-text plain">{text}</pre>;
}

export function TermsReader({ doc, onClose }: { doc: TermsDoc; onClose: () => void }) {
  return (
    <Modal title={<>{ICONS[doc]}  {termsTitle(doc)}</>} onClose={onClose} width={760}>
      <TermsText doc={doc} />
    </Modal>
  );
}

/** Les trois textes résumés, lisibles en entier, puis la case « J'accepte ». */
export function TermsAccept({ onAccept, busy, label }: { onAccept: (version: string) => void; busy?: boolean; label?: string }) {
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [reading, setReading] = useState<TermsDoc | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.termsStatus().then(setStatus).catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <div className="terms-accept">
      <div className="terms-docs">
        {TERMS_DOCS.map((d) => (
          <div key={d} className="terms-doc">
            <div className="terms-doc-head">{ICONS[d]}  <strong>{termsTitle(d)}</strong></div>
            <p className="muted small">{termsSummary(d)}</p>
            <button type="button" className="link-btn" onClick={() => setReading(d)}>{tl("Lire en entier")}</button>
          </div>
        ))}
      </div>
      <label className="check terms-check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{tl("J'ai lu et j'accepte les conditions générales d'utilisation, le contrat de licence et la politique de données personnelles, au nom de la boutique.")}</span>
      </label>
      {status && <p className="muted small">{tl("Version {0} · Éditeur : Eden Dev, Bamako (Mali).", [status.current])}</p>}
      {error && <div className="alert alert-danger">{error}</div>}
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!checked || !status || busy} onClick={() => status && onAccept(status.current)}>
        <FileCheck2 size={18} />  {label ?? tl("Accepter et continuer")}
      </button>
      {reading && <TermsReader doc={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

/**
 * Administrateur dont la boutique n'a pas accepté la version actuelle (première mise à jour avec les
 * conditions, ou textes modifiés) : il les accepte avant de continuer, ou se déconnecte.
 */
export function TermsGate({ status, onDone }: { status: TermsStatus; onDone: () => void }) {
  const { toast, logout } = useApp();
  const [busy, setBusy] = useState(false);
  const accept = async (version: string) => {
    setBusy(true);
    try {
      await api.acceptTerms(version);
      toast.success(tl("Conditions acceptées."));
      onDone();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop terms-gate">
      <div className="modal" style={{ width: 720 }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2><Scale size={18} />  {status.accepted ? tl("Conditions d'utilisation mises à jour") : tl("Conditions d'utilisation de GestiMarket")}</h2>
        </div>
        <div className="modal-body">
          <p className="muted">
            {status.accepted
              ? tl("Les conditions ont changé depuis la version acceptée ({0}). Lisez-les, puis acceptez-les pour continuer.", [status.accepted])
              : tl("En tant qu'administrateur, acceptez les conditions d'utilisation de GestiMarket au nom de la boutique pour continuer. Le personnel n'a rien à faire.")}
          </p>
          <TermsAccept onAccept={accept} busy={busy} />
          <div className="row-start" style={{ marginTop: 10 }}>
            <button type="button" className="link-btn small" onClick={() => void logout()}><LogOut size={14} />  {tl("Se déconnecter")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Paramètres : textes en vigueur et acceptation de la boutique. */
export function TermsCard() {
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [reading, setReading] = useState<TermsDoc | null>(null);
  useEffect(() => {
    api.termsStatus().then(setStatus).catch(() => undefined);
  }, []);
  return (
    <div className="card">
      <h3 className="card-title"><Scale size={18} />  {tl("Conditions d'utilisation et licence")}</h3>
      {status && (
        <p className={status.up_to_date ? "muted" : "alert alert-warning"}>
          {status.up_to_date && status.accepted_at
            ? tl("Version {0}, acceptée le {1} par {2}.", [status.current, dateTime(status.accepted_at), status.accepted_by ?? "—"])
            : tl("Version {0}, pas encore acceptée par l'administrateur.", [status.current])}
        </p>
      )}
      <div className="terms-docs">
        {TERMS_DOCS.map((d) => (
          <div key={d} className="terms-doc">
            <div className="terms-doc-head">{ICONS[d]}  <strong>{termsTitle(d)}</strong></div>
            <p className="muted small">{termsSummary(d)}</p>
            <button type="button" className="btn btn-sm" onClick={() => setReading(d)}>{tl("Lire")}</button>
          </div>
        ))}
      </div>
      {getLang() === "en" && <p className="muted small">{tl("Traduction : la version française fait foi.")}</p>}
      {reading && <TermsReader doc={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
