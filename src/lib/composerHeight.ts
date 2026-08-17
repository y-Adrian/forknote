/**
 * Chat composer textarea height — auto-grow floor + user drag preference.
 * Preference is a floor: content can still grow above it up to the max.
 */

import {
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "./browserStorage";

export const COMPOSER_HEIGHT_STORAGE_KEY = "forknote-composer-height";

/** ~2 lines at compact chat font. */
export const COMPOSER_HEIGHT_MIN_COMPACT = 36;
/** ~3 lines at hero chat font. */
export const COMPOSER_HEIGHT_MIN_HERO = 64;
/** Hard cap so the composer cannot dominate the chat column. */
export const COMPOSER_HEIGHT_MAX_PX = 280;
/** Fraction of viewport height used as a soft max (with MAX_PX). */
export const COMPOSER_HEIGHT_MAX_VH = 0.38;

export function composerHeightMin(compact: boolean): number {
  return compact ? COMPOSER_HEIGHT_MIN_COMPACT : COMPOSER_HEIGHT_MIN_HERO;
}

export function composerHeightMax(
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800,
): number {
  const byViewport = Math.floor(viewportHeight * COMPOSER_HEIGHT_MAX_VH);
  return Math.max(
    COMPOSER_HEIGHT_MIN_HERO,
    Math.min(COMPOSER_HEIGHT_MAX_PX, byViewport),
  );
}

export function clampComposerHeight(
  height: number,
  compact: boolean,
  viewportHeight?: number,
): number {
  const min = composerHeightMin(compact);
  const max = Math.max(min, composerHeightMax(viewportHeight));
  if (!Number.isFinite(height)) return min;
  return Math.min(max, Math.max(min, Math.round(height)));
}

/**
 * Resolve display height from content scroll size and an optional user floor.
 */
export function resolveComposerHeight(opts: {
  contentHeight: number;
  floorHeight: number | null;
  compact: boolean;
  viewportHeight?: number;
}): number {
  const min = composerHeightMin(opts.compact);
  const floor =
    opts.floorHeight != null && Number.isFinite(opts.floorHeight)
      ? opts.floorHeight
      : min;
  const content = Number.isFinite(opts.contentHeight)
    ? opts.contentHeight
    : min;
  return clampComposerHeight(
    Math.max(content, floor, min),
    opts.compact,
    opts.viewportHeight,
  );
}

export function readStoredComposerHeight(): number | null {
  try {
    const raw = localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  } catch {
    return null;
  }
}

export function writeStoredComposerHeight(height: number | null): void {
  if (height == null || !Number.isFinite(height) || height <= 0) {
    safeLocalStorageRemoveItem(COMPOSER_HEIGHT_STORAGE_KEY);
    return;
  }
  safeLocalStorageSetItem(
    COMPOSER_HEIGHT_STORAGE_KEY,
    String(Math.round(height)),
  );
}
