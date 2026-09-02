/**
 * The first non-empty line of a note IS its title.
 *
 * There is no title column in the database and no title field in the UI, so
 * this is the single place that decides what a note is called. Both the editor
 * decoration and the switcher list call it, which is why it lives alone here:
 * if they disagreed, the big text at the top of a note and its name in the list
 * would drift apart.
 */
export function deriveTitle(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "Untitled";
}
