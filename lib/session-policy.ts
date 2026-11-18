/** A rejected first-load request must never replace a winning tab's cookie. */
export function shouldPersistPlayerSession(result: { ok: boolean; reason: string }): boolean {
  return result.ok && (result.reason === 'locked' || result.reason === 'resumed');
}
