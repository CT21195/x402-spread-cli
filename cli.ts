#!/usr/bin/env node
/**
 * x402-spread — pay-per-call CLI for the x402 Spread API.
 *
 *   x402-spread check                 live SOL spreads across CEXs and Solana DEXs
 *   x402-spread npi <10-digit-npi>    validate an NPI number (+ CMS registry data)
 *   x402-spread audit <token>         RugCheck risk report for a Solana token
 *
 * Every command shows its exact USDC price and asks for confirmation
 * before any payment is signed. Nothing is ever charged silently.
 */
import { paidFetch, PaymentDeclinedError } from "./x402";

const HELP = `x402-spread — pay-per-call CLI for the x402 Spread API

Usage:
  x402-spread check                  SOL spreads across top CEXs and Solana DEXs
  x402-spread npi <10-digit-npi>     Validate an NPI number (CMS registry lookup)
  x402-spread audit <token-address>  RugCheck risk report for a Solana token
  x402-spread help                   Show this help

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

async function main(): Promise<void> {
  const [, , cmd, arg] = process.argv;

  let path: string;
  switch (cmd) {
    case "check":
      path = "/spread";
      break;
    case "npi":
      if (!arg || !/^\d{10}$/.test(arg)) {
        fail("npi needs a 10-digit NPI number, e.g.  x402-spread npi 1234567890");
      }
      path = `/verify/npi?npi=${encodeURIComponent(arg)}`;
      break;
    case "audit":
      if (!arg) {
        fail("audit needs a Solana token address, e.g.  x402-spread audit <token>");
      }
      path = `/solana/audit?token=${encodeURIComponent(arg)}`;
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
