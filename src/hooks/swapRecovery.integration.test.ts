import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { normalizeSwapError } from './swapRecovery'
import { useSwapReceiptPolling } from './useSwapReceiptPolling'

type SolanaQuote = {
  transaction: string
  lastValidBlockHeight: number
}

type MockWallet = {
  signAndSendSolana: ReturnType<typeof vi.fn>
  sendBaseTransaction: ReturnType<typeof vi.fn>
}

function createMockWallet(): MockWallet {
  return {
    signAndSendSolana: vi.fn(),
    sendBaseTransaction: vi.fn(),
  }
}

function createSolanaRpc(
  statusesBySignature: Record<string, unknown[]>,
  blockHeightBySignature: Record<string, number>,
) {
  const calls = new Map<string, number>()

  return {
    getSignatureStatuses: vi.fn(async (signatures: string[]) => {
      const signature = signatures[0]
      const queue = statusesBySignature[signature] ?? []
      const callNumber = calls.get(signature) ?? 0
      calls.set(signature, callNumber + 1)
      return {
        value: [queue[callNumber] ?? queue[queue.length - 1] ?? null],
      }
    }),
    getBlockHeight: vi.fn(async () => {
      const entries = [...calls.entries()]
      const activeSignature = entries[entries.length - 1]?.[0]
      return activeSignature ? blockHeightBySignature[activeSignature] : 0
    }),
  }
}

async function runSolanaAttempt({
  wallet,
  quoteService,
  receipt,
}: {
  wallet: MockWallet
  quoteService: { getQuote: ReturnType<typeof vi.fn> }
  receipt: ReturnType<typeof useSwapReceiptPolling>['start']
}) {
  const quote = (await quoteService.getQuote()) as SolanaQuote
  const signature = await wallet.signAndSendSolana(quote.transaction)

  return receipt({
    chain: 'solana',
    signature,
    lastValidBlockHeight: quote.lastValidBlockHeight,
  })
}

describe('swap recovery integration flow with a mock wallet', () => {
  it('executes a Solana swap from quote to confirmed receipt', async () => {
    const wallet = createMockWallet()
    wallet.signAndSendSolana.mockResolvedValue('solana-confirmed-signature')

    const quoteService = {
      getQuote: vi.fn().mockResolvedValue({
        transaction: 'jupiter-versioned-transaction',
        lastValidBlockHeight: 500,
      }),
    }
    const rpc = createSolanaRpc(
      {
        'solana-confirmed-signature': [
          {
            confirmationStatus: 'confirmed',
            confirmations: 1n,
            slot: 900n,
            err: null,
          },
        ],
      },
      { 'solana-confirmed-signature': 450 },
    )
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: rpc as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let swapResult
    await act(async () => {
      swapResult = await runSolanaAttempt({
        wallet,
        quoteService,
        receipt: result.current.start,
      })
    })

    expect(quoteService.getQuote).toHaveBeenCalledTimes(1)
    expect(wallet.signAndSendSolana).toHaveBeenCalledWith(
      'jupiter-versioned-transaction',
    )
    expect(swapResult).toMatchObject({
      chain: 'solana',
      signature: 'solana-confirmed-signature',
      status: 'confirmed',
    })
  })

  it('refreshes the Solana quote and submits a new transaction after expiry', async () => {
    const wallet = createMockWallet()
    wallet.signAndSendSolana
      .mockResolvedValueOnce('stale-solana-signature')
      .mockResolvedValueOnce('fresh-solana-signature')

    const quoteService = {
      getQuote: vi
        .fn()
        .mockResolvedValueOnce({
          transaction: 'stale-jupiter-transaction',
          lastValidBlockHeight: 200,
        })
        .mockResolvedValueOnce({
          transaction: 'fresh-jupiter-transaction',
          lastValidBlockHeight: 400,
        }),
    }
    const rpc = createSolanaRpc(
      {
        'stale-solana-signature': [
          { confirmationStatus: null, confirmations: null, slot: null, err: null },
        ],
        'fresh-solana-signature': [
          {
            confirmationStatus: 'confirmed',
            confirmations: 1n,
            slot: 902n,
            err: null,
          },
        ],
      },
      {
        'stale-solana-signature': 201,
        'fresh-solana-signature': 350,
      },
    )
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: rpc as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let firstAttempt
    await act(async () => {
      firstAttempt = await runSolanaAttempt({
        wallet,
        quoteService,
        receipt: result.current.start,
      })
    })

    expect(firstAttempt).toMatchObject({
      status: 'expired',
      error: { action: 'refresh_quote' },
    })

    // Recovery uses a new quote and transaction; it never replays the stale one.
    let recoveredAttempt
    await act(async () => {
      recoveredAttempt = await runSolanaAttempt({
        wallet,
        quoteService,
        receipt: result.current.start,
      })
    })

    expect(recoveredAttempt).toMatchObject({
      status: 'confirmed',
      signature: 'fresh-solana-signature',
    })
    expect(quoteService.getQuote).toHaveBeenCalledTimes(2)
    expect(wallet.signAndSendSolana).toHaveBeenNthCalledWith(
      1,
      'stale-jupiter-transaction',
    )
    expect(wallet.signAndSendSolana).toHaveBeenNthCalledWith(
      2,
      'fresh-jupiter-transaction',
    )
  })

  it('surfaces a reverted Base transaction without automatically replaying it', async () => {
    const wallet = createMockWallet()
    wallet.sendBaseTransaction.mockResolvedValue('0xreverted-swap')
    const baseClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'reverted',
        blockNumber: 777n,
      }),
    }
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { basePublicClient: baseClient as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    const quote = {
      to: '0xallowance-target',
      data: '0xswapcalldata',
      value: 0n,
    }
    const transactionHash = await wallet.sendBaseTransaction(quote)
    let swapResult
    await act(async () => {
      swapResult = await result.current.start({
        chain: 'base',
        signature: transactionHash,
      })
    })

    expect(swapResult).toMatchObject({
      status: 'failed',
      error: {
        code: 'TRANSACTION_FAILED',
        action: 'inspect_transaction',
      },
    })
    expect(wallet.sendBaseTransaction).toHaveBeenCalledTimes(1)
  })

  it('classifies mock-wallet rejection and does not start receipt polling', async () => {
    const wallet = createMockWallet()
    wallet.signAndSendSolana.mockRejectedValue(
      new Error('User rejected the request'),
    )
    const rpc = createSolanaRpc({}, {})
    const { result } = renderHook(() =>
      useSwapReceiptPolling(
        { solanaConnection: rpc as never },
        { pollIntervalMs: 0, timeoutMs: 100 },
      ),
    )

    let recovery
    try {
      await wallet.signAndSendSolana('jupiter-transaction')
    } catch (error) {
      recovery = normalizeSwapError('solana', error)
    }

    expect(recovery).toMatchObject({
      code: 'USER_REJECTED',
      recoverable: true,
      action: 'check_wallet',
    })
    expect(result.current.status).toBe('idle')
    expect(rpc.getSignatureStatuses).not.toHaveBeenCalled()
  })
})
