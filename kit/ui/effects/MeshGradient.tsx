"use client";
// Four soft colour fields drifting slowly, with a touch of grain: the "mesh" and "glass" themes' backdrop.
//   <MeshGradient className="absolute inset-0" colors={["#ff7a59", "#7c5cff", "#2dd4bf", "#fef3c7"]} />
import { useRef } from "react";
import { resolveColor, useShader } from "./gl";

const FRAG = `
uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3; uniform float u_speed; uniform float u_grain;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time * u_speed;
  vec2 p0 = vec2(0.2 + 0.15*sin(t*0.9), 0.25 + 0.2*cos(t*0.7));
  vec2 p1 = vec2(0.8 + 0.12*cos(t*0.8), 0.3 + 0.18*sin(t*1.1));
  vec2 p2 = vec2(0.3 + 0.2*cos(t*0.6), 0.8 + 0.12*sin(t*0.9));
  vec2 p3 = vec2(0.75 + 0.15*sin(t*0.5), 0.75 + 0.15*cos(t*0.8));
  float a = u_res.x / u_res.y; vec2 s = vec2(a, 1.0);
  float w0 = 1.0/pow(distance(uv*s, p0*s)+0.08, 2.2);
  float w1 = 1.0/pow(distance(uv*s, p1*s)+0.08, 2.2);
  float w2 = 1.0/pow(distance(uv*s, p2*s)+0.08, 2.2);
  float w3 = 1.0/pow(distance(uv*s, p3*s)+0.08, 2.2);
  vec3 c = (u_c0*w0 + u_c1*w1 + u_c2*w2 + u_c3*w3) / (w0+w1+w2+w3);
  c += (rnd(gl_FragCoord.xy + fract(u_time)) - 0.5) * u_grain;
  gl_FragColor = vec4(c, 1.0);
}`;

export function MeshGradient({ className = "", colors = ["var(--mesh-1)", "var(--mesh-2)", "var(--mesh-3)", "var(--mesh-4)"], speed = 0.12, grain = 0.04 }:
  { className?: string; colors?: [string, string, string, string]; speed?: number; grain?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useShader(ref, FRAG, () => {
    const el = ref.current!;
    const [c0, c1, c2, c3] = colors.map((c) => resolveColor(el, c));
    return { u_c0: c0!, u_c1: c1!, u_c2: c2!, u_c3: c3!, u_speed: speed, u_grain: grain };
  }, { dpr: 1 });
  return <canvas ref={ref} className={className} aria-hidden style={{ display: "block", width: "100%", height: "100%" }} />;
}
