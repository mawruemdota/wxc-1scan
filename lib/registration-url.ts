/**
 * Accept an administrator-configured public registration destination only.
 * Empty string intentionally disables the registration CTA.
 */
export function normalizeRegistrationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (input === '') return '';
  if (input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
