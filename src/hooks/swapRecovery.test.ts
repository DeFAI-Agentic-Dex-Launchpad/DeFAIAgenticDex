import { describe, expect, it } from 'vitest'
import {
  normalizeSwapError,
  recoveryLabel,
} from './swapRecovery'

describe('normalizeSwapError', () => {
  it('classifies wallet rejection as recoverable wallet guidance', () => {
    const result = normalizeSwapError('base', new Error('User rejected the request'))

    expect(result).toMatchObject({
      code: 'USER_REJECTED',
      recoverable: true,
      action: 'check_wallet',
    })
  })

  it('classifies Solana balance errors with chain-specific guidance', () => {
    const result = normalizeSwapError('solana', 'insufficient lamports for fee')

    expect(result).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'The wallet needs more SOL to complete this swap.',
      action: 'check_wallet',
    })
  })

  it('requires a fresh quote after expiry or stale block data', () => {
    const result = normalizeSwapError('base', 'transaction block height exceeded')

    expect(result).toMatchObject({
      code: 'TRANSACTION_EXPIRED',
      recoverable: true,
      action: 'refresh_quote',
    })
  })

  it('allows safe polling retry for transient provider failures', () => {
    const result = normalizeSwapError('base', 'RPC request timed out')

    expect(result).toMatchObject({
      code: 'RPC_OR_NETWORK_ERROR',
      recoverable: true,
      action: 'retry_polling',
    })
  })

  it('classifies HTTP 429 rate limiting as safely retryable', () => {
    const result = normalizeSwapError(
      'base',
      '429 Too Many Requests: RPC rate limit exceeded',
    )

    expect(result).toMatchObject({
      code: 'RPC_OR_NETWORK_ERROR',
      recoverable: true,
      action: 'retry_polling',
    })
  })

  it('marks unknown onchain failures for inspection instead of replay', () => {
    const result = normalizeSwapError('base', { reason: 'execution reverted' })

    expect(result).toMatchObject({
      code: 'TRANSACTION_FAILED',
      recoverable: false,
      action: 'inspect_transaction',
    })
  })
})

describe('recoveryLabel', () => {
  it('returns user-facing labels for recovery actions', () => {
    expect(recoveryLabel('refresh_quote')).toBe('Refresh quote')
    expect(recoveryLabel('retry_polling')).toBe('Retry status check')
    expect(recoveryLabel('inspect_transaction')).toBe('Inspect transaction')
  })
})
