"use client";

import { useCallback, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

// Browser-side API helper: attaches the Privy id token to every request so
// server routes can verify the session (lib/auth.ts).

export async function apiFetch(
  path: string,
  token: string | null,
  init?: RequestInit,
  // API responses are plain JSON documents — callers destructure specific fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data;
}

// Returns a fetch-like function bound to the current Privy session token.
export function useApi() {
  const { getAccessToken } = usePrivy();
  const tokenRef = useRef<string | null>(null);

  return useCallback(
    async (path: string, init?: RequestInit) => {
      if (!tokenRef.current) {
        tokenRef.current = await getAccessToken();
      }
      return apiFetch(path, tokenRef.current, init);
    },
    [getAccessToken],
  );
}
