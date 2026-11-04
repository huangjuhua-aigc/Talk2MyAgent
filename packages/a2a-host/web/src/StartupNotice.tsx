import { useEffect, useState } from 'react'
import { api } from './api.ts'

/** The start request stays open while preparing; status polling shows real progress. */
export function StartupNotice({ agentId }: { agentId: string }): React.JSX.Element {
  const [message, setMessage] = useState('正在准备启动环境…')
  useEffect(() => {
    let active = true
    const poll = () => { void api.status(agentId).then(status => {
      if (active && status.preparation) setMessage(status.preparation.message)
    }).catch(() => { /* The start request reports any terminal failure. */ }) }
    poll()
    const timer = setInterval(poll, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [agentId])
  return <p role="status" aria-label="启动进度" aria-live="polite" className="field-note">{message}</p>
}
