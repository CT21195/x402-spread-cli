#!/usr/bin/env node
/**
 * x402-spread — pay-per-call CLI for the x402 Spread API.
 *
 *   x402-spread check                   live SOL spreads across CEXs and Solana DEXs
 *   x402-spread audit <token>           RugCheck risk report for a Solana token
 *   x402-spread call <path>             call ANY endpoint on the API, e.g.
 *                                       x402-spread call "/stocks/price?symbol=AAPL"
 *   x402-spread list                    list every endpoint the API offers
 *
 * Plus one small utility command (npi). Every paid call shows its exact
 * USDC price and asks for confirmation before any payment is signed.
 * Nothing is ever charged silently.
 */
import { paidFetch, PaymentDeclinedError, API_BASE } from "./x402";

const HELP = `x402-spread — pay-per-call CLI for the x402 Spread API

Usage:
  x402-spread check                    SOL spreads across top CEXs and Solana DEXs
  x402-spread audit <token-address>    RugCheck risk report for a Solana token
  x402-spread call <path>              Call any other endpoint on the API, e.g.
                                       x402-spread call "/fx/convert?from=USD&to=EUR"
  x402-spread list                     List every endpoint the API offers
  x402-spread npi <10-digit-npi>       Validate an NPI number (utility)
  x402-spread help                     Show this help

Setup (one time):
  export SPREAD_API_EVM_KEY=0xYOUR_PRIVATE_KEY
  Fund that Base wallet with a little USDC. Each command shows its price
  and asks "Proceed? (y/N)" — answering anything but "y" cancels for free.
`;

function fail(msg: string): never {
  console.error(`Error: ${msg}\n`);
  console.error(HELP);
  process.exit(1);
}

async function listEndpoints(): Promise<void> {
  const res = await fetch(`${API_BASE}/openapi.json`);
  if (!res.ok) throw new Error(`could not fetch the endpoint list (HTTP ${res.status})`);
  const spec: any = await res.json();
  const rows: string[] = [];
  for (const [p, ops] of Object.entries<any>(spec.paths || {})) {
    if (!ops.get) continue;
    const params = (ops.get.parameters || [])
      .filter((q: any) => q.required)
      .map((q: any) => q.name);
    rows.push(params.length ? `${p}   (needs: ${params.join(", ")})` : p);
  }
  rows.sort();
  console.log(`${rows.length} endpoints on ${API_BASE}:\n`);
  for (const r of rows) console.log(`  ${r}`);
  console.log(`\nCall any of them:\n  x402-spread call "<path>"   e.g.  x402-spread call "/stocks/price?symbol=AAPL"`);
}

async function main(): Promise<void> {
  const [, , cmd, arg] = process.argv;

  if (cmd === "list") {
    await listEndpoints();
    return;
  }

  let path: string;
  switch (cmd) {
    case "check":
      path = "/spread";
      break;
    case "audit":
      if (!arg) {
        fail("audit needs a Solana token address, e.g.  x402-spread audit <token>");
      }
      path = `/solana/audit?token=${encodeURIComponent(arg)}`;
      break;
    case "call":
      if (!arg || !arg.startsWith("/")) {
        fail('call needs an API path in quotes, e.g.  x402-spread call "/stocks/price?symbol=AAPL"');
      }
      path = arg;
      break;
    case "npi":
      if (!arg || !/^\d{10}$/.test(arg)) {
        fail("npi needs a 10-digit NPI number, e.g.  x402-spread npi 1234567890");
      }
      path = `/verify/npi?npi=${encodeURIComponent(arg)}`;
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return;
    default:
      fail(`unknown command "${cmd}"`);
  }

  try {
    const data = await paidFetch(path);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    if (err instanceof PaymentDeclinedError) {
      console.log(err.message);
      return; // declining is not an error — exit 0
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
