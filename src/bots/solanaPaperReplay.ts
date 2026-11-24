import type { PreparedSniperOrder } from './solanaSniperExecution'

export type PaperMarketTick = {
  timestampMs: number
  mint: string
  midPriceUsd: number
  availableLiquidityUsd: number
  feeBps: number
}

export type PaperReplayOrder = {
  order: PreparedSniperOrder
  submittedAtMs: number
}

export type PaperFill = {
  orderId: string
  mint: string
  submittedAtMs: number
  filledAtMs: number
  inputAmountUsd: number
  feeUsd: number
  executionPriceUsd: number
  tokenQuantity: number
}

export type PaperReplayRejection = {
  orderId: string
  code:
    | 'NO_MARKET_TICK'
    | 'INSUFFICIENT_LIQUIDITY'
    | 'INSUFFICIENT_CASH'
    | 'INVALID_MARKET_DATA'
  detail: string
}

export type PaperReplayResult = {
  startingCashUsd: number
  endingCashUsd: number
  totalFeesUsd: number
  fills: readonly PaperFill[]
  rejections: readonly PaperReplayRejection[]
}

/**
 * Replays prepared orders against an ordered market-tick fixture. It is
 * deterministic and side-effect free: no RPC, wallet, signing, or submission.
 */
export class SolanaPaperReplay {
  run(
    orders: readonly PaperReplayOrder[],
    ticks: readonly PaperMarketTick[],
    startingCashUsd: number,
  ): PaperReplayResult {
    let cash = startingCashUsd
    let totalFeesUsd = 0
    const fills: PaperFill[] = []
    const rejections: PaperReplayRejection[] = []
    const orderedTicks = [...ticks].sort((a, b) => a.timestampMs - b.timestampMs)
    const orderedOrders = [...orders].sort((a, b) => a.submittedAtMs - b.submittedAtMs)

    for (const item of orderedOrders) {
      const order = item.order
      const tick = orderedTicks.find(
        (candidate) =>
          candidate.mint === order.outputMint &&
          candidate.timestampMs >= item.submittedAtMs,
      )

      if (!tick) {
        rejections.push({
          orderId: order.orderId,
          code: 'NO_MARKET_TICK',
          detail: 'No market tick exists at or after the paper submission time.',
        })
        continue
      }

      if (
        !Number.isFinite(tick.midPriceUsd) ||
        tick.midPriceUsd <= 0 ||
        !Number.isFinite(tick.feeBps) ||
        tick.feeBps < 0
      ) {
        rejections.push({
          orderId: order.orderId,
          code: 'INVALID_MARKET_DATA',
          detail: 'Market price and fee data must be finite and non-negative.',
        })
        continue
      }

      if (tick.availableLiquidityUsd < order.inputAmountUsd) {
        rejections.push({
          orderId: order.orderId,
          code: 'INSUFFICIENT_LIQUIDITY',
          detail: 'Available paper liquidity is below the requested order size.',
        })
        continue
      }

      const feeUsd = order.inputAmountUsd * (tick.feeBps / 10_000)
      const totalCostUsd = order.inputAmountUsd + feeUsd
      if (cash < totalCostUsd) {
        rejections.push({
          orderId: order.orderId,
          code: 'INSUFFICIENT_CASH',
          detail: 'Paper cash balance cannot cover order size plus fees.',
        })
        continue
      }

      const executionPriceUsd = tick.midPriceUsd * (1 + order.slippageBps / 10_000)
      const tokenQuantity = order.inputAmountUsd / executionPriceUsd
      cash -= totalCostUsd
      totalFeesUsd += feeUsd
      fills.push({
        orderId: order.orderId,
        mint: order.outputMint,
        submittedAtMs: item.submittedAtMs,
        filledAtMs: tick.timestampMs,
        inputAmountUsd: order.inputAmountUsd,
        feeUsd,
        executionPriceUsd,
        tokenQuantity,
      })
    }

    return {
      startingCashUsd: startingCashUsd,
      endingCashUsd: cash,
      totalFeesUsd,
      fills,
      rejections,
    }
  }
}
