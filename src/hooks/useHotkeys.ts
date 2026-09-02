import { useEffect } from "react";

export type Handlers = {
  next: () => void;
  prev: () => void;
  create: () => void;
  toggleSwitcher: () => void;
  toggleSettings: () => void;
  jump: (index: number) => void;
  remove: () => void;
  hide: () => void;
  backFocus: () => void;
  bumpText: (delta: number) => void;
};

/**
 * Every control in the app, in one place.
 *
 * Registered in the capture phase so CodeMirror never swallows a binding: the
 * editor owns the keyboard the rest of the time, which is the whole point.
 */
export function useHotkeys(h: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Escape is handled on keyup, not here. Hiding during keydown hands
      // focus to the window underneath while the key is still held, so its
      // keyup lands there instead — a fullscreen video would take the Escape
      // as its own and leave fullscreen. Swallow the keydown and wait.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!ctrl) return;

      // Ctrl+1..9 jumps straight to a note, the way every tabbed app does.
      // Cycling is fine for two or three notes and tedious past that.
      if (e.key >= "1" && e.key <= "9" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        h.jump(Number(e.key) - 1);
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          h.next();
          break;
        case "ArrowUp":
          e.preventDefault();
          h.prev();
          break;
        case "n":
        case "N":
          e.preventDefault();
          h.create();
          break;
        case "h":
        case "H":
          // Handled on keyup for the same reason as Escape.
          e.preventDefault();
          break;
        case "d":
        case "D":
          // Shift-qualified: Ctrl+D alone is too close to Ctrl+S/Ctrl+F to
          // risk on an action with no undo.
          if (!e.shiftKey) break;
          e.preventDefault();
          h.remove();
          break;
        case "t":
        case "T":
          e.preventDefault();
          h.toggleSwitcher();
          break;
        case ",":
          e.preventDefault();
          h.toggleSettings();
          break;
        case "=":
        case "+":
          e.preventDefault();
          h.bumpText(0.5);
          break;
        case "-":
          e.preventDefault();
          h.bumpText(-0.5);
          break;
      }
    };
    // Both of these give focus away, so both must wait for keyup — releasing
    // the key after focus has moved delivers the keyup to the other app.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        h.backFocus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        e.stopPropagation();
        h.hide();
      }
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [h]);
}
