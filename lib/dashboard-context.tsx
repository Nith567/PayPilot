"use client";

import { createContext, useContext } from "react";
import type { MemberDoc, MemberRole, OrgDoc, VendorDoc, WalletDoc } from "./types";

export interface OrgContextValue {
  org: OrgDoc | null;
  wallets: WalletDoc[];
  vendors: VendorDoc[];
  members: MemberDoc[];
  myRole: MemberRole | null;
  refresh: () => Promise<void>;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside the dashboard layout");
  return ctx;
}
