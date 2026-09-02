import type { Note } from "../lib/db";
import { deriveTitle } from "../lib/title";

type Props = {
  notes: Note[];
  activeId: number | null;
  onSelect: (id: number) => void;
};

export function Switcher({ notes, activeId, onSelect }: Props) {
  return (
    <div className="switcher">
      {notes.map((n) => (
        <div
          key={n.id}
          className={"switcher-item" + (n.id === activeId ? " active" : "")}
          title={deriveTitle(n.body)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the caret in the editor
            onSelect(n.id);
          }}
        >
          {deriveTitle(n.body)}
        </div>
      ))}
    </div>
  );
}
