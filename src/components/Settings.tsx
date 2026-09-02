import { MIN_GLASS_ALPHA, type Settings as S } from "../hooks/useSettings";

type Props = {
  settings: S;
  onChange: (patch: Partial<S>) => void;
};

/** A popover, never a screen. Four controls is the whole surface. */
export function Settings({ settings, onChange }: Props) {
  return (
    <div className="settings" onMouseDown={(e) => e.preventDefault()}>
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
    </div>
  );
}
