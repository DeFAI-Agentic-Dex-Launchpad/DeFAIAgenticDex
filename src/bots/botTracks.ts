export type BotTrackId =
  | 'solana-memecoin-sniper-bot'
  | 'trading-bot'

export type BotLifecycle = 'scaffold' | 'paper' | 'testnet' | 'production'
export type BotExecutionMode = 'disabled' | 'paper-only' | 'testnet-only' | 'live'

export type BotTrack = {
  id: BotTrackId
  title: string
  chain: 'solana' | 'multi-chain'
  lifecycle: BotLifecycle
  executionMode: BotExecutionMode
  description: string
  nextMilestones: readonly string[]
  safetyRequirements: readonly string[]
}

/**
 * The canonical project tracks. Both tracks intentionally start disabled so
 * adding a UI card cannot accidentally enable wallet signing or live orders.
 */
export const BOT_TRACKS: readonly BotTrack[] = [
  {
    id: 'solana-memecoin-sniper-bot',
    title: 'Solana Memecoin Sniper Bot',
    chain: 'solana',
    lifecycle: 'scaffold',
    executionMode: 'disabled',
    description:
      'A Solana-only event, liquidity, risk, and execution pipeline for newly listed tokens.',
    nextMilestones: [
      'Add websocket/stream ingestion with reconnect and deduplication.',
      'Add token, liquidity, mint-authority, freeze-authority, and holder-risk filters.',
      'Add a bounded Jupiter transaction builder and paper-only execution pipeline.',
      'Add bounded order sizing, slippage, priority-fee, and kill-switch controls.',
    ],
    safetyRequirements: [
      'No private keys or signing material on the backend.',
      'Paper mode remains the default until all risk gates pass.',
      'Every candidate order must have a quote, expiry, and receipt lifecycle.',
    ],
  },
  {
    id: 'trading-bot',
    title: 'Trading Bot',
    chain: 'multi-chain',
    lifecycle: 'scaffold',
    executionMode: 'disabled',
    description:
      'A strategy-neutral trading runtime for signals, portfolio state, risk limits, and execution adapters.',
    nextMilestones: [
      'Define a deterministic signal and portfolio event model.',
      'Add paper broker and replayable historical fixtures.',
      'Add per-trade, daily-loss, exposure, and circuit-breaker limits.',
      'Connect Solana Jupiter and Base 0x adapters only behind explicit approval.',
    ],
    safetyRequirements: [
      'No live execution from a strategy signal alone.',
      'Every order requires a risk decision and user-approved execution policy.',
      'Reconcile submitted, confirmed, reverted, and expired receipts before updating positions.',
    ],
  },
]

export function getBotTrack(id: BotTrackId): BotTrack {
  const track = BOT_TRACKS.find((candidate) => candidate.id === id)
  if (!track) throw new Error(`Unknown bot track: ${id}`)
  return track
}

export function canSubmitLiveOrder(track: BotTrack): boolean {
  return track.lifecycle === 'production' && track.executionMode === 'live'
}
