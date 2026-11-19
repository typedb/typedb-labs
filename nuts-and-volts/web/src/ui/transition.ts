// How the part panel and the TypeQL overlay change between selections, kept apart from React so tests can check it.

/** Below this width (phones) the TypeQL overlay starts as its one-line summary; everywhere else it starts open. */
export const TYPEQL_COLLAPSED_BELOW = 640;

export const typeqlStartsCollapsed = (width: number) => width < TYPEQL_COLLAPSED_BELOW;

export type PanelState = "pending" | "stale" | undefined;

/**
 * The part panels to render: the selected part, and, while its details load, the part still on screen.
 * The selected one is rendered hidden ("pending") and the shown one dimmed ("stale") until the selected one is
 * ready; a part selected and then replaced before it was ready is dropped.
 */
export function panelParts(selected: string | null, shown: string | null): { id: string; state: PanelState }[] {
  if (selected === null) return [];
  if (shown === null || shown === selected) return [{ id: selected, state: undefined }];
  return [{ id: shown, state: "stale" }, { id: selected, state: "pending" }];
}
