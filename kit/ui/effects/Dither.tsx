"use client";
// Ordered (Bayer 8×8) dither over a slow flowing noise field: the "dither" theme's backdrop and a hero texture.
//   <Dither className="absolute inset-0" ink="var(--accent)" paper="var(--bg)" pixel={3} />
import { useRef } from "react";
import { resolveColor, useShader } from "./gl";

const FRAG = `
uniform vec3 u_ink; uniform vec3 u_paper; uniform float u_pixel; uniform float u_speed; uniform float u_scale; uniform vec2 u_focus;
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer8(vec2 a){ return bayer2(.5*.5*a)*.25 + bayer2(.5*a)*.25*.25 + bayer2(a)*.25*.25*.25*4. ; }
vec2 hash(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(dot(hash(i), f), dot(hash(i+vec2(1,0)), f-vec2(1,0)), u.x), mix(dot(hash(i+vec2(0,1)), f-vec2(0,1)), dot(hash(i+vec2(1,1)), f-vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.02; a *= 0.5; } return v; }
void main(){
  vec2 px = floor(gl_FragCoord.xy / u_pixel);
  vec2 uv = (px * u_pixel) / u_res.y;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(uv*u_scale + vec2(0.0, t*0.6)), fbm(uv*u_scale + vec2(5.2, -t*0.4)));
  float v = fbm(uv*u_scale + 1.6*q + vec2(t*0.15, 0.0));
  float d = distance(gl_FragCoord.xy / u_res, u_focus);
  v = clamp(v*1.1 + 0.5 - d*0.55, 0.0, 1.0);
  float on = step(bayer8(px) + 0.08, v*v*0.92);
  gl_FragColor = vec4(mix(u_paper, u_ink, on), 1.0);
}`;

export function Dither({ className = "", ink = "var(--accent)", paper = "var(--bg)", pixel = 3, speed = 0.08, scale = 2.2, focus = [0.7, 0.6] as [number, number] }:
  { className?: string; ink?: string; paper?: string; pixel?: number; speed?: number; scale?: number; focus?: [number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useShader(ref, FRAG, () => {
    const el = ref.current!;
    return { u_ink: resolveColor(el, ink), u_paper: resolveColor(el, paper), u_pixel: pixel * Math.min(window.devicePixelRatio || 1, 2), u_speed: speed, u_scale: scale, u_focus: focus };
  });
  return <canvas ref={ref} className={className} aria-hidden style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }} />;
}
