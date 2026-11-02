// One motion language for the app: quick ease-out for things that appear, the drawer curve for sheets.
// Settings → Reduce motion (and the system setting) turns these off through MotionConfig and CSS.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** Drawers and bottom sheets. */
export const SHEET = { duration: 0.25, ease: EASE_DRAWER } as const;
/** Dialogs and popups. */
export const POP = { duration: 0.2, ease: EASE_OUT } as const;
