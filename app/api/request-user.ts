import { getChatGPTUser } from "../chatgpt-auth";

export type RequestUser = {
  displayName: string;
  email: string;
  fullName: string | null;
  preview: boolean;
  previewRole: "lead" | "engineer" | "viewer" | null;
};

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const authenticated = await getChatGPTUser();
  if (authenticated) return { ...authenticated, preview: false, previewRole: null };

  const url = new URL(request.url);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  const displayName = request.headers.get("x-local-preview-name")?.trim() || "Local engineer";
  const email = request.headers.get("x-local-preview-email")?.trim() || "local.preview@rocket-configuration.dev";
  const requestedRole = request.headers.get("x-local-preview-role");
  const previewRole = requestedRole === "engineer" || requestedRole === "viewer" ? requestedRole : "lead";
  return { displayName, email, fullName: displayName, preview: true, previewRole };
}
