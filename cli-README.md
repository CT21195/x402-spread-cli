# x402-spread-cli

Pay-per-call command line for the [x402 Spread API](https://workspace-x402-paywall.onrender.com) — 137 endpoints, USDC on Base via the x402 protocol.

```bash
npm install -g x402-spread-cli

export SPREAD_API_EVM_KEY=0xYOUR_PRIVATE_KEY   # a Base wallet with a little USDC

x402-spread check                  # live SOL spreads across top CEXs + Solana DEXs
x402-spread npi 1234567890         # validate an NPI number (+ CMS registry data)
x402-spread audit <token-address>  # RugCheck risk report for a Solana token
```

## You are never charged silently

Every command does this:

1. Asks the API for its price (HTTP 402).
2. Prints `This command costs $0.005 USDC.`
3. Asks `Proceed? (y/N)` — anything except `y` cancels for free.

Your key never leaves your machine. It only signs an EIP-3009 authorization;
a facilitator settles it on-chain, so no gas is needed.

## Commands

| Command | API endpoint | Typical price |
|---|---|---|
| `x402-spread check` | `GET /spread` | $0.005 |
| `x402-spread npi <npi>` | `GET /verify/npi?npi=` | $0.001 |
| `x402-spread audit <token>` | `GET /solana/audit?token=` | $0.05 |

Prices come from the live 402 response, so the number you see is always exact.

## Development

```bash
npm install
npm run build
node dist/cli.js check
```

## Publishing

Releases publish to npm automatically via Trusted Publishing (OIDC) —
no npm token needed. Create a GitHub Release and the workflow handles it.
