import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { documents } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

type UploadEnvironment = { FILES: R2Bucket };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ documents: [] });

  const componentId = new URL(request.url).searchParams.get("componentId");
  if (!componentId) {
    return Response.json({ error: "componentId is required." }, { status: 400 });
  }

  const rows = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, "banshee-mk2"), eq(documents.componentId, componentId)))
    .orderBy(desc(documents.id));

  return Response.json({ documents: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: "Sign in is required to upload evidence." }, { status: 401 });
  }

  const form = await request.formData();
  const componentId = String(form.get("componentId") ?? "").trim();
  const file = form.get("file");

  if (!componentId || !(file instanceof File)) {
    return Response.json({ error: "A component and file are required." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ error: "Files must be 25 MB or smaller." }, { status: 413 });
  }

  const objectKey = `banshee-mk2/${componentId}/${crypto.randomUUID()}-${file.name}`;
  const uploadEnv = env as unknown as UploadEnvironment;
  await uploadEnv.FILES.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const [document] = await getDb()
    .insert(documents)
    .values({
      projectId: "banshee-mk2",
      componentId,
      fileName: file.name,
      objectKey,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedByName: user.displayName,
      uploadedByEmail: user.email,
    })
    .returning();

  return Response.json({ document }, { status: 201 });
}
