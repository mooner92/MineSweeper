/** Quote a CSV field when it contains a comma, quote, or newline. */
export function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
