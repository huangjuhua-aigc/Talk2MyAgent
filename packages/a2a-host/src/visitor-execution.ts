export type VisitorExecution = 'microsandbox' | 'read-only'

/**
 * Visitor tool execution mode. Defaults to Microsandbox; hosts without working
 * nested virtualization may opt out with A2A_VISITOR_EXECUTION=read-only, which
 * drops VM isolation and leaves only the scoped read-only workspace boundary.
 */
export function visitorExecution(env: NodeJS.ProcessEnv = process.env): VisitorExecution {
  const value = env['A2A_VISITOR_EXECUTION']?.trim()
  if (!value || value === 'microsandbox') return 'microsandbox'
  if (value === 'read-only') return 'read-only'
  throw new Error(`Invalid A2A_VISITOR_EXECUTION: ${JSON.stringify(value)} (expected "microsandbox" or "read-only")`)
}
