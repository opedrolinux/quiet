import { useCallback, useEffect, useRef, useState } from "react";
import { SWITCHER_W, readMetrics, setWidth } from "../lib/window";

/** Must match the --slide duration in theme.css. */
const DURATION_MS = 200;

const root = () => document.documentElement;
const setVar = (name: string, value: string) => root().style.setProperty(name, value);

/**
 * Slides the note list open by widening the window on its right edge.
 *
 * The first version advanced the OS window width and the panel width together
 * on every animation frame. That is what produced the pop and the judder: each
 * frame issued a synchronous resize of a transparent acrylic window, the
 * compositor delivered it a frame or two late and rounded to whole device
 * pixels, and the glass edge lagged the content it was meant to contain.
 *
 * Now the window is resized exactly twice per toggle — once up front on the way
 * open, once at the very end on the way closed — and the panel is a plain CSS
 * transition on a registered custom property, which the compositor can run on
 * its own. In between, the glass is sized from `--app-base`, a pixel width
 * measured before the resize, so it does not care when the resize actually
 * lands. The editor's own width is that minus the panel, constant throughout,
 * which is why the text never reflows.
 */
export function useSwitcherPanel() {
  const [mounted, setMounted] = useState(false);
  const openRef = useRef(false);
  // Whether the window is currently carrying the extra width. Not the same as
  // openRef: it stays true for the length of a close animation.
  const reserved = useRef(false);
  // Set around our own resizes, so the listener below cannot mistake one for
  // the user dragging an edge and rebase off it.
  const busy = useRef(false);
  const closeTimer = useRef<number | null>(null);

  // Dragging a resize handle with the panel pinned open would otherwise leave
  // the glass at its old pixel width while the window moved on without it.
  useEffect(() => {
    const onResize = () => {
      if (!reserved.current || busy.current) return;
      setVar("--app-base", window.innerWidth - SWITCHER_W + "px");
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const settle = () => {
    busy.current = true;
    // Two frames: one for the resize to reach the compositor, one to paint it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        busy.current = false;
      }),
    );
  };

  const setOpen = useCallback(async (next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;

    // A reversal mid-close must not let the pending shrink fire underneath it.
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }

    if (next) {
      setMounted(true);
      if (!reserved.current) {
        // Measured now rather than cached, so a window the user has resized by
        // hand still opens from its real size.
        const m = await readMetrics();
        const base = m ? m.width : window.innerWidth;
        setVar("--app-base", base + "px");
        // Pinning the width to `base` is a no-op at this instant — the glass is
        // already that wide — so adding the class cannot flash.
        root().classList.add("reserved");
        reserved.current = true;
        busy.current = true;
        if (m) await setWidth(base + SWITCHER_W, m.height);
        settle();
      }
      // One frame later, so the pinned width is in effect before the transition
      // starts from it.
      requestAnimationFrame(() => {
        if (openRef.current) setVar("--switcher-w", SWITCHER_W + "px");
      });
      return;
    }

    setVar("--switcher-w", "0px");
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMounted(false);
      void (async () => {
        const base = parseFloat(getComputedStyle(root()).getPropertyValue("--app-base"));
        const m = await readMetrics();
        busy.current = true;
        if (m && Number.isFinite(base)) await setWidth(base, m.height);
        // The glass is already `base` wide, so dropping the pin once the window
        // has caught up changes nothing on screen.
        requestAnimationFrame(() => {
          root().classList.remove("reserved");
          reserved.current = false;
          settle();
        });
      })();
    }, DURATION_MS);
  }, []);

  return { mounted, setOpen, isOpen: () => openRef.current };
}
