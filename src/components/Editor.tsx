import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

/**
 * Styles line 1 as the note's title.
 *
 * This single decoration is the reason the app uses CodeMirror rather than a
 * plain <textarea>: a textarea cannot render one line differently from the
 * rest, and an overlay faked on top of one never keeps the caret aligned.
 */
const titleLine = Decoration.line({ class: "cm-title" });

const titleDecoration = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const first = view.state.doc.line(1);
      return Decoration.set([titleLine.range(first.from)]);
    }
  },
  { decorations: (v) => v.decorations },
);

type Props = {
  noteId: string | null;
  body: string;
  onChange: (body: string) => void;
};

export function Editor({ noteId, body, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Built once. Note content is pushed in by the effect below rather than by
  // recreating the view, so undo history survives and the caret stays put.
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          titleDecoration,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // Replace the document only when the active note actually changes. Doing it
  // on every body change would fight the user's own typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.state.doc.toString() === body) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: body },
      selection: { anchor: Math.min(body.length, v.state.doc.length) },
    });
    v.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  return <div className="editor" ref={host} />;
}

/** Used by the global hotkeys to put the caret back after summoning. */
export function focusEditor() {
  const cm = document.querySelector<HTMLElement>(".cm-content");
  cm?.focus();
}
