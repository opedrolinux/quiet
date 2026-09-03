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

      /*
       * Punctuation is matched on the physical key, before anything else.
       *
       * e.key reports what the layout prints, which for , = and - is not the
       * same key everywhere: on a Brazilian ABNT2 keyboard Ctrl+, arrived here
       * as the text-size binding instead of settings, which locked the user
       * out of the only screen that can sign them in. e.code names the
       * physical key and does not move with the layout. ABNT2 also prints a
       * comma where a US numpad prints a decimal point, so that key counts as
       * a comma too.
       */
      switch (e.code) {
        case "Comma":
        case "NumpadComma":
        case "NumpadDecimal":
          e.preventDefault();
          h.toggleSettings();
          return;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          h.bumpText(0.5);
          return;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          h.bumpText(-0.5);
          return;
      }

      // Fallback for layouts that reach these characters from some other
      // physical key, e.g. with Shift or AltGr.
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
