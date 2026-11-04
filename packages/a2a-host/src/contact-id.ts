/** Public mobile-format IDs become authoritative only after Relay confirms registration. */
export const isContactId = (value: unknown): value is string => typeof value === 'string' && /^1[3-9]\d{9}$/.test(value)
