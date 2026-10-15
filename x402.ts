/**
 * x402 v2 payment helper for the Spread Paywall API (CLI edition).
 *
 * Flow: unpaid GET -> HTTP 402 with payment terms -> PRINT THE PRICE and ask
 * the user to confirm -> only then sign EIP-3009 TransferWithAuthorization and
 * retry with the payment in the PAYMENT-SIGNATURE header.
 *
 * The signing and payload code below is copied verbatim from the proven
 * eliza-plugin-spread x402.ts (real payments have settled through it).
 * The only change vs the plugin version is the human confirmation gate:
 * funds NEVER move without the user typing "y".
 *
 * Private key is read from SPREAD_API_EVM_KEY and never logged.
 */
import { randomBytes } from "node:crypto";
import * as readline from "node:readline";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";

export const API_BASE = "https://workspace-x402-paywall.onrender.com";
// NOTE: copied exactly from the working plugin x402.ts — do not "fix".
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TARGET_NETWORK = "eip155:8453";

interface AcceptsEntry {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
}

interface PaymentTerms {
  x402Version?: number;
  accepts?: AcceptsEntry[];
}

export class PaymentDeclinedError extends Error {
  constructor() {
    super("Payment declined — no funds moved.");
    this.name = "PaymentDeclinedError";
  }
}

function getKey(): `0x${string}` {
  const k = process.env.SPREAD_API_EVM_KEY;
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(
      "SPREAD_API_EVM_KEY is not set.\n" +
        "Export your Base wallet private key first:\n" +
        "  export SPREAD_API_EVM_KEY=0xYOUR_PRIVATE_KEY\n" +
        "Then fund that wallet with a little Base USDC (a few cents covers many calls).\n" +
        "Your key never leaves this machine — it is only used to sign payments."
    );
  }
  return k as `0x${string}`;
}

/** USDC has 6 decimals: "5000" -> "0.005" */
function formatUsdc(amount: string): string {
  const micros = BigInt(amount);
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      // Anything other than an explicit y/yes declines. Empty input = no.
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * x402 v2 servers deliver payment terms either base64-encoded in the
 * `payment-required` response header (this API) or as a JSON body.
 */
async function readPaymentTerms(res: Response, path: string): Promise<PaymentTerms> {
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentTerms;
    } catch {
      throw new Error(`could not decode payment-required header for ${path}`);
    }
  }
  return (await res.json()) as PaymentTerms;
}

export async function paidFetch(path: string): Promise<unknown> {
  const url = `${API_BASE}${path}`;

  // Fail fast on a missing key before any network call.
  const key = getKey();

  // Step 1: unpaid request to learn the price.
  const first = await fetch(url, { headers: { Accept: "application/json" } });
  if (first.status === 200) return first.json();
  if (first.status !== 402) {
    throw new Error(`unexpected status ${first.status} from ${path}`);
  }
  const terms = await readPaymentTerms(first, path);
  const accepted = (terms.accepts ?? []).find((a) => a.network === TARGET_NETWORK);
  if (!accepted) {
    throw new Error(`no ${TARGET_NETWORK} payment option offered for ${path}`);
  }

  // Step 2: THE GATE — show the exact price, move nothing without consent.
  const price = formatUsdc(accepted.amount);
  console.log(`This command costs $${price} USDC.`);
  const ok = await askYesNo("Proceed? (y/N) ");
  if (!ok) {
    throw new PaymentDeclinedError();
  }

  // Step 3: sign EIP-3009 TransferWithAuthorization (verbatim proven logic).
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: base, transport: http() });
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const authorization = {
    from: account.address,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: "0",
    validBefore: String(now + 600),
    nonce,
  };
  const signature = await client.signTypedData({
    domain: {
      name: accepted.extra?.name ?? "USD Coin",
      version: accepted.extra?.version ?? "2",
      chainId: 8453,
      verifyingContract: USDC_BASE,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    // bigint for the typed-data encoder; encodes identically to the decimal strings above
    message: {
      from: account.address,
      to: accepted.payTo as `0x${string}`,
      value: BigInt(accepted.amount),
      validAfter: 0n,
      validBefore: BigInt(now + 600),
      nonce,
    },
  });

  // Step 4: retry with the payment signature (format verified against x402 v2).
  const paymentPayload = {
    x402Version: terms.x402Version ?? 2,
    accepted,
    payload: { signature, authorization },
  };
  const b64 = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  const second = await fetch(url, {
    headers: { Accept: "application/json", "PAYMENT-SIGNATURE": b64 },
  });
  if (second.status !== 200) {
    throw new Error(
      `paid request failed with ${second.status}: ${(await second.text()).slice(0, 300)}`
    );
  }
  return second.json();
}
