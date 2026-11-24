type RequestLike = {
  method?: string
  body?: unknown
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
}

const applicationId = 'app_411b1e8063492ce9eab1a3d5a7bcafec'

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const apiKey = process.env.CUSTOMDOMAIN_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'customdomain_not_configured' })
    return
  }

  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {}
  const endUserRef = typeof body.end_user_ref === 'string' ? body.end_user_ref.slice(0, 128) : undefined
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : undefined

  const tokenResponse = await fetch('https://app.customdomain.ai/api/widget-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      application_id: applicationId,
      ...(domain ? { domain } : {}),
      ...(endUserRef ? { end_user_ref: endUserRef } : {}),
    }),
  })

  const payload = await tokenResponse.json().catch(() => ({ error: 'invalid_customdomain_response' }))
  if (!tokenResponse.ok) {
    res.status(tokenResponse.status).json({ error: 'customdomain_token_failed', details: payload })
    return
  }

  res.status(200).json(payload)
}
