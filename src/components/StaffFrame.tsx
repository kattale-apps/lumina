"use client";

import type { ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { WorkspaceHeader } from "../app/dashboard/workspace";

/**
 * The signed-in person's staff role in their company, or null when they are not staff.
 * Undefined while it is still being looked up.
 */
export function useStaffRole(): string | null | undefined {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewerContext, isAuthenticated ? {} : "skip");
  if (isLoading) return undefined;
  if (!isAuthenticated) return null;
  if (viewer === undefined) return undefined;
  return viewer.state === "active" ? viewer.companies[0]?.role ?? null : null;
}

/**
 * Frame for a staff member on a page that customers also use (the checks, profile,
 * recommendations): the staff header with its Menu, so staff are never left without it.
 */
export function StaffFrame({ role, children }: { role: string; children: ReactNode }) {
  return (
    <div className="shell">
      <WorkspaceHeader role={role} />
      <main className="workspace">{children}</main>
    </div>
  );
}
