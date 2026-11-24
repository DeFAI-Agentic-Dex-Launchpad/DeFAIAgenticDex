import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSwapReceiptPolling } from './useSwapReceiptPolling'

type SolanaConnectionDouble = {
  getSignatureStatuses: ReturnType<typeof vi.fn>
  getBlockHeight: ReturnType<typeof vi.fn>
}

type BaseClientDouble = {
  getTransactionReceipt: ReturnType<typeof vi.fn>
}

function solanaConnection(
  statuses: unknown[],
  blockHeight = 100,
): SolanaConnectionDouble {
  return {
    getSignatureStatuses: vi.fn().mockImplementation(async () => ({
      value: [statuses.shift() ?? null],
    })),
    getBlockHeight: vi.fn().mockResolvedValue(blockHeight),
  }
}

function baseClient(receipt: unknown): BaseClientDouble {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
  }
}

const successReceipt = {
  status: 'success',
  blockNumber: 1234n,
} as never

const revertedReceipt = {
  status: 'reverted',
  blockNumber: 1235n,
} as never

describe('useSwapReceiptPolling', () => {
  it('confirms a Solana signature after it becomes confirmed', async () => {
    const connection = solanaConnection([
      { confirmationStatus: 'processed', confirmations: 0n, slot: 10n, err: null },
      { confirmationStatus: 'confirmed', confirmations: 1n, slot: 11n, err: null },
    ])
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: connection as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'solana',
        signature: 'jupiter-signature',
        lastValidBlockHeight: 200,
      })
    })

    expect(receipt).toMatchObject({
      chain: 'solana',
      signature: 'jupiter-signature',
      status: 'confirmed',
      confirmations: 1,
      slot: 11,
    })
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('confirmed')
  })

  it('marks an unconfirmed Solana signature expired after its block height', async () => {
    const connection = solanaConnection([
      { confirmationStatus: null, confirmations: null, slot: null, err: null },
    ], 201)
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: connection as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'solana',
        signature: 'expired-signature',
        lastValidBlockHeight: 200,
      })
    })

    expect(receipt).toMatchObject({
      status: 'expired',
      error: { code: 'TRANSACTION_EXPIRED', action: 'refresh_quote' },
    })
  })

  it('returns a failed result when Solana reports an execution error', async () => {
    const connection = solanaConnection([
      {
        confirmationStatus: 'confirmed',
        confirmations: 1n,
        slot: 22n,
        err: { InstructionError: [0, 'Custom'] },
      },
    ])
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: connection as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'solana',
        signature: 'failed-signature',
      })
    })

    expect(receipt).toMatchObject({
      status: 'failed',
      error: { code: 'TRANSACTION_FAILED', action: 'inspect_transaction' },
    })
  })

  it('confirms a successful Base transaction receipt', async () => {
    const client = baseClient(successReceipt)
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { basePublicClient: client as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'base',
        signature: '0xsuccessfulhash',
      })
    })

    expect(receipt).toMatchObject({
      chain: 'base',
      status: 'confirmed',
      blockNumber: 1234n,
    })
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xsuccessfulhash',
    })
  })

  it('marks a reverted Base receipt as failed and non-replayable', async () => {
    const client = baseClient(revertedReceipt)
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { basePublicClient: client as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'base',
        signature: '0xrevertedhash',
      })
    })

    expect(receipt).toMatchObject({
      status: 'failed',
      error: { code: 'TRANSACTION_FAILED', action: 'inspect_transaction' },
    })
  })

  it('times out when a Base transaction remains pending', async () => {
    const client = {
      getTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error('Transaction not found')),
    }
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { basePublicClient: client as never },
        { pollIntervalMs: 1, timeoutMs: 8 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'base',
        signature: '0xpendinghash',
      })
    })

    expect(receipt).toMatchObject({
      status: 'timed_out',
      error: { code: 'RPC_OR_NETWORK_ERROR', action: 'retry_polling' },
    })
    expect(client.getTransactionReceipt).toHaveBeenCalled()
  })

  it('returns a retryable timeout when Solana RPC requests repeatedly fail', async () => {
    const connection = {
      getSignatureStatuses: vi
        .fn()
        .mockRejectedValue(new Error('network timeout while fetching signature status')),
      getBlockHeight: vi.fn(),
    }
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: connection as never },
        { pollIntervalMs: 1, timeoutMs: 12 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'solana',
        signature: '0x-network-timeout',
      })
    })

    expect(receipt).toMatchObject({
      status: 'timed_out',
      error: {
        code: 'RPC_OR_NETWORK_ERROR',
        action: 'retry_polling',
      },
    })
    expect(connection.getSignatureStatuses.mock.calls.length).toBeGreaterThan(1)
  })

  it('returns a retryable timeout when Base RPC repeatedly rate-limits receipt checks', async () => {
    const client = {
      getTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error('429 Too Many Requests: RPC rate limit exceeded')),
    }
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { basePublicClient: client as never },
        { pollIntervalMs: 1, timeoutMs: 12 },
      ),
    )

    let receipt
    await act(async () => {
      receipt = await result.current.start({
        chain: 'base',
        signature: '0x-rate-limited',
      })
    })

    expect(receipt).toMatchObject({
      status: 'timed_out',
      error: {
        code: 'RPC_OR_NETWORK_ERROR',
        action: 'retry_polling',
      },
    })
    expect(client.getTransactionReceipt.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops polling without leaving the hook in a confirming state', async () => {
    const connection = solanaConnection([
      { confirmationStatus: null, confirmations: null, slot: null, err: null },
      { confirmationStatus: null, confirmations: null, slot: null, err: null },
    ])
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: connection as never },
        { pollIntervalMs: 10, timeoutMs: 1_000 },
      ),
    )

    let pendingStart: Promise<unknown>
    await act(async () => {
      pendingStart = result.current.start({
        chain: 'solana',
        signature: 'cancelled-signature',
      })
      await Promise.resolve()
      result.current.stop()
    })

    await pendingStart!
    expect(result.current.isPolling).toBe(false)
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(1)
  })
})
