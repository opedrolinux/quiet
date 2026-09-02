import type { Note } from "../lib/db";
import { deriveTitle } from "../lib/title";
import { SWITCHER_W } from "../lib/window";

type Props = {
  notes: Note[];
  activeId: number | null;
  onSelect: (id: number) => void;
};

export function Switcher({ notes, activeId, onSelect }: Props) {
  return (
    // Fixed-width inner content. The outer element's width animates, and this
    // clips rather than re-wrapping, so the titles do not reflow on the way in.
    <div className="switcher">
      <div className="switcher-brand" style={{ width: SWITCHER_W }}>
        Quiet
      </div>
      <div className="switcher-track" style={{ width: SWITCHER_W }}>
        {notes.map((n, i) => (
          <div
            key={n.id}
            className={"switcher-item" + (n.id === activeId ? " active" : "")}
            title={deriveTitle(n.body)}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the caret in the editor
              onSelect(n.id);
            }}
          >
            {/* Ctrl+1..9 only reaches the first nine, so past that the column
                goes blank rather than advertising a key that does nothing. */}
            <span className="switcher-num">{i < 9 ? i + 1 : ""}</span>
            <span className="switcher-label">{deriveTitle(n.body)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
