import type { Metadata } from "next";
import { getAccountUser } from "./account-auth";
import { headers } from "next/headers";
import { AccessPortal } from "./access-portal";
import { localIdentityByRole, WorkspaceApp } from "./workspace-app";
import type { TeamRole } from "./workspace-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rocket Configuration — Engineering workspace",
  description:
    "A focused engineering workspace connecting OpenRocket models, hardware evidence and revision history.",
};

export default async function Home({ searchParams }: { searchParams?: Promise<{ local_role?: string }> }) {
  const user = await getAccountUser();
  const host = (await headers()).get("host") ?? "";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const roleValue = (await searchParams)?.local_role;
  const localRole: TeamRole | null = roleValue === "lead" || roleValue === "engineer" || roleValue === "viewer" ? roleValue : null;

  if (!user && !(local && localRole)) return <AccessPortal />;

  return (
    <WorkspaceApp user={user ? { name: user.displayName, email: user.email, preview: false } : localIdentityByRole[localRole!]} />
  );
}
