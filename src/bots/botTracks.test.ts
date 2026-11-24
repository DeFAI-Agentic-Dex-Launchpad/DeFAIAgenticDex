import { describe, expect, it } from 'vitest'
import {
  BOT_TRACKS,
  canSubmitLiveOrder,
  getBotTrack,
} from './botTracks'

describe('bot track registry', () => {
  it('defines both requested project tracks as disabled scaffolds', () => {
    expect(BOT_TRACKS.map((track) => track.id)).toEqual([
      'solana-memecoin-sniper-bot',
      'trading-bot',
    ])
    expect(BOT_TRACKS.every((track) => track.lifecycle === 'scaffold')).toBe(true)
    expect(BOT_TRACKS.every((track) => track.executionMode === 'disabled')).toBe(true)
  })

  it('returns the Solana sniper track with Solana-specific milestones', () => {
    const track = getBotTrack('solana-memecoin-sniper-bot')

    expect(track.chain).toBe('solana')
    expect(track.nextMilestones.join(' ')).toContain('Jupiter')
    expect(track.safetyRequirements.join(' ')).toContain('private keys')
  })

  it('returns the strategy-neutral multi-chain trading track', () => {
    const track = getBotTrack('trading-bot')

    expect(track.chain).toBe('multi-chain')
    expect(track.nextMilestones.join(' ')).toContain('paper')
    expect(track.safetyRequirements.join(' ')).toContain('risk decision')
  })

  it('never permits live orders from the initial scaffold', () => {
    expect(BOT_TRACKS.every((track) => !canSubmitLiveOrder(track))).toBe(true)
  })
})
