import { describe, expect, it } from 'vitest'
import type { SolanaRiskDecision } from './solanaRiskFilters'
import {
  DEFAULT_SOLANA_SNIPER_POLICY,
  SolanaSniperExecutionPipeline,
  type SolanaJupiterQuote,
} from './solanaSniperExecution'

const approvedRisk: SolanaRiskDecision = {
  approved: true,
  checks: [],
  rejectionCodes: [],
}

const rejectedRisk: SolanaRiskDecision = {
  approved: false,
  checks: [],
  rejectionCodes: ['LIQUIDITY_TOO_LOW'],
}

function quote(overrides: Partial<SolanaJupiterQuote> = {}): SolanaJupiterQuote {
  return {
    quoteId: 'quote-1',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'TokenMint11111111111111111111111111111111111',
    inputAmount: 100_000_000n,
    expectedOutputAmount: 1_000_000n,
    slippageBps: 75,
    priceImpactPct: 1.2,
    transactionBase64: 'base64-versioned-transaction',
    lastValidBlockHeight: 500,
    fetchedAtMs: 1_000,
    prioritizationFeeLamports: 50_000,
    ...overrides,
  }
}

describe('SolanaSniperExecutionPipeline', () => {
  it('prepares a bounded paper-mode transaction for an approved token', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const result = pipeline.prepare({
      orderId: 'order-1',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: quote().outputMint, riskDecision: approvedRisk },
      quote: quote(),
      nowMs: 5_000,
    })

    expect(result).toEqual({
      accepted: true,
      order: expect.objectContaining({
        orderId: 'order-1',
        mode: 'paper-only',
        status: 'paper_ready',
        transactionBase64: 'base64-versioned-transaction',
        lastValidBlockHeight: 500,
      }),
    })
  })

  it('rejects tokens whose risk decision is not approved', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const result = pipeline.prepare({
      orderId: 'order-risk',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: quote().outputMint, riskDecision: rejectedRisk },
      quote: quote(),
      nowMs: 5_000,
    })

    expect(result).toMatchObject({
      accepted: false,
      code: 'RISK_NOT_APPROVED',
    })
  })

  it('rejects stale quotes and never builds a stale transaction', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const result = pipeline.prepare({
      orderId: 'order-stale',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: quote().outputMint, riskDecision: approvedRisk },
      quote: quote(),
      nowMs: DEFAULT_SOLANA_SNIPER_POLICY.quoteMaxAgeMs + 1_001,
    })

    expect(result).toEqual({
      accepted: false,
      code: 'QUOTE_EXPIRED',
      detail: expect.stringContaining('fresh quote'),
    })
  })

  it('rejects oversized, high-impact, and high-fee quotes', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const baseRequest = {
      orderId: 'order-limits',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: quote().outputMint, riskDecision: approvedRisk },
      nowMs: 1_500,
    }

    expect(
      pipeline.prepare({
        ...baseRequest,
        inputAmountUsd: 101,
        quote: quote(),
      }),
    ).toMatchObject({ accepted: false, code: 'ORDER_LIMIT_EXCEEDED' })

    expect(
      pipeline.prepare({
        ...baseRequest,
        orderId: 'order-impact',
        quote: quote({ priceImpactPct: 7 }),
      }),
    ).toMatchObject({ accepted: false, code: 'PRICE_IMPACT_TOO_HIGH' })

    expect(
      pipeline.prepare({
        ...baseRequest,
        orderId: 'order-fee',
        quote: quote({ prioritizationFeeLamports: 2_000_001 }),
      }),
    ).toMatchObject({ accepted: false, code: 'PRIORITY_FEE_TOO_HIGH' })
  })

  it('rejects duplicate order ids and live mode', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const request = {
      orderId: 'order-duplicate',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: quote().outputMint, riskDecision: approvedRisk },
      quote: quote(),
      nowMs: 1_500,
    }

    expect(pipeline.prepare(request)).toMatchObject({ accepted: true })
    expect(pipeline.prepare(request)).toMatchObject({
      accepted: false,
      code: 'DUPLICATE_ORDER',
    })

    const livePipeline = new SolanaSniperExecutionPipeline({
      ...DEFAULT_SOLANA_SNIPER_POLICY,
      mode: 'live',
    })
    expect(livePipeline.prepare({ ...request, orderId: 'order-live' })).toMatchObject({
      accepted: false,
      code: 'LIVE_EXECUTION_DISABLED',
    })
  })

  it('rejects a quote for a different output mint', () => {
    const pipeline = new SolanaSniperExecutionPipeline()
    const result = pipeline.prepare({
      orderId: 'order-mismatch',
      walletPublicKey: 'wallet-1',
      inputAmountUsd: 25,
      token: { mint: 'ApprovedMint11111111111111111111111111111111', riskDecision: approvedRisk },
      quote: quote(),
      nowMs: 1_500,
    })

    expect(result).toMatchObject({
      accepted: false,
      code: 'MINT_MISMATCH',
    })
  })
})
