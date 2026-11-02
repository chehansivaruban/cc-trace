// One motion language for the app: quick ease-out for things that appear, the drawer curve for sheets.
// Settings → Reduce motion (and the system setting) turns these off through MotionConfig and CSS.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** Drawers and bottom sheets. */
export const SHEET = { duration: 0.25, ease: EASE_DRAWER } as const;
/** Dialogs and popups. */
export const POP = { duration: 0.2, ease: EASE_OUT } as const;

type Move = { x?: number | string; y?: number | string; scale?: number };
type Transition = Record<string, unknown>;
const settle = (from: Move): Move => Object.fromEntries(Object.keys(from).map((k) => [k, k === "scale" ? 1 : 0]));

/**
 * Props for something that fades in with a small move (`from`), for `<motion.x {...appear(reduce, …)}>`.
 * With reduce motion it only fades: framer's MotionConfig doesn't stop every transform (raw `transform`
 * strings, hardware-accelerated animations), so the app decides here.
 */
export function appear(reduce: boolean, from: Move, transition: Transition = POP, exit = 0.12) {
  return reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: exit } }, transition }
    : { initial: { opacity: 0, ...from }, animate: { opacity: 1, ...settle(from) }, exit: { opacity: 0, ...from, transition: { duration: exit } }, transition };
}

/** Props for a drawer or sheet that slides in from `from` (e.g. `{ x: "-100%" }`); with reduce motion it fades. */
export function slide(reduce: boolean, from: Move, transition: Transition = SHEET) {
  return reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: from, animate: settle(from), exit: from, transition };
}
