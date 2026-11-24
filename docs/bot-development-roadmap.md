# Bot development roadmap

## Repository audit

As of the current `main` branch, the repository has no Git tags or branches named for `solana-memecoin-sniper-bot` or `trading-bot`, and there are no existing source modules for either bot. The active codebase is the DeFAI Agentic DEX Launchpad with Solana Jupiter/Base 0x swap-recovery infrastructure.

The first tags for these tracks therefore represent a reviewed scaffold, not a claim that live trading is implemented:

- `solana-memecoin-sniper-bot-v0.1.0-scaffold`
- `trading-bot-v0.1.0-scaffold`

The exact track identifiers used in code are `solana-memecoin-sniper-bot` and `trading-bot`.

## Safety boundary

Both tracks begin with live execution disabled. The project must not store private keys or sign transactions on a backend. Development starts with deterministic paper execution, replay fixtures, and risk decisions before any wallet submission is enabled.

A live order may only become possible after the track is explicitly promoted to `production` with `executionMode: live`, all risk gates are enabled, and a user-approved wallet execution policy is present. A UI label or Git tag alone must never enable execution.

## Shared foundation

1. Define a canonical signal, quote, order, receipt, position, and recovery event model.
2. Reuse the existing Solana/Jupiter and Base/0x receipt polling and recovery states.
3. Add idempotency keys and deduplication for signals and submitted transactions.
4. Add persistent audit events for quote, approval, submission, confirmation, expiry, revert, and recovery.
5. Keep all execution adapters behind an explicit paper/live policy boundary.

## Solana Memecoin Sniper Bot

### Phase 1: detection and safety filters — started

- The initial provider-agnostic log normalizer is implemented in `src/bots/solanaTokenIngestion.ts`. It accepts decoded adapter metadata or deterministic log hints, normalizes supported token/liquidity events, and deduplicates signatures.
- The initial fail-closed filter set is implemented in `src/bots/solanaRiskFilters.ts`. It validates mint/freeze authorities, liquidity, liquidity locking, holder concentration, token age, denylisting, and simulation status.
- Add a production provider adapter with reconnecting websocket/stream ingestion and durable cursor/checkpoint storage.
- Validate mint authority, freeze authority, liquidity depth, holder concentration, and token age from trusted RPC/indexer data.
- Add configurable allowlists, denylists, maximum position size, maximum slippage, and priority-fee ceilings.
- Produce a candidate report without submitting a transaction.

### Phase 2: paper execution

- The guarded builder and paper-only pipeline are implemented in `src/bots/solanaSniperExecution.ts`. It requires an approved risk decision, validates the output mint, quote age, order size, slippage, price impact, priority fee, and Jupiter transaction payload, then returns a wallet handoff/paper-ready object without signing or submitting.
- Request Jupiter quotes and retain quote expiry metadata.
- Simulate fills against recorded liquidity and price fixtures.
- Reuse receipt recovery states to model confirmation, expiry, dropped, and failed transactions.
- Add replay tests for fast-moving and illiquid markets.

### Phase 3: guarded execution

- Require an explicit user policy and wallet approval for every first live submission.
- Add a kill switch, daily loss limit, exposure cap, and rate limit.
- Start with one position at a time and bounded order sizes.

## Trading Bot

### Phase 1: strategy-neutral runtime

- Define deterministic signal and portfolio events.
- Add a paper broker and replayable fixtures.
- Track cash, token balances, open orders, fills, fees, and realized/unrealized PnL.

### Phase 2: risk and reconciliation

- Add per-trade risk, daily-loss, exposure, and circuit-breaker checks.
- Reconcile every submitted order with its receipt before updating positions.
- Treat expired quotes, reverted receipts, RPC timeouts, and rate limits as explicit recovery states.

### Phase 3: chain adapters

- Connect Jupiter on Solana and 0x AllowanceHolder on Base through the existing quote/sign/receipt boundaries.
- Keep strategy logic independent from chain-specific calldata and transaction formats.
- Add approval-target validation and stale-quote rejection before any live transaction.

## Acceptance criteria for promotion

A track is not production-ready until it has deterministic replay tests, negative tests for RPC failures and rate limits, receipt reconciliation, bounded retry behavior, auditable risk decisions, an emergency stop, and documented wallet/network assumptions.
