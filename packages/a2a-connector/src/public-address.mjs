/** Prefer aliases actually confirmed by Relay, including registrations made before phone input existed. */
export function preferContactAddress(info, origin = info?.relayOrigin) {
  if (!info || typeof origin !== 'string' || !/^1[3-9]\d{9}$/.test(info.contactId ?? '') ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(info.publicationId ?? '')) return info
  const contact = `${origin}/r/${info.contactId}`, legacy = `${origin}/r/${info.publicationId}`
  if (info.contactRpcUrl !== `${contact}/a2a` || info.contactCardUrl !== `${contact}/.well-known/agent-card.json`) return info
  const matches = base => info.publicRpcUrl === `${base}/a2a` && info.publicCardUrl === `${base}/.well-known/agent-card.json`
  if (matches(contact) || !matches(legacy)) return info
  return { ...info, publicRpcUrl: info.contactRpcUrl, publicCardUrl: info.contactCardUrl }
}
