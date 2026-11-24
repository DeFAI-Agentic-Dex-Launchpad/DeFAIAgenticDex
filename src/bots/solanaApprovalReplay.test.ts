import { describe, expect, it } from 'vitest'
import type { SolanaRiskDecision } from './solanaRiskFilters'
import { SolanaPaperReplay } from './solanaPaperReplay'
import { SolanaSniperExecutionPipeline, type SolanaJupiterQuote } from './solanaSniperExecution'
import { SolanaWalletApprovalManager } from './solanaWalletApproval'

const risk: SolanaRiskDecision = { approved: true, checks: [], rejectionCodes: [] }
const outputMint = 'TokenMint11111111111111111111111111111111111'

function quote(overrides: Partial<SolanaJupiterQuote> = {}): SolanaJupiterQuote {
  return {
    quoteId: 'quote-replay',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint,
    inputAmount: 100_000_000n,
    expectedOutputAmount: 1_000_000n,
    slippageBps: 50,
    priceImpactPct: 1,
    transactionBase64: 'paper-transaction',
    lastValidBlockHeight: 900,
    fetchedAtMs: 1_000,
    ...overrides,
  }
}

function prepared(orderId: string, amountUsd = 25) {
  const pipeline = new SolanaSniperExecutionPipeline()
  const result = pipeline.prepare({
    orderId,
    walletPublicKey: 'wallet-1',
    inputAmountUsd: amountUsd,
    token: { mint: outputMint, riskDecision: risk },
    quote: quote(),
    nowMs: 1_500,
  })
  if (!result.accepted) throw new Error(result.detail)
  return result.order
}

describe('SolanaWalletApprovalManager', () => {
  it('binds approval to the intended wallet and returns a handoff only after approval', () => {
    const manager = new SolanaWalletApprovalManager()
    const order = prepared('approval-order')

    const requested = manager.request(order, {
      approvalId: 'approval-1',
      nowMs: 2_000,
      ttlMs: 5_000,
    })
    expect(requested).toMatchObject({ ok: true, request: { status: 'requested' } })

    expect(manager.approve('approval-1', 'other-wallet', 2_100)).toMatchObject({
      ok: false,
      code: 'WALLET_MISMATCH',
    })

    const approved = manager.approve('approval-1', 'wallet-1', 2_100)
    expect(approved).toMatchObject({
      ok: true,
      request: {
        status: 'approved',
        transactionBase64: 'paper-transaction',
        walletPublicKey: 'wallet-1',
      },
    })
  })

  it('expires approval requests and never approves after expiry', () => {
    const manager = new SolanaWalletApprovalManager()
    const order = prepared('expired-approval')
    manager.request(order, { approvalId: 'approval-expired', nowMs: 100, ttlMs: 10 })

    expect(manager.approve('approval-expired', 'wallet-1', 110)).toMatchObject({
      ok: false,
      code: 'APPROVAL_EXPIRED',
    })
    expect(manager.get('approval-expired')?.status).toBe('expired')
  })

  it('supports rejection and revocation without touching transaction bytes', () => {
    const manager = new SolanaWalletApprovalManager()
    const order = prepared('revoke-order')
    manager.request(order, { approvalId: 'approval-revoke', nowMs: 100, ttlMs: 100 })
    expect(manager.reject('approval-revoke')).toMatchObject({
      ok: true,
      request: { status: 'rejected', transactionBase64: 'paper-transaction' },
    })

    manager.request(order, { approvalId: 'approval-revoke-2', nowMs: 100, ttlMs: 100 })
    manager.approve('approval-revoke-2', 'wallet-1', 101)
    expect(manager.revoke('approval-revoke-2')).toMatchObject({
      ok: true,
      request: { status: 'revoked', transactionBase64: 'paper-transaction' },
    })
  })
})

describe('SolanaPaperReplay', () => {
  it('replays orders deterministically and accounts for fee and slippage', () => {
    const replay = new SolanaPaperReplay()
    const order = prepared('paper-order')
    const result = replay.run(
      [{ order, submittedAtMs: 2_000 }],
      [
        {
          timestampMs: 2_100,
          mint: outputMint,
          midPriceUsd: 2,
          availableLiquidityUsd: 1_000,
          feeBps: 30,
        },
      ],
      100,
    )

    expect(result.fills).toHaveLength(1)
    expect(result.rejections).toHaveLength(0)
    expect(result.totalFeesUsd).toBeCloseTo(0.075)
    expect(result.endingCashUsd).toBeCloseTo(74.925)
    expect(result.fills[0]?.executionPriceUsd).toBeCloseTo(2.01)
  })

  it('replays negative market conditions without throwing or submitting', () => {
    const replay = new SolanaPaperReplay()
    const order = prepared('paper-negative', 90)
    const result = replay.run(
      [{ order, submittedAtMs: 2_000 }],
      [
        {
          timestampMs: 2_100,
          mint: outputMint,
          midPriceUsd: 2,
          availableLiquidityUsd: 10,
          feeBps: 30,
        },
      ],
      100,
    )

    expect(result.fills).toHaveLength(0)
    expect(result.rejections).toMatchObject([
      { orderId: 'paper-negative', code: 'INSUFFICIENT_LIQUIDITY' },
    ])
    expect(result.endingCashUsd).toBe(100)
  })

  it('rejects missing ticks and insufficient paper cash deterministically', () => {
    const replay = new SolanaPaperReplay()
    const order = prepared('paper-cash', 90)
    const result = replay.run(
      [
        { order, submittedAtMs: 2_000 },
        { order: { ...order, orderId: 'paper-missing' }, submittedAtMs: 9_000 },
      ],
      [
        {
          timestampMs: 2_100,
          mint: outputMint,
          midPriceUsd: 2,
          availableLiquidityUsd: 1_000,
          feeBps: 2_000,
        },
      ],
      100,
    )

    expect(result.fills).toHaveLength(0)
    expect(result.rejections).toEqual([
      expect.objectContaining({ orderId: 'paper-cash', code: 'INSUFFICIENT_CASH' }),
      expect.objectContaining({ orderId: 'paper-missing', code: 'NO_MARKET_TICK' }),
    ])
  })
})
