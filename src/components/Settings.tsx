import type { ReactNode } from "react";
import { MIN_GLASS_ALPHA, type Settings as S } from "../hooks/useSettings";

type Props = {
  settings: S;
  onChange: (patch: Partial<S>) => void;
  children?: ReactNode;
};

/** A popover, never a screen. Sliders, then the one thing that needs typing. */
export function Settings({ settings, onChange, children }: Props) {
  return (
    <div
      className="settings"
      onMouseDown={(e) => {
        // Clicking the panel normally must not pull the caret out of the
        // editor — but the sign-in fields are useless if they cannot take it,
        // so those are the exception.
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT" || el.tagName === "BUTTON") return;
        e.preventDefault();
      }}
    >
      <label>
        Opacity
        <input
          type="range"
          min={MIN_GLASS_ALPHA}
          max={0.95}
          step={0.01}
          value={settings.glassAlpha}
          onChange={(e) => onChange({ glassAlpha: Number(e.target.value) })}
        />
      </label>
      <label>
        Title size
        <input
          type="range"
          min={16}
          max={40}
          step={1}
          value={settings.titleSize}
          onChange={(e) => onChange({ titleSize: Number(e.target.value) })}
        />
      </label>
      <label>
        Text size
        <input
          type="range"
          min={11}
          max={22}
          step={0.5}
          value={settings.bodySize}
          onChange={(e) => onChange({ bodySize: Number(e.target.value) })}
        />
      </label>
      {children}
    </div>
  );
}
