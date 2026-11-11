import { lazy, Suspense, useEffect, useState } from "react";
import { MANUAL_EVENT } from "./Help";

const ManualViewer = lazy(() => import("./ManualViewer"));

/** Ouvre le lecteur du manuel quand un bouton « Manuel d'utilisation » le demande (pdf.js chargé à ce moment-là). */
export function ManualHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(MANUAL_EVENT, show);
    return () => window.removeEventListener(MANUAL_EVENT, show);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ManualViewer onClose={() => setOpen(false)} />
    </Suspense>
  );
}
