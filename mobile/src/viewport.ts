/**
 * Keep the app as tall as the part of the screen you can actually see.
 *
 * iOS does not resize a standalone web app when the keyboard opens. The window
 * stays its full height and the keys are drawn on top of it, so a layout built
 * on `height: 100%` runs the note down behind them — including, almost always,
 * the line the caret is on. Nothing is broken exactly; you simply cannot see
 * what you are typing, which for a notes app is the same thing.
 *
 * `visualViewport` is the only thing on iOS that reports the height actually
 * left over, so the layout is driven from it rather than from `100%`. It is
 * published once, as `--app-h`, and the stylesheet decides what to do with it.
 *
 * The body is pinned in styles.css so the document itself can never scroll.
 * That is what keeps this to one variable: when the page *can* scroll, iOS
 * scrolls it to reveal the focused field, which takes the header off the top of
 * the screen and leaves the visual viewport sitting partway down the document.
 * With scrolling refused there is nothing to correct and the height is the
 * whole story.
 */
export function trackViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  const apply = () => {
    // No visualViewport (very old WebViews) means no keyboard inset either —
    // innerHeight is then already the honest answer.
    const height = vv ? vv.height : window.innerHeight;
    root.style.setProperty("--app-h", `${Math.round(height)}px`);
  };

  apply();

  if (vv) {
    // Both fire repeatedly while the keyboard animates. That is wanted: the
    // app should shrink with the keys rather than jump once they land.
    vv.addEventListener("resize", apply);
    // The keyboard can shift the visual viewport without resizing it, and a
    // shift we ignore leaves the app measured against the wrong height.
    vv.addEventListener("scroll", apply);
  }

  // Rotating still reports the old height at the moment the event fires, so
  // this one has to be asked twice.
  window.addEventListener("orientationchange", () => {
    apply();
    window.setTimeout(apply, 300);
  });
}
