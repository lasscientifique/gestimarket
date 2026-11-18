import { CircleHelp, Smartphone } from "lucide-react";
import { useState } from "react";

/** Téléphone avec Google Authenticator : la ligne « Console Eden Dev », son code à 6 chiffres et le minuteur de 30 s. */
function PhoneDrawing() {
  return (
    <svg className="mfa-drawing" viewBox="0 0 300 170" role="img" aria-label="Google Authenticator affiche le code de Console Eden Dev, à taper dans la console">
      <rect x="18" y="6" width="104" height="158" rx="14" fill="var(--side)" />
      <rect x="25" y="20" width="90" height="128" rx="4" fill="var(--surface)" />
      <rect x="25" y="20" width="90" height="18" fill="var(--accent)" />
      <text x="70" y="32" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">Authenticator</text>
      <text x="31" y="56" fontSize="7" fill="var(--muted)">Eden Dev</text>
      <text x="31" y="65" fontSize="7.5" fill="var(--ink)" fontWeight="700">Console Eden Dev</text>
      <text x="31" y="86" fontSize="17" fill="var(--accent-strong)" fontWeight="700" letterSpacing="1">482 913</text>
      <circle cx="104" cy="80" r="7" fill="none" stroke="var(--line)" strokeWidth="3" />
      <path d="M104 73 A7 7 0 0 1 111 80" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <line x1="31" y1="100" x2="108" y2="100" stroke="var(--line)" />
      <text x="31" y="114" fontSize="6.5" fill="var(--muted)">autres comptes…</text>
      <circle cx="70" cy="156" r="4" fill="#41525e" />
      <path d="M134 84 H178" stroke="var(--accent)" strokeWidth="3" markerEnd="url(#mfa-arrow)" />
      <defs>
        <marker id="mfa-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      <rect x="186" y="48" width="104" height="74" rx="8" fill="var(--surface)" stroke="var(--line)" />
      <text x="196" y="66" fontSize="7.5" fill="var(--muted)">Code à 6 chiffres</text>
      <rect x="196" y="72" width="84" height="22" rx="4" fill="var(--bg)" stroke="var(--accent)" />
      <text x="238" y="88" textAnchor="middle" fontSize="13" fill="var(--ink)" fontWeight="700" letterSpacing="1">482913</text>
      <rect x="196" y="100" width="84" height="14" rx="4" fill="var(--accent)" />
      <text x="238" y="110" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">Valider</text>
    </svg>
  );
}

/** « Comment ça marche ? » : la vérification à 2 étapes expliquée simplement, avec un dessin. */
export function MfaHelp({ open: initial = false }: { open?: boolean }) {
  const [open, setOpen] = useState(initial);
  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        <CircleHelp size={15} /> Comment ça marche ?
      </button>
    );
  }
  return (
    <div className="mfa-help">
      <PhoneDrawing />
      <ol className="bullets small">
        <li>
          C'est une <strong>deuxième clé</strong>, en plus du mot de passe. Elle n'existe que sur votre téléphone : quelqu'un qui volerait le
          mot de passe ne pourrait pas entrer sans lui.
        </li>
        <li>
          Ouvrez <strong>Google Authenticator</strong> sur le téléphone. Sous « Console Eden Dev », un code de 6 chiffres change toutes les
          30 secondes (le petit cercle) : tapez celui qui est affiché maintenant.
        </li>
        <li>Pas besoin d'Internet sur le téléphone, mais son heure doit être juste (réglage automatique de l'heure).</li>
        <li>
          <Smartphone size={14} className="inline" /> Téléphone perdu ? Un membre de la Direction réinitialise votre vérification (Équipe →
          Réinitialiser), puis vous scannez un nouveau code QR. Ajoutez dès maintenant un <strong>téléphone de secours</strong> (Réglages →
          Ma sécurité).
        </li>
      </ol>
      <button type="button" className="link-btn" onClick={() => setOpen(false)}>
        Fermer l'aide
      </button>
    </div>
  );
}
