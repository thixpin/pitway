import { getFooterForActiveMilestone } from '../core/milestones/footer.js';
import { loadState } from '../state/store.js';

export interface FooterOptions {
  // --json output never carries the footer (the human surface only).
  json?: boolean;
  // For commands that act on an explicit milestone id: write the footer only
  // when that id IS the active milestone -- never a footer describing a
  // different milestone than the one just acted on (M036/T002). loadState
  // is guarded the same way getFooterForActiveMilestone guards its own read:
  // a missing/malformed state.yaml never blocks the primary output, it just
  // means no footer.
  milestone?: string;
}

// B038: the one place a mutating CLI command appends the racing footer.
// Every rule the former 16 hand-repeated call sites carried lives here --
// never in --json, never when Core yields null (draft, no active milestone,
// unreadable state), and optionally only-when-this-milestone-is-active.
// The footer STRING itself (icons, percentage, next gate) still comes from
// Core's computeRacingFooter: resume and milestone-status embed it in their
// --json views, so Core must keep producing it for output to stay
// byte-identical -- this helper only decides whether to write it.
export function writeActiveMilestoneFooter(
  root: string,
  write: (line: string) => void,
  options: FooterOptions,
): void {
  if (options.json) return;
  if (options.milestone !== undefined) {
    let isActive = false;
    try {
      isActive = loadState(root).active_milestone === options.milestone;
    } catch {
      isActive = false;
    }
    if (!isActive) return;
  }
  const footer = getFooterForActiveMilestone(root);
  if (footer !== null) write(footer);
}
