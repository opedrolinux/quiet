import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "../lib/db";

export type Settings = {
  glassAlpha: number;
  titleSize: number;
  bodySize: number;
};

/**
 * The opacity floor is not arbitrary. Every mockup round that pushed the glass
 * below roughly this value washed the text out over a bright video (see
 * design/). Letting the slider reach zero would let you make your own notes
 * unreadable, so it stops here.
 */
export const MIN_GLASS_ALPHA = 0.45;

const DEFAULTS: Settings = { glassAlpha: 0.72, titleSize: 26, bodySize: 13.5 };

function apply(s: Settings) {
  const r = document.documentElement.style;
  r.setProperty("--glass-alpha", String(s.glassAlpha));
  r.setProperty("--title-size", s.titleSize + "px");
  r.setProperty("--body-size", s.bodySize + "px");
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    (async () => {
      const raw = await getSetting("ui");
      const loaded = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
      loaded.glassAlpha = Math.max(MIN_GLASS_ALPHA, loaded.glassAlpha);
      setSettings(loaded);
      apply(loaded);
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      next.glassAlpha = Math.max(MIN_GLASS_ALPHA, next.glassAlpha);
      apply(next);
      void setSetting("ui", JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, update };
}
