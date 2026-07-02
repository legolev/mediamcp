const KEY_PATTERNS: RegExp[] = [
  /sk-or-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
];

/**
 * Strip anything that looks like an API key from text destined for logs,
 * error messages, or tool results. Known secret values are removed first,
 * then common key shapes.
 */
export function redactSecrets(text: string, knownSecrets: Array<string | null | undefined> = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join("[redacted]");
    }
  }
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

/** Show only the last 4 characters of a key, e.g. "sk-or-v1-…3f2a". */
export function maskKey(key: string): string {
  if (key.length <= 8) return "…" + key.slice(-2);
  const prefix = key.slice(0, key.indexOf("-") + 1 || 3);
  return `${prefix}…${key.slice(-4)}`;
}
