// Film grain over the whole page (the "paper" theme, or a light touch on any theme). Pure SVG, no JS.
//   <Grain opacity={0.08} />
export function Grain({ opacity = 0.07, className = "" }: { opacity?: number; className?: string }) {
  return (
    <svg className={className} aria-hidden style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50, opacity, mixBlendMode: "multiply" }}>
      <filter id="studio-grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter="url(#studio-grain)" />
    </svg>
  );
}
