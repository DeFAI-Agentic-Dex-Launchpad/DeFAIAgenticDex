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
- `src/bots/` — safety-first bot track registry and tests for the Solana sniper and multi-chain trading bot.
- `src/components/` — reusable swap and receipt-status UI components.
- `public/` — static assets and route metadata.
- `docs/bot-development-roadmap.md` — audit, tag convention, and staged implementation plan for both bot tracks.
- `TODO.md` — tracked follow-up work for the launchpad.

## Contribution workflow

1. Create a focused branch from `main`.
2. Install dependencies and run the test suite.
3. Implement the change with matching tests where behavior changes.
4. Run `npm test` and `npm run build` before submitting a pull request.
5. Describe user-facing impact, on-chain behavior, and any deployment considerations in the pull request.

## Status

This repository is an active DeFAI/DeFi frontend workbench. The bot tracks are currently disabled scaffolds: they do not submit live orders, and their tags do not imply production trading capability.

## Customer domain connection

The app includes a **Connect domain** control backed by CustomDomain™. The browser requests a short-lived widget token from `POST /api/customdomain-token`; the server route reads `CUSTOMDOMAIN_API_KEY` from the deployment environment and never exposes that key to the browser or repository.

For a Vercel deployment, add this environment variable in the project settings before using the button:

```text
CUSTOMDOMAIN_API_KEY=<your server-side CustomDomain API key>
DEFAI_AUTH_JWT_SECRET=<server-only HS256 session signing secret>
```

The token route requires `Authorization: Bearer <session-jwt>`. It verifies an `HS256` signature with `DEFAI_AUTH_JWT_SECRET`, requires a non-empty `sub` claim, rejects expired tokens, and uses the verified `sub` as CustomDomain’s `end_user_ref`. Optional `DEFAI_AUTH_JWT_ISSUER` and `DEFAI_AUTH_JWT_AUDIENCE` variables can enforce issuer and audience claims.

The frontend reads the signed session JWT from `sessionStorage` under `defai-auth-token`; the application’s real sign-in flow must place it there after authentication. Do not commit any secret or place either secret in client-side Vite variables such as `VITE_*`. The current frontend is static-host compatible, but the CustomDomain token route must run on a serverless host such as Vercel.
