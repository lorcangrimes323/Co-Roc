import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { MissionControl } from "./mission-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rocket Configuration — Engineering workspace",
  description:
    "A focused engineering workspace connecting OpenRocket models, hardware evidence and revision history.",
};

export default async function Home() {
  const user = await getChatGPTUser();

  return (
    <MissionControl
      user={{
        name: user?.displayName ?? "Lorcan Grimes",
        email: user?.email ?? "local.preview@rocket-configuration.dev",
        preview: !user,
      }}
    />
  );
}
