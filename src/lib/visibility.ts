// Tâches répétées qui respectent le téléphone : rien n'est envoyé quand l'application est cachée
// (écran éteint, autre application ouverte). Au retour, la tâche en retard est faite aussitôt.
// Moins de données mobiles, moins de batterie, et la petite connexion Internet de la boutique reste libre.

/** Répète `fn` toutes les `ms` millisecondes tant que la page est visible. Retourne la fonction d'arrêt. */
export function every(ms: number, fn: () => void): () => void {
  let missed = false;
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) {
      missed = true;
      return;
    }
    fn();
  };
  const timer = window.setInterval(tick, ms);
  const onVisible = () => {
    if (!document.hidden && missed) {
      missed = false;
      fn();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Téléphone ou tablette (écran tactile, ou petit écran) : affichages plus légers par défaut. */
export function isPhoneLike(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
  } catch {
    return false;
  }
}
