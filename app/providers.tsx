"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia, base } from "viem/chains";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmtvhmmaj00fq0cjpezss9his";
  // PrivyProvider renders client-only markup and initializes against
  // Privy's API — it must never render during SSR/prerender (it crashes
  // the Vercel build sandbox). Gate the whole tree on hydration.
  const [mounted, setMounted] = useState(false);
  // Deliberate one-shot post-hydration flag (the canonical mounted-gate
  // pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="min-h-screen" />;
  }

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
      {children}
    </PrivyProvider>
  );
}
