export type SolanaTokenEventKind =
  | 'token_created'
  | 'liquidity_added'
  | 'liquidity_removed'
  | 'unknown'

export type RawSolanaLogEvent = {
  signature: string
  slot: number
  blockTime?: number | null
  logs: readonly string[]
  /** Preferred source: decoded adapter metadata from the observed instruction. */
  mint?: string
  pool?: string
  creator?: string
  eventKind?: SolanaTokenEventKind
  observedAtMs?: number
}

export type SolanaTokenEvent = {
  id: string
  signature: string
  slot: number
  blockTime?: number
  mint: string
  pool?: string
  creator?: string
  kind: Exclude<SolanaTokenEventKind, 'unknown'>
  source: 'solana_logs'
  observedAtMs: number
}

export type IngestResult =
  | { accepted: true; event: SolanaTokenEvent }
  | { accepted: false; reason: 'duplicate' | 'unsupported' | 'missing_mint' | 'invalid_event' }

const EVENT_PATTERNS: Array<{
  kind: Exclude<SolanaTokenEventKind, 'unknown'>
  patterns: readonly RegExp[]
}> = [
  {
    kind: 'liquidity_added',
    patterns: [/add[_ ]liquidity/i, /liquidity[_ ]added/i, /initialize[_ ]pool/i],
  },
  {
    kind: 'liquidity_removed',
    patterns: [/remove[_ ]liquidity/i, /liquidity[_ ]removed/i],
  },
  {
    kind: 'token_created',
    patterns: [/initialize[_ ]mint/i, /create[_ ]mint/i, /token[_ ]created/i],
  },
]

function inferKind(raw: RawSolanaLogEvent): SolanaTokenEventKind {
  if (raw.eventKind && raw.eventKind !== 'unknown') return raw.eventKind
  const logText = raw.logs.join('\n')
  return (
    EVENT_PATTERNS.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(logText)),
    )?.kind ?? 'unknown'
  )
}

function extractMint(raw: RawSolanaLogEvent): string | undefined {
  if (raw.mint?.trim()) return raw.mint.trim()

  const mintLog = raw.logs.find((log) => /mint\s*[:=]/i.test(log))
  const match = mintLog?.match(/mint\s*[:=]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i)
  return match?.[1]
}

export class SolanaTokenEventIngestor {
  private readonly seenSignatures = new Set<string>()
  private readonly maxSeenSignatures: number

  constructor(options: { maxSeenSignatures?: number } = {}) {
    this.maxSeenSignatures = options.maxSeenSignatures ?? 10_000
  }

  ingest(raw: RawSolanaLogEvent): IngestResult {
    if (
      !raw.signature ||
      !Number.isSafeInteger(raw.slot) ||
      raw.slot < 0 ||
      !Array.isArray(raw.logs)
    ) {
      return { accepted: false, reason: 'invalid_event' }
    }

    if (this.seenSignatures.has(raw.signature)) {
      return { accepted: false, reason: 'duplicate' }
    }

    const kind = inferKind(raw)
    if (kind === 'unknown') {
      return { accepted: false, reason: 'unsupported' }
    }

    const mint = extractMint(raw)
    if (!mint) return { accepted: false, reason: 'missing_mint' }

    this.remember(raw.signature)
    const observedAtMs = raw.observedAtMs ?? Date.now()
    const event: SolanaTokenEvent = {
      id: `${raw.signature}:${raw.slot}:${mint}`,
      signature: raw.signature,
      slot: raw.slot,
      ...(raw.blockTime === null || raw.blockTime === undefined
        ? {}
        : { blockTime: raw.blockTime }),
      mint,
      ...(raw.pool ? { pool: raw.pool } : {}),
      ...(raw.creator ? { creator: raw.creator } : {}),
      kind,
      source: 'solana_logs',
      observedAtMs,
    }

    return { accepted: true, event }
  }

  reset() {
    this.seenSignatures.clear()
  }

  private remember(signature: string) {
    this.seenSignatures.add(signature)
    if (this.seenSignatures.size > this.maxSeenSignatures) {
      const oldest = this.seenSignatures.values().next().value as string | undefined
      if (oldest) this.seenSignatures.delete(oldest)
    }
  }
}
