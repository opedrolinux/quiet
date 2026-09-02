import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

/** Must match --switcher-w in theme.css. */
export const SWITCHER_W = 110;

export const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Grow or shrink the OS window on its LEFT edge.
 *
 * The point of moving x by the same amount we change the width is that the
 * right-hand editor keeps its exact screen position: opening the switcher must
 * never reflow the text or shift the caret out from under the user.
 */
export async function widenLeft(px: number): Promise<void> {
  if (!inTauri) return;
  const w = getCurrentWindow();
  const sf = await w.scaleFactor();
  const d = Math.round(px * sf);
  const pos = await w.outerPosition();
  const size = await w.outerSize();
  await w.setSize(new PhysicalSize(size.width + d, size.height));
  await w.setPosition(new PhysicalPosition(pos.x - d, pos.y));
}

export async function startDrag(): Promise<void> {
  if (!inTauri) return;
  await getCurrentWindow().startDragging();
}

export async function startResize(dir: string): Promise<void> {
  if (!inTauri) return;
  // The string form matches Tauri's ResizeDirection serialisation.
  await getCurrentWindow().startResizeDragging(dir as never);
}

export async function hideWindow(): Promise<void> {
  if (!inTauri) return;
  // hide() is what hands focus back to the window underneath. Trying to
  // restore focus manually is less reliable on Windows than simply vanishing.
  await getCurrentWindow().hide();
}
