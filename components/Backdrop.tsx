"use client";
// The theme's backdrop. new-app.mjs sets THEME; restyle freely per build (the taste skill decides the final look).
import { Dither } from "@/kit/ui/effects/Dither";
import { MeshGradient } from "@/kit/ui/effects/MeshGradient";
import { Grain } from "@/kit/ui/effects/Grain";

const THEME = "dither" as string;

export function Backdrop({ className = "absolute inset-0 -z-10" }: { className?: string }) {
  if (THEME === "dither") return <div className={className}><Dither /><div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/10" /><div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg" /></div>;
  if (THEME === "mesh" || THEME === "glass") return <div className={className}><MeshGradient /><div className="absolute inset-0 bg-gradient-to-b from-transparent to-bg" /></div>;
  if (THEME === "paper") return <Grain opacity={0.09} />;
  return null;
}
