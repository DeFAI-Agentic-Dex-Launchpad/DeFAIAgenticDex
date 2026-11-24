import { describe, expect, it } from 'vitest'
import { SolanaTokenEventIngestor } from './solanaTokenIngestion'
import {
  DEFAULT_SOLANA_RISK_CONFIG,
  evaluateSolanaTokenRisk,
  type SolanaTokenRiskInput,
} from './solanaRiskFilters'

const mint = 'So11111111111111111111111111111111111111112'

function safeToken(overrides: Partial<SolanaTokenRiskInput> = {}): SolanaTokenRiskInput {
  return {
    mint,
    mintAuthority: 'revoked',
    freezeAuthority: 'revoked',
    liquidityUsd: 25_000,
    liquidityLocked: true,
    topHolderPct: 8,
    holderConcentrationPct: 24,
    tokenAgeSeconds: 60,
    simulation: 'pass',
    ...overrides,
  }
}

describe('SolanaTokenEventIngestor', () => {
  it('normalizes a liquidity event and deduplicates repeated signatures', () => {
    const ingestor = new SolanaTokenEventIngestor()
    const raw = {
      signature: 'signature-1',
      slot: 42,
      logs: ['amm: initialize_pool', `amm: mint=${mint}`],
      pool: 'pool-1',
      creator: 'creator-1',
      observedAtMs: 123,
    }

    const first = ingestor.ingest(raw)
    const second = ingestor.ingest(raw)

    expect(first).toEqual({
      accepted: true,
      event: {
        id: `signature-1:42:${mint}`,
        signature: 'signature-1',
        slot: 42,
        mint,
        pool: 'pool-1',
        creator: 'creator-1',
        kind: 'liquidity_added',
        source: 'solana_logs',
        observedAtMs: 123,
      },
    })
    expect(second).toEqual({ accepted: false, reason: 'duplicate' })
  })

  it('rejects unsupported logs and events without a mint', () => {
    const ingestor = new SolanaTokenEventIngestor()

    expect(
      ingestor.ingest({
        signature: 'unsupported',
        slot: 1,
        logs: ['system: transfer'],
      }),
    ).toEqual({ accepted: false, reason: 'unsupported' })

    expect(
      ingestor.ingest({
        signature: 'missing-mint',
        slot: 2,
        logs: ['amm: initialize_pool'],
      }),
    ).toEqual({ accepted: false, reason: 'missing_mint' })
  })
})

describe('evaluateSolanaTokenRisk', () => {
  it('approves a token only when every configured gate passes', () => {
    const decision = evaluateSolanaTokenRisk(safeToken())

    expect(decision.approved).toBe(true)
    expect(decision.rejectionCodes).toEqual([])
  })

  it('rejects unverified authorities, weak liquidity, and concentrated holders', () => {
    const decision = evaluateSolanaTokenRisk(
      safeToken({
        mintAuthority: 'unknown',
        freezeAuthority: 'present',
        liquidityUsd: 500,
        liquidityLocked: false,
        topHolderPct: 40,
        holderConcentrationPct: 60,
        simulation: 'unknown',
      }),
    )

    expect(decision.approved).toBe(false)
    expect(decision.rejectionCodes).toEqual(
      expect.arrayContaining([
        'MINT_AUTHORITY_UNKNOWN',
        'FREEZE_AUTHORITY_PRESENT',
        'LIQUIDITY_TOO_LOW',
        'LIQUIDITY_NOT_LOCKED',
        'TOP_HOLDER_TOO_CONCENTRATED',
        'HOLDERS_TOO_CONCENTRATED',
        'SIMULATION_UNKNOWN',
      ]),
    )
  })

  it('rejects denylisted and stale tokens even when liquidity is adequate', () => {
    const decision = evaluateSolanaTokenRisk(
      safeToken({
        isDenylisted: true,
        tokenAgeSeconds: DEFAULT_SOLANA_RISK_CONFIG.maxTokenAgeSeconds + 1,
      }),
    )

    expect(decision.approved).toBe(false)
    expect(decision.rejectionCodes).toEqual(
      expect.arrayContaining(['DENYLISTED', 'TOKEN_TOO_OLD']),
    )
  })

  it('fails closed when critical data is unavailable', () => {
    const decision = evaluateSolanaTokenRisk(
      safeToken({
        liquidityUsd: null,
        liquidityLocked: null,
        topHolderPct: null,
        holderConcentrationPct: null,
        tokenAgeSeconds: null,
        simulation: 'unknown',
      }),
    )

    expect(decision.approved).toBe(false)
    expect(decision.rejectionCodes).toEqual(
      expect.arrayContaining([
        'LIQUIDITY_MISSING',
        'LIQUIDITY_NOT_LOCKED',
        'TOP_HOLDER_DATA_MISSING',
        'HOLDER_DATA_MISSING',
        'TOKEN_AGE_UNKNOWN',
        'SIMULATION_UNKNOWN',
      ]),
    )
  })
})
