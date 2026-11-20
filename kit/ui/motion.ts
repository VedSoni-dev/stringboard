"use client";
// Motion helpers for the laws in docs/principles.md that CSS alone can't do: arcs (7), anticipation (2), follow-through (5).
// Web Animations API only; every helper respects prefers-reduced-motion (it jumps to the end state).

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const SPRING = "linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067, 1.087 24.1%, 1.085, 1.068 28.3%, 1.01 33.9%, .993 37.5%, .986 40.6%, .997 51.5%, 1.002 59.2%, 1)";
export const EASE_OUT = "cubic-bezier(.22, 1, .36, 1)";

/** Moves `el` from where it is to (dx, dy) on a curve (law 7). `lift` is how far the arc bows, in px. */
export function arc(el: HTMLElement, dx: number, dy: number, { lift = Math.min(160, Math.hypot(dx, dy) * 0.35), duration = 420, scaleTo = 1 } = {}): Animation | null {
  if (reduced()) { el.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleTo})`; return null; }
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = dx * t, y = dy * t - 4 * lift * t * (1 - t); // quadratic bow above the straight line
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 + (scaleTo - 1) * t})`, offset: t });
  }
  return el.animate(frames, { duration, easing: EASE_OUT, fill: "forwards" });
}

/** A big exit with a wind-up first (law 2): back by `back` px, then away along (dx, dy). */
export function anticipate(el: HTMLElement, dx: number, dy: number, { back = 8, duration = 360 } = {}): Animation | null {
  if (reduced()) { el.style.opacity = "0"; return null; }
  const len = Math.hypot(dx, dy) || 1;
  const bx = (-dx / len) * back, by = (-dy / len) * back;
  return el.animate([
    { transform: "translate(0,0)", offset: 0 },
    { transform: `translate(${bx}px, ${by}px) scale(.98)`, offset: 0.22, easing: "cubic-bezier(.3,0,.7,1)" },
    { transform: `translate(${dx}px, ${dy}px) scale(.9)`, opacity: 0, offset: 1 },
  ], { duration, easing: "cubic-bezier(.55,0,1,.45)", fill: "forwards" });
}

/** Children of `container` settle one after another, after the container lands (law 5). */
export function settle(container: HTMLElement, { delay = 60, step = 40 } = {}): void {
  if (reduced()) return;
  Array.from(container.children).forEach((child, i) =>
    (child as HTMLElement).animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: delay + i * step, easing: SPRING, fill: "backwards" }));
}

/** A short, unmistakable error shake (law 10). */
export function shake(el: HTMLElement): void {
  if (reduced()) return;
  el.animate([{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(2px)" }, { transform: "none" }],
    { duration: 240, easing: EASE_OUT });
}
