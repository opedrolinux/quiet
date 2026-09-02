import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

/**
 * Open width of the note list, in logical px.
 *
 * Wide enough for a number column plus roughly a dozen characters of title.
 * It is deliberately the only fixed dimension in the app: the original mockup
 * gave the list 40% of the window, which was the exact complaint that started
 * the project.
 */
export const SWITCHER_W = 124;

export const inTauri = "__TAURI_INTERNALS__" in window;

export type Metrics = { width: number; height: number };

/** Current outer size in logical (CSS) pixels. */
export async function readMetrics(): Promise<Metrics | null> {
  if (!inTauri) return null;
  const w = getCurrentWindow();
  const sf = await w.scaleFactor();
  const s = await w.outerSize();
  return { width: s.width / sf, height: s.height / sf };
}

/**
 * Resize on the RIGHT edge only — position is never touched.
 *
 * The earlier version grew leftward so the editor stayed put on screen, but
 * that walks the window's x towards (and past) zero. Growing rightward keeps
 * the window anchored where the user put it.
 */
export async function setWidth(width: number, height: number): Promise<void> {
  if (!inTauri) return;
  await getCurrentWindow().setSize(new LogicalSize(Math.round(width), Math.round(height)));
}

export async function startDrag(): Promise<void> {
  if (!inTauri) return;
  await getCurrentWindow().startDragging();
}

export async function startResize(dir: string): Promise<void> {
  if (!inTauri) return;
  await getCurrentWindow().startResizeDragging(dir as never);
}

/**
 * Hand the keyboard back to the app that had it, leaving the note on screen.
 *
 * Distinct from hideWindow: the window stays visible and always-on-top, you
 * just stop typing into it. Falls back to hiding if Windows refuses the
 * foreground change, so Esc always does *something*.
 */
export async function backFocus(): Promise<void> {
  if (!inTauri) return;
  const ok = await invoke<boolean>("back_focus").catch(() => false);
  if (!ok) await hideWindow();
}

export async function hideWindow(): Promise<void> {
  if (!inTauri) return;
  // hide() is what hands focus back to the window underneath. Trying to
  // restore focus manually is less reliable on Windows than simply vanishing.
  await getCurrentWindow().hide();
}
