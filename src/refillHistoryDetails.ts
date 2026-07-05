export interface RefillHistoryDetailEntry {
  message?: string;
  error?: string;
  samples?: string[];
}

export function refillHistoryDetailLines(entry: RefillHistoryDetailEntry): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  add(entry.message);
  add(entry.error);
  for (const sample of entry.samples || []) add(sample);
  return lines;
}

export function refillHistoryPreviewText(entry: RefillHistoryDetailEntry, maxLength = 140): string {
  const text = refillHistoryDetailLines(entry)[0] || "-";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}
