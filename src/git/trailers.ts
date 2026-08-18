import { git } from './exec.js';

// Closed, explicit set — never extended by pattern-matching. A human trailer
// (including a Co-Authored-By naming someone called "Claude") must never be
// stripped; only these exact keys and exact known AI addresses are removed.
const SESSION_TRAILER_KEYS = ['Claude-Session', 'Codex-Session', 'Gemini-Session'];
const KNOWN_AI_COAUTHOR_EMAILS = ['noreply@anthropic.com'];

const TRAILER_LINE = /^([A-Za-z0-9-]+):\s?(.*)$/;

function splitTrailerBlock(message: string): { body: string; trailerLines: string[] } {
  const trimmed = message.replace(/\n+$/, '');
  const paragraphs = trimmed.split(/\n\n+/);
  if (paragraphs.length < 2) return { body: trimmed, trailerLines: [] };
  const last = paragraphs[paragraphs.length - 1]!;
  const lines = last.split('\n');
  const isTrailerLine = (line: string): boolean => TRAILER_LINE.test(line);
  if (lines.every(isTrailerLine)) {
    return { body: paragraphs.slice(0, -1).join('\n\n'), trailerLines: lines };
  }
  return { body: trimmed, trailerLines: [] };
}

function isStrippedTrailer(line: string): boolean {
  const match = TRAILER_LINE.exec(line);
  if (!match) return false;
  const [, key, value] = match;
  if (SESSION_TRAILER_KEYS.includes(key!)) return true;
  if (key === 'Co-Authored-By') {
    const emailMatch = /<([^>]+)>/.exec(value!);
    const email = emailMatch?.[1]?.toLowerCase();
    if (email && KNOWN_AI_COAUTHOR_EMAILS.includes(email)) return true;
  }
  return false;
}

// Appends only the given PitWay trailers, stripping the closed set of
// provider/session metadata from any existing trailing trailer block.
// Every other trailer (including legitimate human Co-Authored-By lines) and
// all body prose is preserved verbatim.
export function composeMessage(message: string, trailers: Record<string, string>): string {
  const { body, trailerLines } = splitTrailerBlock(message);
  const kept = trailerLines.filter((line) => !isStrippedTrailer(line));
  const added = Object.entries(trailers).map(([key, value]) => `${key}: ${value}`);
  const allTrailers = [...kept, ...added];
  if (allTrailers.length === 0) return `${body}\n`;
  return `${body}\n\n${allTrailers.join('\n')}\n`;
}

export interface TrailerQuery {
  milestone: string;
  task?: string;
}

// Resolves a commit SHA by searching commit message trailers in git
// history. Nothing is read from or written to persisted state.
export function resolveCommitSha(cwd: string, query: TrailerQuery): string | undefined {
  const RECORD_SEP = '\x1e';
  const FIELD_SEP = '\x1f';
  const log = git(['log', `--format=%H${FIELD_SEP}%B${RECORD_SEP}`], cwd);
  const records = log.split(RECORD_SEP).filter((r) => r.trim().length > 0);

  for (const record of records) {
    const sepIndex = record.indexOf(FIELD_SEP);
    if (sepIndex === -1) continue;
    const sha = record.slice(0, sepIndex).trim();
    const body = record.slice(sepIndex + 1);
    const lines = body.split('\n');

    const hasMilestone = lines.some((l) => l.trim() === `PitWay-Milestone: ${query.milestone}`);
    if (!hasMilestone) continue;

    const hasTaskLine = lines.some((l) => /^PitWay-Task:\s?/.test(l.trim()));
    if (query.task) {
      const hasThisTask = lines.some((l) => l.trim() === `PitWay-Task: ${query.task}`);
      if (hasThisTask) return sha;
    } else if (!hasTaskLine) {
      return sha;
    }
  }
  return undefined;
}
