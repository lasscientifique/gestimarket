/** Emblème de la console : bouclier d'Eden Dev (même dessin que l'icône de l'application). */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#0B1A24" />
      <path d="M256 92 386 140v104c0 86-54 152-130 180-76-28-130-94-130-180V140z" fill="#0EA5A4" />
      <path d="M256 92 386 140v104c0 86-54 152-130 180z" fill="#0B8A89" />
      <path d="m196 258 42 42 82-88" fill="none" stroke="#fff" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
