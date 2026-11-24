import { createHmac, timingSafeEqual } from 'node:crypto'

type RequestLike = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
}

type JwtClaims = {
  sub?: unknown
  exp?: unknown
  iss?: unknown
  aud?: unknown
}

const applicationId = 'app_411b1e8063492ce9eab1a3d5a7bcafec'

function base64UrlDecode(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4), 'base64').toString('utf8')
}

function getHeader(req: RequestLike, name: string) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function getBearerToken(req: RequestLike) {
  const authorization = getHeader(req, 'authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length).trim() || null
}

function verifySession(token: string, secret: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  let header: { alg?: unknown }
  let claims: JwtClaims
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader)) as { alg?: unknown }
    claims = JSON.parse(base64UrlDecode(encodedPayload)) as JwtClaims
  } catch {
    return null
  }

  if (header.alg !== 'HS256') return null
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest()
  const received = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encodedSignature.length % 4) % 4), 'base64')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null
  if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0 || claims.sub.length > 128) return null

  const issuer = process.env.DEFAI_AUTH_JWT_ISSUER
  if (issuer && claims.iss !== issuer) return null
  const audience = process.env.DEFAI_AUTH_JWT_AUDIENCE
  if (audience && claims.aud !== audience) return null

  return claims.sub.trim()
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const authSecret = process.env.DEFAI_AUTH_JWT_SECRET
  if (!authSecret) {
    res.status(500).json({ error: 'authentication_not_configured' })
    return
  }

  const sessionToken = getBearerToken(req)
  const userId = sessionToken ? verifySession(sessionToken, authSecret) : null
  if (!userId) {
    res.status(401).json({ error: 'authentication_required' })
    return
  }

  const apiKey = process.env.CUSTOMDOMAIN_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'customdomain_not_configured' })
    return
  }

  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {}
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
      end_user_ref: userId,
    }),
  })

  const payload = await tokenResponse.json().catch(() => ({ error: 'invalid_customdomain_response' }))
  if (!tokenResponse.ok) {
    res.status(tokenResponse.status).json({ error: 'customdomain_token_failed', details: payload })
    return
  }

  res.status(200).json(payload)
}
