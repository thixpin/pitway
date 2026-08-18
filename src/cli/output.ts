export interface OutputOptions {
  json?: boolean;
}

// Every command renders through this: --json always produces valid JSON
// from the same data the human formatter uses, so the two never drift.
export function renderOutput<T>(
  data: T,
  options: OutputOptions,
  humanRenderer: (data: T) => string,
): string {
  if (options.json) {
    return JSON.stringify(data, null, 2);
  }
  return humanRenderer(data);
}
