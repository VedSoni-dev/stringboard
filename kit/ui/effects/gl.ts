"use client";
// A tiny full-screen fragment-shader runner for the backdrop effects. No dependencies.
// Pauses when off-screen or when the tab is hidden; draws one still frame under prefers-reduced-motion.
import { useEffect, type RefObject } from "react";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

export type Uniforms = Record<string, number | [number, number, number] | [number, number]>;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Resolves a CSS color (hex or var(--token)) to RGB 0..1, reading tokens from the canvas element. */
export function resolveColor(el: Element, value: string): [number, number, number] {
  const v = value.startsWith("var(") ? getComputedStyle(el).getPropertyValue(value.slice(4, -1).trim()).trim() : value;
  if (v.startsWith("#")) return hexToRgb(v);
  const m = v.match(/[\d.]+/g)?.map(Number);
  return m && m.length >= 3 ? [m[0]! / 255, m[1]! / 255, m[2]! / 255] : [0, 0, 0];
}

export function useShader(ref: RefObject<HTMLCanvasElement | null>, frag: string, uniforms: () => Uniforms, opts: { dpr?: number } = {}) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `precision highp float;\nuniform vec2 u_res; uniform float u_time;\n${frag}`));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const dpr = Math.min(opts.dpr ?? window.devicePixelRatio ?? 1, 2);
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true, raf = 0;
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; if (visible && !raf && !still) raf = requestAnimationFrame(draw); });
    io.observe(canvas);
    const t0 = performance.now();
    function draw(now: number) {
      raf = 0;
      resize();
      gl!.uniform2f(gl!.getUniformLocation(prog, "u_res"), canvas!.width, canvas!.height);
      gl!.uniform1f(gl!.getUniformLocation(prog, "u_time"), still ? 12.0 : (now - t0) / 1000);
      for (const [k, v] of Object.entries(uniforms())) {
        const l = gl!.getUniformLocation(prog, k);
        if (typeof v === "number") gl!.uniform1f(l, v);
        else if (v.length === 2) gl!.uniform2f(l, v[0], v[1]);
        else gl!.uniform3f(l, v[0], v[1], v[2]);
      }
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(draw);
    }
    const onVis = () => { if (!document.hidden && visible && !raf && !still) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frag]);
}
