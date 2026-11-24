import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection } from '@solana/web3.js'
import type { PublicClient, TransactionReceipt } from 'viem'
import {
  normalizeSwapError,
  type ReceiptResult,
  type ReceiptStatus,
  type SwapChain,
} from './swapRecovery'

export type ReceiptPollRequest = {
  chain: SwapChain
  signature: string
  /** Jupiter's lastValidBlockHeight, when available. */
  lastValidBlockHeight?: number
  /** Base transaction block timeout. Defaults to 120 seconds. */
  timeoutMs?: number
}

type ReceiptDependencies = {
  solanaConnection?: Connection
  basePublicClient?: PublicClient
}

type PollingState = {
  result: ReceiptResult | null
  isPolling: boolean
  attempts: number
}

const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_TIMEOUT_MS = 120_000

export function useSwapReceiptPolling(
  dependencies: ReceiptDependencies,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const [state, setState] = useState<PollingState>({
    result: null,
    isPolling: false,
    attempts: 0,
  })
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const lastRequestRef = useRef<ReceiptPollRequest | null>(null)

  const stop = useCallback(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setState((current) => ({ ...current, isPolling: false }))
  }, [])

  const poll = useCallback(
    async (
      request: ReceiptPollRequest,
      signal: AbortSignal,
      runId: number,
    ): Promise<ReceiptResult> => {
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
      const startedAt = Date.now()
      let attempts = 0
      const isCurrent = () => !signal.aborted && runIdRef.current === runId

      if (request.chain === 'solana') {
        const connection = dependencies.solanaConnection
        if (!connection) {
          throw new Error('A Solana Connection is required for Solana receipts.')
        }

        while (Date.now() - startedAt < timeoutMs) {
          if (!isCurrent()) throw new Error('Polling cancelled')
          attempts += 1
          setState((current) => ({ ...current, attempts }))

          try {
            const [statusResponse, currentBlockHeight] = await Promise.all([
              connection.getSignatureStatuses([request.signature], {
                searchTransactionHistory: true,
              }),
              request.lastValidBlockHeight === undefined
                ? Promise.resolve<number | null>(null)
                : connection.getBlockHeight('confirmed'),
            ])

            const status = statusResponse.value[0]

            if (status?.err) {
              return {
                chain: 'solana',
                signature: request.signature,
                status: 'failed',
                slot: status.slot === null ? undefined : Number(status.slot),
                error: normalizeSwapError('solana', status.err),
              }
            }

            if (
              status &&
              (status.confirmationStatus === 'confirmed' ||
                status.confirmationStatus === 'finalized')
            ) {
              return {
                chain: 'solana',
                signature: request.signature,
                status: 'confirmed',
                confirmations:
                  status.confirmations === null
                    ? undefined
                    : Number(status.confirmations),
                slot: status.slot === null ? undefined : Number(status.slot),
              }
            }

            if (
              request.lastValidBlockHeight !== undefined &&
              currentBlockHeight !== null &&
              currentBlockHeight > request.lastValidBlockHeight
            ) {
              return {
                chain: 'solana',
                signature: request.signature,
                status: 'expired',
                error: normalizeSwapError('solana', 'transaction expired'),
              }
            }
          } catch (error) {
            if (!isCurrent()) throw error
            if (Date.now() - startedAt >= timeoutMs) {
              return {
                chain: 'solana',
                signature: request.signature,
                status: 'timed_out',
                error: normalizeSwapError('solana', 'RPC polling timeout'),
              }
            }
          }

          await delay(pollIntervalMs, signal)
        }

        return {
          chain: 'solana',
          signature: request.signature,
          status: 'timed_out',
          error: normalizeSwapError('solana', 'RPC polling timeout'),
        }
      }

      const publicClient = dependencies.basePublicClient
      if (!publicClient) {
        throw new Error('A Base PublicClient is required for Base receipts.')
      }

      while (Date.now() - startedAt < timeoutMs) {
        if (!isCurrent()) throw new Error('Polling cancelled')
        attempts += 1
        setState((current) => ({ ...current, attempts }))

        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: request.signature as `0x${string}`,
          })

          return mapBaseReceipt(receipt, request.signature)
        } catch (error) {
          if (!isCurrent()) throw error

          // viem throws while a transaction is not mined. Continue polling for
          // not-found errors, but surface other provider errors immediately.
          const message = error instanceof Error ? error.message.toLowerCase() : ''
          const notMined =
            message.includes('not found') ||
            message.includes('unknown transaction') ||
            message.includes('pending')

          if (!notMined) {
            return {
              chain: 'base',
              signature: request.signature,
              status: 'failed',
              error: normalizeSwapError('base', error),
            }
          }
        }

        await delay(pollIntervalMs, signal)
      }

      return {
        chain: 'base',
        signature: request.signature,
        status: 'timed_out',
        error: normalizeSwapError('base', 'RPC polling timeout'),
      }
    },
    [defaultTimeoutMs, dependencies.basePublicClient, dependencies.solanaConnection, pollIntervalMs],
  )

  const start = useCallback(
    async (request: ReceiptPollRequest): Promise<ReceiptResult> => {
      stop()
      const runId = runIdRef.current
      const controller = new AbortController()
      abortRef.current = controller
      lastRequestRef.current = request
      setState({ result: null, isPolling: true, attempts: 0 })

      try {
        const result = await poll(request, controller.signal, runId)
        if (runIdRef.current === runId) {
          setState((current) => ({ ...current, result, isPolling: false }))
          abortRef.current = null
        }
        return result
      } catch (error) {
        if (controller.signal.aborted || runIdRef.current !== runId) {
          return {
            chain: request.chain,
            signature: request.signature,
            status: 'timed_out',
            error: normalizeSwapError(request.chain, 'Polling cancelled'),
          }
        }

        const result: ReceiptResult = {
          chain: request.chain,
          signature: request.signature,
          status: 'failed',
          error: normalizeSwapError(request.chain, error),
        }
        setState((current) => ({ ...current, result, isPolling: false }))
        abortRef.current = null
        return result
      }
    },
    [poll, stop],
  )

  const retry = useCallback(async () => {
    if (!lastRequestRef.current) return null
    return start(lastRequestRef.current)
  }, [start])

  useEffect(() => stop, [stop])

  return {
    ...state,
    start,
    retry,
    stop,
    status: state.result?.status ?? ('idle' as ReceiptStatus),
  }
}

function mapBaseReceipt(
  receipt: TransactionReceipt,
  signature: string,
): ReceiptResult {
  if (receipt.status === 'reverted') {
    return {
      chain: 'base',
      signature,
      status: 'failed',
      blockNumber: receipt.blockNumber,
      error: normalizeSwapError('base', 'EVM transaction reverted'),
    }
  }

  return {
    chain: 'base',
    signature,
    status: 'confirmed',
    blockNumber: receipt.blockNumber,
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Polling cancelled'))
      },
      { once: true },
    )
  })
}
