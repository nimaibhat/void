/**
 * XRPL Helper — Testnet RLUSD-style token payouts
 *
 * Flow:
 *   1. Program wallet (from env XRPL_SEED) acts as the RLUSD token issuer.
 *   2. User wallets are created via the Testnet faucet.
 *   3. User wallet creates a TrustLine to the issuer for "RLUSD".
 *   4. When savings threshold is met, program wallet sends RLUSD to user.
 *
 * This follows the official XRPL "Create Trust Line and Send Currency"
 * tutorial pattern exactly.
 *
 * Env vars needed:
 *   XRPL_RPC_URL  = wss://s.altnet.rippletest.net:51233
 *   XRPL_SEED     = program wallet seed (from Testnet faucet)
 *   XRPL_ISSUER   = program wallet address (same account, it IS the issuer)
 */

import * as xrpl from "xrpl";

/* ------------------------------------------------------------------ */
/*  Connection                                                         */
/* ------------------------------------------------------------------ */

/**
 * Testnet RPC servers — we try the env var first, then fall back through
 * several public Testnet endpoints in case one is slow or unreachable.
 */
const RPC_URLS: string[] = [
  process.env.XRPL_RPC_URL ?? "",
  "wss://testnet.xrpl-labs.com",
  "wss://s.altnet.rippletest.net:51233",
].filter(Boolean);

const CONNECTION_TIMEOUT_MS = 15_000; // 15 seconds (default is 5s)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const CLIENT_KEY = "__blackout_xrpl_client__";

