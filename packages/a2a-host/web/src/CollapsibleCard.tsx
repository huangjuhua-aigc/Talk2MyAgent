import { useId, useState, type ReactNode } from 'react'

/** Keep the content mounted so folding a card never discards an in-progress edit. */
export function CollapsibleCard(props: {
  label: string
  storageKey: string
  heading: ReactNode
  status?: ReactNode
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const contentId = useId()
  const preferenceKey = `talk2myagent:portal:card:${props.storageKey}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === 'collapsed' }
    catch { return false }
  })
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(preferenceKey, next ? 'collapsed' : 'expanded') }
    catch { /* Folding remains available when browser storage is disabled. */ }
  }

  return (
    <section className={`card collapsible-card ${props.className ?? ''}${collapsed ? ' is-collapsed' : ''}`} aria-label={props.label}>
      <header className="section-heading">
        <div className="collapse-heading">{props.heading}</div>
        <div className="section-actions">
          {props.status}
          <button type="button" className="quiet collapse-toggle" aria-label={`${collapsed ? '展开' : '收起'}${props.label}`}
            aria-expanded={!collapsed} aria-controls={contentId} onClick={toggle}>
            <svg className="collapse-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="m4 6 4 4 4-4" />
            </svg>
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </header>
      <div id={contentId} hidden={collapsed}>{props.children}</div>
    </section>
  )
}
