"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia, base } from "viem/chains";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  // PrivyProvider renders client-only markup (modals, portals) — mounting it
  // after hydration avoids the SSR/client attribute mismatch warning.
  const [mounted, setMounted] = useState(false);
  // Deliberate one-shot post-hydration flag (the canonical mounted-gate
  // pattern) — required to avoid SSR/client mismatch inside PrivyProvider.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!appId) {
    return (
      <>
        <div className="sticky top-0 z-50 bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-300 border-b border-amber-500/30">
          NEXT_PUBLIC_PRIVY_APP_ID is not set — copy .env.example to .env.local
          and add your Privy app credentials.
        </div>
        {children}
      </>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#10b981" },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, base],
      }}
    >
      {mounted ? children : <div className="min-h-screen" />}
    </PrivyProvider>
  );
}
