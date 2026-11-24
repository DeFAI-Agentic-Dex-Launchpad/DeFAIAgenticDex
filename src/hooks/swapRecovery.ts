export type SwapChain = 'solana' | 'base'

export type ReceiptStatus =
  | 'idle'
  | 'polling'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'timed_out'
  | 'rejected'

export type RecoveryAction =
  | 'none'
  | 'refresh_quote'
  | 'retry_polling'
  | 'check_wallet'
  | 'retry_later'
  | 'inspect_transaction'

export type NormalizedSwapError = {
  code: string
  message: string
  recoverable: boolean
  action: RecoveryAction
  raw?: unknown
}

export type ReceiptResult = {
  chain: SwapChain
  signature: string
  status: ReceiptStatus
  confirmations?: number
  slot?: number
  blockNumber?: bigint
  error?: NormalizedSwapError
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message

  try {
    return JSON.stringify(value)
  } catch {
    return 'Unknown transaction error'
  }
}

export function normalizeSwapError(
  chain: SwapChain,
  raw: unknown,
): NormalizedSwapError {
  const text = stringifyUnknown(raw)
  const normalized = text.toLowerCase()

  if (
    normalized.includes('user rejected') ||
    normalized.includes('user denied') ||
    normalized.includes('rejected the request')
  ) {
    return {
      code: 'USER_REJECTED',
      message: 'The wallet rejected the transaction.',
      recoverable: true,
      action: 'check_wallet',
      raw,
    }
  }

  if (
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient lamports') ||
    normalized.includes('insufficient balance')
  ) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      message: `The ${chain === 'solana' ? 'wallet needs more SOL' : 'wallet needs more ETH or token balance'} to complete this swap.`,
      recoverable: true,
      action: 'check_wallet',
      raw,
    }
  }

  if (
    normalized.includes('block height exceeded') ||
    normalized.includes('blockhash not found') ||
    normalized.includes('expired')
  ) {
    return {
      code: 'TRANSACTION_EXPIRED',
      message: 'The transaction expired before confirmation. Request a fresh quote.',
      recoverable: true,
      action: 'refresh_quote',
      raw,
    }
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('network') ||
    normalized.includes('rpc') ||
    normalized.includes('fetch')
  ) {
    return {
      code: 'RPC_OR_NETWORK_ERROR',
      message: 'The network did not respond in time. You can safely retry status polling.',
      recoverable: true,
      action: 'retry_polling',
      raw,
    }
  }

  return {
    code: 'TRANSACTION_FAILED',
    message: 'The transaction failed onchain. Inspect the transaction before retrying.',
    recoverable: false,
    action: 'inspect_transaction',
    raw,
  }
}

export function recoveryLabel(action: RecoveryAction): string {
  switch (action) {
    case 'refresh_quote':
      return 'Refresh quote'
    case 'retry_polling':
      return 'Retry status check'
    case 'check_wallet':
      return 'Check wallet'
    case 'retry_later':
      return 'Retry later'
    case 'inspect_transaction':
      return 'Inspect transaction'
    default:
      return 'Done'
  }
}
