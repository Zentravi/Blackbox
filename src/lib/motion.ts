import type { Variants } from "motion/react";

/**
 * Shared motion tokens — one source of truth for animation timing so every
 * surface (route transitions, panels, menus, value swaps) feels consistent.
 * Durations are in seconds (Motion convention).
 */
export const MOTION = {
  /** Micro feedback: value swaps, hover/press. */
  instant: 0.12,
  /** Small elements: menus, badges, chips. */
  fast: 0.16,
  /** Default: cards, page content, dialogs. */
  base: 0.22,
  /** Emphasis: hero panels, staged reveals. */
  slow: 0.32,
} as const;

/** Gentle deceleration for entrances. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Quicker acceleration for exits. */
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];
/** Symmetric ease for value swaps. */
export const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1];

/** Standard entrance/exit transition preset. */
export const transition = (duration: number = MOTION.base, ease = EASE_OUT) =>
  ({ duration, ease }) as const;

/** Page/card entrance: rise + fade. */
export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: MOTION.fast, ease: EASE_IN } },
};

/** Simple fade (no movement — use where layout must not shift). */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: MOTION.base, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: MOTION.fast, ease: EASE_IN } },
};

/** Parent container that staggers direct motion children using `riseVariants`. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/** Direct child of `staggerContainer` (children must set variants={riseVariants}). */
export const staggerItem: Variants = riseVariants;
