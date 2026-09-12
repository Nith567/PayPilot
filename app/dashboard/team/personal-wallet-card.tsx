"use client";

import { useMemo, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  toHex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { getChain, addressUrl, txUrl } from "@/lib/chain";
import { Badge, Button, Card, CopyAddr, Field, inputCls } from "@/app/ui";

// The member's personal Privy embedded wallet: balances, deposit address,
// and a Send flow (ETH or USDC to any address) signed by their own key.
export function PersonalWalletCard() {
  const { wallets } = useWallets();
  const wallet = wallets.find(
    (w) => w.walletClientType === "privy" && w.type === "ethereum",
  );

  const chain = getChain();
  const publicClient = useMemo(
    () => createPublicClient({ chain: baseSepolia, transport: http(chain.rpcUrl) }),
    [chain.rpcUrl],
  );

  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = async () => {
    if (!wallet) return;
    try {
      const [eth, usdc] = await Promise.all([
        publicClient.getBalance({ address: wallet.address as `0x${string}` }),
        publicClient.readContract({
          address: chain.usdcAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.address as `0x${string}`],
        }),
      ]);
      setEthBalance(eth as bigint);
      setUsdcBalance(usdc as bigint);
    } catch {
      /* RPC hiccup — balances stay stale */
    }
  };

  // Initial balance load (lazy state initializer runs once on mount).
  useState(() => {
    void loadBalances();
  });

  const send = async () => {
    if (!wallet) return;
    setSending(true);
    setError(null);
    setTxHash(null);
    try {
      const provider = await wallet.getEthereumProvider();
      const to =
        asset === "ETH"
          ? (recipient as `0x${string}`)
          : (chain.usdcAddress as `0x${string}`);
      const value = asset === "ETH" ? toHex(parseEther(amount)) : "0x0";
      const data =
        asset === "USDC"
          ? encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [recipient as `0x${string}`, parseUnits(amount, 6)],
            })
          : "0x";

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to, value, data }],
      })) as string;
      setTxHash(hash);
      setAmount("");
      setRecipient("");
      await loadBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Your personal wallet</h3>
          <p className="mt-1 text-xs text-muted">
            Your Privy embedded wallet — deposit here, then send into any org
            wallet.
          </p>
        </div>
        <Badge tone="blue">Base Sepolia</Badge>
      </div>

      {wallet ? (
        <>
          <div className="mt-4 rounded-lg border border-line bg-surface2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-sm break-all">{wallet.address}</span>
              <div className="flex items-center gap-3">
                <CopyAddr address={wallet.address} />
                <a
                  className="text-xs text-muted hover:text-foreground"
                  href={addressUrl(wallet.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  explorer ↗
                </a>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <span>
                {usdcBalance == null
                  ? "$…"
                  : `$${formatUnits(usdcBalance, 6)} USDC`}
              </span>
              <span className="text-muted">
                {ethBalance == null
                  ? "…"
                  : `${formatEther(ethBalance).slice(0, 8)} ETH`}
              </span>
              <button
                onClick={loadBalances}
                className="text-xs text-accent hover:underline"
              >
                refresh
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">
              Top up with free test USDC at{" "}
              <a
                className="text-accent hover:underline"
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
              >
                faucet.circle.com ↗
              </a>
            </p>
          </div>

          {showSend ? (
            <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
              <p className="text-sm font-semibold text-accent">Send</p>
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  {(["USDC", "ETH"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => setAsset(a)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        asset === a
                          ? "border-accent/60 bg-accent/10 text-accent"
                          : "border-line bg-surface2 text-muted hover:text-foreground"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <Field label="Recipient address">
                  <input
                    className={inputCls}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="0x…"
                  />
                </Field>
                <Field label={`Amount (${asset})`}>
                  <input
                    className={inputCls}
                    type="number"
                    min="0"
                    step="0.000001"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={asset === "USDC" ? "e.g. 50" : "e.g. 0.01"}
                  />
                </Field>
                {txHash ? (
                  <a
                    className="block rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:underline"
                    href={txUrl(txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ✓ Sent — {txHash.slice(0, 14)}… ↗
                  </a>
                ) : null}
                {error ? (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    {error}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    disabled={sending || !recipient || !amount}
                    onClick={send}
                    className="flex-1"
                  >
                    {sending ? "Sending…" : `Send ${asset}`}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowSend(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setShowSend(true)}>Send</Button>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">
          No embedded wallet on this account yet — it&apos;s created on your
          first Privy login; if it doesn&apos;t appear, check the Privy
          dashboard&apos;s embedded-wallets setting.
        </p>
      )}
    </Card>
  );
}
