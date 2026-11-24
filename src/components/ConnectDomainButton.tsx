import { useMemo, useState } from 'react'
import { customdomain } from 'customdomain-js'

const applicationId = 'app_411b1e8063492ce9eab1a3d5a7bcafec'

type TokenResponse = {
  application_id: string
  token: string
}

function getCustomerRef() {
  const key = 'defai-customdomain-customer-ref'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing

  const generated = `customer_${crypto.randomUUID()}`
  window.localStorage.setItem(key, generated)
  return generated
}

export function ConnectDomainButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const customerRef = useMemo(() => getCustomerRef(), [])

  async function fetchToken(): Promise<TokenResponse> {
    const response = await fetch('/api/customdomain-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_user_ref: customerRef }),
    })

    if (!response.ok) throw new Error('The domain connection service is not configured yet.')
    return response.json() as Promise<TokenResponse>
  }

  async function openWidget() {
    setState('loading')
    setMessage('')

    try {
      const { application_id, token } = await fetchToken()
      customdomain.open({
        applicationId: application_id || applicationId,
        token,
        getToken: async () => (await fetchToken()).token,
        endUserRef: customerRef,
        onSuccess: ({ domain }: { domain: string }) => {
          setState('idle')
          setMessage(`${domain} is live.`)
        },
        onFallback: () => {
          setState('idle')
          setMessage('Manual DNS setup is available in the connection window.')
        },
        onClose: () => setState('idle'),
        onError: (error: { message?: string }) => {
          setState('error')
          setMessage(error.message || 'Could not connect the domain.')
        },
      })
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Could not connect the domain.')
    }
  }

  return (
    <span className="domain-control">
      <button className="secondary-button domain-button" onClick={openWidget} disabled={state === 'loading'}>
        {state === 'loading' ? 'Preparing…' : 'Connect domain'}
      </button>
      {message && <small className={state === 'error' ? 'domain-message error' : 'domain-message'}>{message}</small>}
    </span>
  )
}
