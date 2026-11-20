"use client";
// The board: a force-directed graph on one canvas. Header-made strings are thin grey; strings the model read in
// the text are the red ones. New nodes are born next to what they connect to and ping once. Wheel/pinch zoom,
// drag to pan, drag a node to pin it, click to open its dossier. Reduced motion: the layout settles off-screen.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Board, Entity, Kind, Link } from "@/lib/types";
import { degree } from "@/lib/board";

export interface GraphHandle { fit: (ms?: number) => void; focus: (id: string) => void }
interface N extends SimulationNodeDatum { id: string; e: Entity; r: number; born: number; deg: number }
interface L extends SimulationLinkDatum<N> { id: string; l: Link }

export const KIND_COLOR: Record<Kind, string> = {
  person: "#f2f2f0", org: "#5cb8ff", place: "#3ddc84", money: "#ffc940", account: "#a3a39d", thing: "#ff7a3d",
};
const STRING = "255, 77, 0"; // --accent

export interface GraphProps {
  board: Board;
  version: number;
  visible?: (e: Entity) => boolean;
  linkVisible?: (l: Link) => boolean;
  selected?: string | null;
  lit?: { nodes: string[]; links: string[] } | null;
  onSelect?: (id: string | null) => void;
  interactive?: boolean;
  handle?: Ref<GraphHandle>;
  className?: string;
  /** A hero/embed: no wheel zoom (the page should scroll), slower drift. */
  embedded?: boolean;
  /** Pixels covered by a panel on the right / at the bottom: fit and focus frame the space that's left. */
  inset?: { right?: number; bottom?: number };
}

