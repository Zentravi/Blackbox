/** Client-side file export helpers (Blob downloads). */

export function downloadTextFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next frame so Safari has time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}