/** Get (or create) a persistent XRPL client, trying multiple servers. */
export async function getClient(): Promise<xrpl.Client> {
  if (g[CLIENT_KEY] && (g[CLIENT_KEY] as xrpl.Client).isConnected()) {
    return g[CLIENT_KEY];
  }

  let lastError: Error | null = null;

  for (const url of RPC_URLS) {
    try {
      console.log(`[XRPL] Connecting to ${url} (timeout: ${CONNECTION_TIMEOUT_MS}ms)…`);
      const client = new xrpl.Client(url, {
        connectionTimeout: CONNECTION_TIMEOUT_MS,
      });
      await client.connect();
      console.log(`[XRPL] ✓ Connected to ${url}`);
      g[CLIENT_KEY] = client;
      return client;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[XRPL] ✗ Failed to connect to ${url}: ${lastError.message}`);
    }
  }

  throw new Error(
    `Could not connect to any XRPL Testnet server after trying ${RPC_URLS.length} endpoints. ` +
    `Last error: ${lastError?.message ?? "unknown"}. ` +
    `Check your internet connection or try again in a minute.`
  );
}

/** Gracefully disconnect (optional, for cleanup). */
export async function disconnectClient() {
  if (g[CLIENT_KEY]) {
    try {
      await (g[CLIENT_KEY] as xrpl.Client).disconnect();
    } catch {
      /* ignore */
    }
    g[CLIENT_KEY] = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Wallets                                                            */
/* ------------------------------------------------------------------ */

/**
 * XRPL currency codes must be exactly 3 ASCII chars OR a 40-hex-char string.
 * "RLUSD" is 5 chars, so we encode it as hex (ASCII values, zero-padded to 40 chars):
 *   R=52 L=4C U=55 S=53 D=44 → "524C555344" + 30 zero chars
 */
const CURRENCY_CODE = "524C555344000000000000000000000000000000";
/** Human-readable name for display */
export const CURRENCY_DISPLAY = "RLUSD";

/** Get the program (issuer) wallet from env. */
export function getProgramWallet(): xrpl.Wallet {
  const seed = process.env.XRPL_SEED;
  if (!seed) throw new Error("XRPL_SEED not set in environment variables.");
  return xrpl.Wallet.fromSeed(seed.trim());
}

/** Get the issuer address (= program wallet address). */
export function getIssuerAddress(): string {
  const addr = process.env.XRPL_ISSUER;
  if (addr) return addr.trim();
  // Fallback: derive from seed
  return getProgramWallet().address;
}

/**
 * Fund a new Testnet wallet via the faucet.
 * Returns { wallet, balance } with the funded wallet.
 */
export async function fundTestnetWallet(): Promise<{
  wallet: xrpl.Wallet;
  address: string;
  seed: string;
  balance: string;
}> {
  const client = await getClient();
  const fundResult = await client.fundWallet();
  const wallet = fundResult.wallet;
  return {
    wallet,
    address: wallet.address,
    seed: wallet.seed!,
    balance: String(fundResult.balance),
  };
}

/* ------------------------------------------------------------------ */
/*  Trust Line                                                         */
/* ------------------------------------------------------------------ */

/**
 * Create a trust line from `userWallet` to the program wallet (issuer)
 * for the RLUSD token.
 *
 * This is step 1 before the user can receive RLUSD payouts.
 * Follows the XRPL "TrustSet" transaction pattern.
 */
export async function createRLUSDTrustLine(
  userSeed: string,
  limitAmount: string = "10000"
): Promise<xrpl.TxResponse> {
  const client = await getClient();
  const userWallet = xrpl.Wallet.fromSeed(userSeed);
  const issuer = getIssuerAddress();

  const trustSet: xrpl.TrustSet = {
    TransactionType: "TrustSet",
    Account: userWallet.address,
    LimitAmount: {
      currency: CURRENCY_CODE,
      issuer,
      value: limitAmount,
    },
  };

  const prepared = await client.autofill(trustSet);
  const signed = userWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  return result;
}

/* ------------------------------------------------------------------ */
/*  Send RLUSD Payout                                                  */
/* ------------------------------------------------------------------ */

/**
 * Send RLUSD from the program wallet (issuer) to a destination address.
 *
 * This is the "send issued currency" pattern from XRPL docs:
 *   TransactionType: Payment
 *   Amount: { currency: "RLUSD", value: "5.00", issuer: <program address> }
 *   Destination: <user address>
 */
export async function sendRLUSDPayout(opts: {
  destination: string;
  amount: string;
}): Promise<{
  hash: string;
  result: string;
  amount: string;
  destination: string;
}> {
  const client = await getClient();
  const wallet = getProgramWallet();
  const issuer = getIssuerAddress();

  const payment: xrpl.Payment = {
    TransactionType: "Payment",
    Account: wallet.address,
    Amount: {
      currency: CURRENCY_CODE,
      value: opts.amount,
      issuer,
    },
    Destination: opts.destination,
  };

  const prepared = await client.autofill(payment);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  const txResult =
    typeof meta === "object" && meta !== null && "TransactionResult" in meta
      ? (meta as { TransactionResult: string }).TransactionResult
      : "unknown";

  return {
    hash: result.result.hash,
    result: txResult,
    amount: opts.amount,
    destination: opts.destination,
  };
}

/* ------------------------------------------------------------------ */
/*  Balance Check                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get the RLUSD balance for an address.
 * Returns "0" if no trust line exists yet.
 */
export async function getRLUSDBalance(address: string): Promise<string> {
  const client = await getClient();
  const issuer = getIssuerAddress();

  try {
    const response = await client.request({
      command: "account_lines",
      account: address,
      peer: issuer,
    });

    const line = response.result.lines.find(
      (l) => l.currency === CURRENCY_CODE
    );
    return line?.balance ?? "0";
  } catch {
    return "0";
  }
}

/**
 * Get the XRP balance for an address.
 */
export async function getXRPBalance(address: string): Promise<string> {
  const client = await getClient();
  try {
    const response = await client.request({
      command: "account_info",
      account: address,
    });
    return xrpl.dropsToXrp(response.result.account_data.Balance);
  } catch {
    return "0";
  }
}

/**
 * Get recent RLUSD transactions for an address.
 */
export async function getRecentTransactions(
  address: string,
  limit: number = 10
): Promise<
  {
    hash: string;
    type: string;
    amount: string;
    from: string;
    to: string;
    timestamp: string;
  }[]
> {
  const client = await getClient();
  const issuer = getIssuerAddress();

  try {
    const response = await client.request({
      command: "account_tx",
      account: address,
      limit,
    });

    return response.result.transactions
      .filter((tx) => {
        const t = tx.tx_json;
        if (!t || t.TransactionType !== "Payment") return false;
        const amt = t.Amount;
        if (typeof amt === "string") return false; // XRP payment
        return (
          (amt as xrpl.IssuedCurrencyAmount).currency === CURRENCY_CODE &&
          (amt as xrpl.IssuedCurrencyAmount).issuer === issuer
        );
      })
      .map((tx) => {
        const t = tx.tx_json!;
        const amt = t.Amount as xrpl.IssuedCurrencyAmount;
        const closeTime = tx.close_time_iso ?? "";
        return {
          hash: tx.hash ?? "",
          type: t.Account === address ? "SENT" : "RECEIVED",
          amount: amt.value,
          from: t.Account ?? "",
          to: (t as xrpl.Payment).Destination ?? "",
          timestamp: closeTime,
        };
      });
  } catch {
    return [];
  }
}
