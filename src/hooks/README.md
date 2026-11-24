# Swap receipt polling

`useSwapReceiptPolling` accepts a Solana `Connection` and a viem `PublicClient`, then normalizes both networks into the same result shape.

```tsx
const receipt = useSwapReceiptPolling({
  solanaConnection,
  basePublicClient,
})

const result = await receipt.start({
  chain: 'solana',
  signature: jupiterSignature,
  lastValidBlockHeight: Number(order.lastValidBlockHeight),
})

const baseResult = await receipt.start({
  chain: 'base',
  signature: baseTxHash,
})
```

Use `result.error.action` to drive recovery:

- `refresh_quote`: request a new Jupiter or 0x quote because the signed transaction expired.
- `retry_polling`: retry status checks after a transient RPC/network failure.
- `check_wallet`: show balance or wallet-network guidance.
- `inspect_transaction`: open Solscan or BaseScan when the chain rejected the transaction.

For Jupiter, pass `lastValidBlockHeight` from `/order` so an unconfirmed signature can be marked expired instead of polling indefinitely. For Base, a transaction is confirmed when `getTransactionReceipt` returns `status: 'success'`; `status: 'reverted'` is a terminal onchain failure.