export function Graph({ board, version, visible, linkVisible, selected, lit, onSelect, interactive = true, handle, className, embedded, inset }: GraphProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulation<N, L> | null>(null);
  const nodes = useRef<Map<string, N>>(new Map());
  const links = useRef<L[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<string | null>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const props = useRef({ visible, linkVisible, selected, lit, onSelect, inset });
  props.current = { visible, linkVisible, selected, lit, onSelect, inset };
  const raf = useRef(0);
  const dirty = useRef(true);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const reduced = useRef(false);
  const tween = useRef<{ from: { x: number; y: number; k: number }; to: { x: number; y: number; k: number }; t0: number; ms: number } | null>(null);

  // ----- sync the simulation with the board (keep positions of nodes we already have) -----
  useEffect(() => {
    const deg = degree(board);
    const map = nodes.current;
    const now = performance.now();
    const seen = new Set<string>();
    const neighbourOf = new Map<string, string>();
    for (const l of board.links) { if (!neighbourOf.has(l.a)) neighbourOf.set(l.a, l.b); if (!neighbourOf.has(l.b)) neighbourOf.set(l.b, l.a); }
    for (const e of board.entities) {
      seen.add(e.id);
      const d = deg.get(e.id) ?? 0;
      const r = 3.2 + Math.min(14, Math.sqrt(d) * 2.1) + (e.origin === "ai" ? 1 : 0);
      const have = map.get(e.id);
      if (have) { have.e = e; have.r = r; have.deg = d; continue; }
      const nb = map.get(neighbourOf.get(e.id) ?? "");
      const a = Math.random() * Math.PI * 2;
      map.set(e.id, { id: e.id, e, r, deg: d, born: map.size ? now : now - 2000, x: (nb?.x ?? 0) + Math.cos(a) * 30, y: (nb?.y ?? 0) + Math.sin(a) * 30 });
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
    links.current = board.links.filter((l) => map.has(l.a) && map.has(l.b)).map((l) => ({ id: l.id, l, source: map.get(l.a)!, target: map.get(l.b)! }));

    const list = [...map.values()];
    if (!sim.current) {
      sim.current = forceSimulation<N, L>(list)
        .force("charge", forceManyBody<N>().strength((n) => -60 - n.r * 9).distanceMax(520))
        .force("link", forceLink<N, L>(links.current).id((n) => n.id)
          .distance((l) => (l.l.origin === "ai" ? 54 : 78) + ((l.source as N).r + (l.target as N).r))
          .strength((l) => (l.l.origin === "ai" ? 0.5 : 0.12 / Math.max(1, Math.min((l.source as N).deg, (l.target as N).deg) / 4))))
        .force("collide", forceCollide<N>((n) => n.r + 6).strength(0.9))
        .force("x", forceX<N>(0).strength(0.035)).force("y", forceY<N>(0).strength(0.045))
        .force("center", forceCenter(0, 0))
        .alphaDecay(0.022).velocityDecay(0.32)
        .on("tick", () => { dirty.current = true; });
    } else {
      sim.current.nodes(list);
      (sim.current.force("link") as ReturnType<typeof forceLink<N, L>>).links(links.current);
      sim.current.alpha(Math.max(sim.current.alpha(), 0.45)).restart();
    }
    if (reduced.current) { sim.current.stop(); for (let i = 0; i < 260; i++) sim.current.tick(); }
    dirty.current = true;
  }, [board, version]);

  useEffect(() => () => { sim.current?.stop(); }, []);
  useEffect(() => { dirty.current = true; }, [visible, linkVisible, selected, lit]);

  // ----- camera -----
  const bounds = useCallback((ids?: Set<string>) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes.current.values()) {
      if (ids && !ids.has(n.id)) continue;
      if (props.current.visible && !props.current.visible(n.e)) continue;
      x0 = Math.min(x0, n.x! - n.r); y0 = Math.min(y0, n.y! - n.r); x1 = Math.max(x1, n.x! + n.r); y1 = Math.max(y1, n.y! + n.r);
    }
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }, []);
  const frame = useCallback((bb: { x0: number; y0: number; x1: number; y1: number }, ms: number, maxK = 2.2) => {
    const w = size.current.w - (props.current.inset?.right ?? 0), h = size.current.h - (props.current.inset?.bottom ?? 0);
    const pad = Math.min(w, h) < 500 ? 28 : 70;
    const k = Math.min(maxK, Math.max(0.15, Math.min((w - pad * 2) / Math.max(40, bb.x1 - bb.x0), (h - pad * 2) / Math.max(40, bb.y1 - bb.y0))));
    const to = { k, x: w / 2 - ((bb.x0 + bb.x1) / 2) * k, y: h / 2 - ((bb.y0 + bb.y1) / 2) * k };
    if (ms <= 0 || reduced.current) { view.current = to; dirty.current = true; return; }
    tween.current = { from: { ...view.current }, to, t0: performance.now(), ms };
  }, []);
  useImperativeHandle(handle, () => ({
    fit: (ms = 600) => { const bb = bounds(); if (bb) frame(bb, ms, size.current.w < 640 ? 1.1 : 1.6); },
    focus: (id) => {
      const ids = new Set([id]);
      for (const l of links.current) if (l.l.a === id || l.l.b === id) { ids.add(l.l.a); ids.add(l.l.b); }
      const bb = bounds(ids); if (bb) frame(bb, 520, 2.4);
    },
  }), [bounds, frame]);

  // ----- draw loop -----
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const first = size.current.w <= 1;
      size.current = { w: r.width, h: r.height, dpr };
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      if (first) view.current = { x: r.width / 2, y: r.height / 2, k: Math.min(r.width, r.height) < 500 ? 0.55 : 0.9 };
      dirty.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    let fitted = false;

    const draw = (t: number) => {
      raf.current = requestAnimationFrame(draw);
      if (tween.current) {
        const { from, to, t0, ms } = tween.current;
        const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
        if (p >= 1) tween.current = null;
        dirty.current = true;
      }
      const pinging = [...nodes.current.values()].some((n) => t - n.born < 1400);
      if (!dirty.current && !pinging) return;
      dirty.current = false;
      if (!fitted && nodes.current.size > 3 && (sim.current?.alpha() ?? 1) < 0.25) { fitted = true; const bb = bounds(); if (bb) frame(bb, 700); }

      const { w, h, dpr } = size.current;
      const { x: vx, y: vy, k } = view.current;
      const P = props.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // dot grid that pans with the board
      const gap = 28 * k;
      if (gap > 9) {
        ctx.fillStyle = "rgba(255,255,255,0.055)";
        for (let gx = ((vx % gap) + gap) % gap; gx < w; gx += gap) for (let gy = ((vy % gap) + gap) % gap; gy < h; gy += gap) ctx.fillRect(gx, gy, 1, 1);
      }

      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * vx, dpr * vy);
      const vis = (n: N) => !P.visible || P.visible(n.e);
      const sel = P.selected ?? null;
      const hov = hover.current;
      const focusIds = new Set<string>();
      const focusLinks = new Set<string>();
      const anchor = hov ?? sel;
      if (anchor) { focusIds.add(anchor); for (const l of links.current) if (l.l.a === anchor || l.l.b === anchor) { focusIds.add(l.l.a); focusIds.add(l.l.b); focusLinks.add(l.id); } }
      const litN = new Set(P.lit?.nodes ?? []), litL = new Set(P.lit?.links ?? []);
      const staging = litN.size > 0 || focusIds.size > 0;
      const on = (id: string) => litN.has(id) || focusIds.has(id);

      // strings
      for (const pass of ["comm", "ai"] as const) for (const L of links.current) {
        const s = L.source as N, d = L.target as N;
        if (L.l.origin !== pass || !vis(s) || !vis(d)) continue;
        if (P.linkVisible && !P.linkVisible(L.l)) continue;
        const hot = litL.has(L.id) || focusLinks.has(L.id);
        const dim = staging && !hot;
        ctx.beginPath(); ctx.moveTo(s.x!, s.y!);
        if (pass === "ai") {
          // a slight sag, like real string pinned between two points
          const mx = (s.x! + d.x!) / 2, my = (s.y! + d.y!) / 2 + Math.hypot(d.x! - s.x!, d.y! - s.y!) * 0.06;
          ctx.quadraticCurveTo(mx, my, d.x!, d.y!);
          ctx.strokeStyle = `rgba(${STRING}, ${dim ? 0.1 : hot ? 1 : 0.62})`;
          ctx.lineWidth = (hot ? 2.2 : 1.2) / Math.sqrt(k);
          if (hot) { ctx.shadowColor = `rgba(${STRING},0.9)`; ctx.shadowBlur = 10; }
        } else {
          ctx.lineTo(d.x!, d.y!);
          ctx.strokeStyle = `rgba(242,242,240, ${dim ? 0.03 : hot ? 0.5 : Math.min(0.2, 0.06 + L.l.count * 0.02)})`;
          ctx.lineWidth = (hot ? 1.2 : 0.7) / Math.sqrt(k);
        }
        ctx.stroke(); ctx.shadowBlur = 0;
      }

      // nodes
      const all = [...nodes.current.values()].filter(vis).sort((a, b) => a.r - b.r);
      for (const n of all) {
        const age = t - n.born;
        const grow = age < 420 && !reduced.current ? 0.4 + 0.6 * (1 - Math.pow(1 - age / 420, 3)) * (1 + 0.06 * Math.sin((age / 420) * Math.PI)) : 1;
        const r = n.r * grow;
        const dim = staging && !on(n.id);
        const col = KIND_COLOR[n.e.kind];
        ctx.globalAlpha = dim ? 0.16 : 1;
        if (age < 1400 && !reduced.current) {
          const p = age / 1400;
          ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4 + p * 26, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${STRING}, ${0.55 * (1 - p)})`; ctx.lineWidth = 1.4 / k; ctx.stroke();
        }
        shape(ctx, n.e.kind, n.x!, n.y!, r);
        ctx.fillStyle = n.e.origin === "meta" ? "#0a0a0a" : col;
        ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = (n.e.origin === "meta" ? 1.2 : 0) / k + (n.id === sel ? 2 / k : 0);
        if (ctx.lineWidth > 0) ctx.stroke();
        if (n.id === sel || litN.has(n.id)) {
          ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 5 / k + 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${STRING},0.95)`; ctx.lineWidth = 1.5 / k; ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // labels: big nodes always, the focused neighbourhood, and everything when zoomed in
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const fs = 11 / Math.max(0.6, Math.min(1.6, k));
      ctx.font = `500 ${fs}px ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace`;
      const minDeg = k > 1.5 ? 0 : k > 0.9 ? 6 : 12;
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (const n of [...all].sort((a, b) => Number(on(b.id)) - Number(on(a.id)) || b.deg - a.deg)) {
        const show = on(n.id) || (!staging && n.deg >= minDeg) || n.id === sel;
        if (!show) continue;
        const label = n.e.name.length > 26 ? n.e.name.slice(0, 25) + "…" : n.e.name;
        const tw = ctx.measureText(label).width;
        const box = { x0: n.x! - tw / 2 - 3, y0: n.y! + n.r + 3, x1: n.x! + tw / 2 + 3, y1: n.y! + n.r + 4 + fs };
        if (!on(n.id) && placed.some((p) => !(box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1))) continue;
        placed.push(box);
        ctx.fillStyle = "rgba(10,10,10,0.78)";
        ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0 + 1);
        ctx.fillStyle = staging && !on(n.id) ? "rgba(242,242,240,0.3)" : n.e.origin === "meta" ? "rgba(242,242,240,0.7)" : "#f2f2f0";
        ctx.fillText(label, n.x!, n.y! + n.r + 4);
      }
      // the hovered string's label
      if (anchor) for (const L of links.current) {
        if (!focusLinks.has(L.id) || L.l.origin !== "ai") continue;
        const s = L.source as N, d = L.target as N;
        if (!vis(s) || !vis(d)) continue;
        const mx = (s.x! + d.x!) / 2, my = (s.y! + d.y!) / 2 + Math.hypot(d.x! - s.x!, d.y! - s.y!) * 0.03;
        ctx.font = `500 ${fs * 0.92}px ui-monospace, Menlo, monospace`;
        const tw = ctx.measureText(L.l.label).width;
        ctx.fillStyle = "rgba(255,77,0,0.92)"; ctx.fillRect(mx - tw / 2 - 3, my - fs * 0.6, tw + 6, fs * 1.15);
        ctx.fillStyle = "#0a0a0a"; ctx.fillText(L.l.label, mx, my - fs * 0.5);
      }
    };
    raf.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf.current); ro.disconnect(); };
  }, [bounds, frame]);

  // ----- input -----
  const toWorld = (px: number, py: number) => { const v = view.current; return { x: (px - v.x) / v.k, y: (py - v.y) / v.k }; };
  const hit = (px: number, py: number): N | null => {
    const p = toWorld(px, py);
    let best: N | null = null, bd = Infinity;
    for (const n of nodes.current.values()) {
      if (props.current.visible && !props.current.visible(n.e)) continue;
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      const reach = n.r + 8 / view.current.k;
      if (d < reach && d < bd) { best = n; bd = d; }
    }
    return best;
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    canvas.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: view.current.k };
      drag.current = null; return;
    }
    const n = hit(p.x, p.y);
    tween.current = null;
    drag.current = n ? { kind: "node", id: n.id, sx: p.x, sy: p.y, vx: 0, vy: 0, moved: false } : { kind: "pan", sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, (pinch.current.k * d) / pinch.current.d / view.current.k);
      return;
    }
    const D = drag.current;
    if (D) {
      if (Math.hypot(p.x - D.sx, p.y - D.sy) > 4) D.moved = true;
      if (D.kind === "pan") view.current = { ...view.current, x: D.vx + p.x - D.sx, y: D.vy + p.y - D.sy };
      else if (D.moved) {
        const n = nodes.current.get(D.id!)!; const w = toWorld(p.x, p.y);
        n.fx = w.x; n.fy = w.y; sim.current?.alphaTarget(0.25).restart();
      }
      dirty.current = true; return;
    }
    const n = hit(p.x, p.y);
    if ((n?.id ?? null) !== hover.current) { hover.current = n?.id ?? null; dirty.current = true; canvas.current!.style.cursor = n ? "pointer" : "grab"; }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const D = drag.current; drag.current = null;
    if (!D) return;
    if (D.kind === "node") {
      const n = nodes.current.get(D.id!);
      sim.current?.alphaTarget(0);
      if (!D.moved) { props.current.onSelect?.(D.id!); if (n) { n.fx = null; n.fy = null; } }
    } else if (!D.moved) props.current.onSelect?.(null);
  };
  const zoomAt = (px: number, py: number, f: number) => {
    const v = view.current;
    const k = Math.min(5, Math.max(0.12, v.k * f));
    view.current = { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    dirty.current = true;
  };
  useEffect(() => {
    const c = canvas.current!;
    const wheel = (e: WheelEvent) => {
      if (!interactive || embedded) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      tween.current = null;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [interactive, embedded]);

  return (
    <canvas ref={canvas} className={className ?? "absolute inset-0 h-full w-full"} style={{ touchAction: "none", cursor: interactive ? "grab" : "default" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={() => { if (hover.current) { hover.current = null; dirty.current = true; } }}
      role="img" aria-label={`Link graph: ${board.entities.length} entities and ${board.links.length} connections`} />
  );
}

function shape(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, r: number) {
  ctx.beginPath();
  switch (kind) {
    case "org": { const s = r * 0.9; ctx.rect(x - s, y - s, s * 2, s * 2); break; }
    case "thing": ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); break;
    case "place": ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.lineTo(x - r * 1.1, y + r * 0.8); ctx.closePath(); break;
    case "money": for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; const px = x + Math.cos(a) * r * 1.08, py = y + Math.sin(a) * r * 1.08; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); break;
    case "account": { const s = r * 0.8; ctx.rect(x - s, y - s * 0.7, s * 2, s * 1.4); break; }
    default: ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}
