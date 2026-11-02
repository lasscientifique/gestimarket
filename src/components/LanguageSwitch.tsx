import { Languages } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { getLang, LANGS, setLang, tl, type Lang } from "../lib/i18n";

/**
 * Choix de la langue (français, anglais). Connecté : la langue est retenue pour l'utilisateur
 * (elle le suit sur tous les postes) ; sinon pour ce poste. L'interface se recharge.
 */
export function LanguageSwitch({ compact, light }: { compact?: boolean; light?: boolean }) {
  const { user } = useApp();
  const current = getLang();
  const choose = async (l: Lang) => {
    if (l === current) return;
    if (user) await api.setMyLang(l).catch(() => undefined);
    setLang(l);
  };
  if (compact) {
    const next = LANGS.find((l) => l.code !== current)!;
    return (
      <button type="button" className={`icon-btn${light ? " light" : ""} lang-btn`} title={tl("Langue : {0}", [next.label])} onClick={() => choose(next.code)}>
        <Languages size={16} />
        <span className="lang-code">{current.toUpperCase()}</span>
      </button>
    );
  }
  return (
    <div className="lang-switch" role="group" aria-label={tl("Langue")}>
      <Languages size={16} />
      {LANGS.map((l) => (
        <button key={l.code} type="button" className={l.code === current ? "active" : ""} onClick={() => choose(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
