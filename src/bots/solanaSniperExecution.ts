import type { SolanaRiskDecision } from './solanaRiskFilters'

export type SniperExecutionMode = 'paper-only' | 'wallet-handoff' | 'live'

export type SolanaJupiterQuote = {
  quoteId: string
  inputMint: string
  outputMint: string
  /** Raw integer amount in the input token's smallest unit. */
  inputAmount: bigint
  /** Raw integer amount in the output token's smallest unit. */
  expectedOutputAmount: bigint
  slippageBps: number
  priceImpactPct: number
  /** Base64 VersionedTransaction returned by Jupiter, if already built. */
  transactionBase64?: string
  lastValidBlockHeight: number
  fetchedAtMs: number
  prioritizationFeeLamports?: number
}

export type ApprovedSolanaToken = {
  mint: string
  riskDecision: SolanaRiskDecision
}

export type SolanaSniperPolicy = {
  mode: SniperExecutionMode
  maxOrderUsd: number
  maxSlippageBps: number
  maxPriceImpactPct: number
  maxPriorityFeeLamports: number
  quoteMaxAgeMs: number
  requireRiskApproval: boolean
}

export const DEFAULT_SOLANA_SNIPER_POLICY: SolanaSniperPolicy = {
  mode: 'paper-only',
  maxOrderUsd: 100,
  maxSlippageBps: 100,
  maxPriceImpactPct: 5,
  maxPriorityFeeLamports: 2_000_000,
  quoteMaxAgeMs: 10_000,
  requireRiskApproval: true,
}

export type SniperRejectionCode =
  | 'RISK_NOT_APPROVED'
  | 'MINT_MISMATCH'
  | 'INVALID_ORDER_SIZE'
  | 'ORDER_LIMIT_EXCEEDED'
  | 'QUOTE_EXPIRED'
  | 'SLIPPAGE_LIMIT_EXCEEDED'
  | 'PRICE_IMPACT_TOO_HIGH'
  | 'PRIORITY_FEE_TOO_HIGH'
  | 'QUOTE_MISSING_TRANSACTION'
  | 'LIVE_EXECUTION_DISABLED'
  | 'DUPLICATE_ORDER'

export type SniperOrderRequest = {
  orderId: string
  walletPublicKey: string
  inputAmountUsd: number
  token: ApprovedSolanaToken
  quote: SolanaJupiterQuote
  policy?: SolanaSniperPolicy
  nowMs?: number
}

export type PreparedSniperOrder = {
  orderId: string
  mode: SniperExecutionMode
  walletPublicKey: string
  inputMint: string
  outputMint: string
  inputAmount: bigint
  expectedOutputAmount: bigint
  slippageBps: number
  priceImpactPct: number
  lastValidBlockHeight: number
  quoteId: string
  transactionBase64: string
  status: 'paper_ready' | 'wallet_handoff_ready'
}

export type SniperOrderResult =
  | { accepted: true; order: PreparedSniperOrder }
  | { accepted: false; code: SniperRejectionCode; detail: string }

/**
 * Builds a bounded Jupiter transaction handoff. This module never signs,
 * stores keys, calls sendRawTransaction, or enables live execution by itself.
 */
export class SolanaSniperExecutionPipeline {
  private readonly seenOrderIds = new Set<string>()
  private readonly defaultPolicy: SolanaSniperPolicy

  constructor(policy: SolanaSniperPolicy = DEFAULT_SOLANA_SNIPER_POLICY) {
    this.defaultPolicy = policy
  }

  prepare(request: SniperOrderRequest): SniperOrderResult {
    const policy = request.policy ?? this.defaultPolicy
    const nowMs = request.nowMs ?? Date.now()
    const { token, quote } = request

    if (this.seenOrderIds.has(request.orderId)) {
      return reject('DUPLICATE_ORDER', 'This order id has already been prepared.')
    }

    if (policy.requireRiskApproval && !token.riskDecision.approved) {
      return reject(
        'RISK_NOT_APPROVED',
        `Token risk gates failed: ${token.riskDecision.rejectionCodes.join(', ') || 'unknown reason'}.`,
      )
    }

    if (quote.outputMint !== token.mint) {
      return reject('MINT_MISMATCH', 'The quote output mint does not match the approved token.')
    }

    if (!Number.isFinite(request.inputAmountUsd) || request.inputAmountUsd <= 0) {
      return reject('INVALID_ORDER_SIZE', 'Order size must be a positive finite USD amount.')
    }

    if (request.inputAmountUsd > policy.maxOrderUsd) {
      return reject(
        'ORDER_LIMIT_EXCEEDED',
        `Order size exceeds the $${policy.maxOrderUsd.toFixed(2)} policy limit.`,
      )
    }

    if (nowMs - quote.fetchedAtMs > policy.quoteMaxAgeMs) {
      return reject('QUOTE_EXPIRED', 'Quote is stale; request a fresh quote before retrying.')
    }

    if (
      !Number.isInteger(quote.slippageBps) ||
      quote.slippageBps < 0 ||
      quote.slippageBps > policy.maxSlippageBps
    ) {
      return reject('SLIPPAGE_LIMIT_EXCEEDED', 'Quote slippage exceeds the configured policy.')
    }

    if (
      !Number.isFinite(quote.priceImpactPct) ||
      quote.priceImpactPct > policy.maxPriceImpactPct
    ) {
      return reject('PRICE_IMPACT_TOO_HIGH', 'Quote price impact exceeds the configured policy.')
    }

    if (
      quote.prioritizationFeeLamports !== undefined &&
      quote.prioritizationFeeLamports > policy.maxPriorityFeeLamports
    ) {
      return reject('PRIORITY_FEE_TOO_HIGH', 'Quote priority fee exceeds the configured policy.')
    }

    if (!quote.transactionBase64) {
      return reject(
        'QUOTE_MISSING_TRANSACTION',
        'Jupiter quote has no transaction payload for the wallet handoff.',
      )
    }

    if (policy.mode === 'live') {
      return reject(
        'LIVE_EXECUTION_DISABLED',
        'Live execution is disabled in this non-custodial pipeline. Use an explicit wallet handoff.',
      )
    }

    this.seenOrderIds.add(request.orderId)
    return {
      accepted: true,
      order: {
        orderId: request.orderId,
        mode: policy.mode,
        walletPublicKey: request.walletPublicKey,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inputAmount: quote.inputAmount,
        expectedOutputAmount: quote.expectedOutputAmount,
        slippageBps: quote.slippageBps,
        priceImpactPct: quote.priceImpactPct,
        lastValidBlockHeight: quote.lastValidBlockHeight,
        quoteId: quote.quoteId,
        transactionBase64: quote.transactionBase64,
        status: policy.mode === 'paper-only' ? 'paper_ready' : 'wallet_handoff_ready',
      },
    }
  }

  resetOrder(orderId?: string) {
    if (orderId) this.seenOrderIds.delete(orderId)
    else this.seenOrderIds.clear()
  }
}

function reject(
  code: SniperRejectionCode,
  detail: string,
): { accepted: false; code: SniperRejectionCode; detail: string } {
  return { accepted: false, code, detail }
}
