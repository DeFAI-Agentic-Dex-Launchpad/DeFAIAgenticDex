# DeFAI Agentic DEX Launchpad

DeFAI Agentic DEX Launchpad is a Vite + React interface for agent-assisted decentralized exchange workflows. It brings wallet-aware token swapping, on-chain transaction status tracking, and resilient swap-recovery flows into one focused DeFi frontend.

## What this project does

The application is designed to make DEX interactions easier to operate and monitor across the full swap lifecycle:

- Connect a wallet and prepare decentralized exchange actions.
- Track submitted transactions and poll for confirmation.
- Recover gracefully when a swap receipt is delayed or temporarily unavailable.
- Surface clear receipt and execution status so users and agents can act on the same state.
- Build on TypeScript, React, Vite, `@solana/web3.js`, and `viem` for a modern on-chain application workflow.

## Development workflow

```bash
npm install
npm run dev
```

Run the production checks locally before opening a pull request:

```bash
npm test
npm run build
```

The production build is generated in `dist/` by Vite. The project is suitable for static hosting, including GitHub Pages, once a deployment workflow and custom domain are configured.

## Repository structure

- `src/main.tsx` — application entry point and primary UI flow.
- `src/hooks/` — transaction receipt polling, swap recovery, and related tests.
- `src/components/` — reusable swap and receipt-status UI components.
- `public/` — static assets and route metadata.
- `TODO.md` — tracked follow-up work for the launchpad.

## Contribution workflow

1. Create a focused branch from `main`.
2. Install dependencies and run the test suite.
3. Implement the change with matching tests where behavior changes.
4. Run `npm test` and `npm run build` before submitting a pull request.
5. Describe user-facing impact, on-chain behavior, and any deployment considerations in the pull request.

## Status

This repository is an active DeFAI/DeFi frontend workbench. Features and integrations may evolve as the launchpad workflow is expanded.
