import type { ReceiptResult } from '../hooks/swapRecovery'
import { recoveryLabel } from '../hooks/swapRecovery'

type Props = {
  receipt: ReceiptResult | null
  isPolling: boolean
  onRetry: () => void
  onRefreshQuote: () => void
  onInspect: () => void
}

export function SwapReceiptStatus({
  receipt,
  isPolling,
  onRetry,
  onRefreshQuote,
  onInspect,
}: Props) {
  if (isPolling) {
    return (
      <div className="swap-receipt-status pending" role="status">
        <span className="status-spinner" />
        <div>
          <strong>Confirming transaction…</strong>
          <small>We are checking the network. Keep this window open.</small>
        </div>
      </div>
    )
  }

  if (!receipt || receipt.status === 'idle') return null

  if (receipt.status === 'confirmed') {
    return (
      <div className="swap-receipt-status confirmed" role="status">
        <span className="status-check">✓</span>
        <div>
          <strong>Swap confirmed</strong>
          <small>{receipt.chain === 'solana' ? `Slot ${receipt.slot ?? '—'}` : `Block ${receipt.blockNumber?.toString() ?? '—'}`}</small>
        </div>
      </div>
    )
  }

  const action = receipt.error?.action

  return (
    <div className="swap-receipt-status failed" role="alert">
      <span className="status-error">!</span>
      <div>
        <strong>{receipt.error?.message ?? 'Swap failed'}</strong>
        <small>{receipt.error?.code ?? receipt.status}</small>
      </div>
      <div className="status-actions">
        {action === 'refresh_quote' && (
          <button onClick={onRefreshQuote}>{recoveryLabel(action)}</button>
        )}
        {action === 'retry_polling' && (
          <button onClick={onRetry}>{recoveryLabel(action)}</button>
        )}
        {action === 'inspect_transaction' && (
          <button onClick={onInspect}>{recoveryLabel(action)}</button>
        )}
      </div>
    </div>
  )
}
