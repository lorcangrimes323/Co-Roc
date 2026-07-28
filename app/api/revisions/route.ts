import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { revisions } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ revisions: [] });

  const rows = await getDb()
    .select()
    .from(revisions)
    .orderBy(desc(revisions.id))
    .limit(20);

  return Response.json({ revisions: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: "Sign in is required to create a revision." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    title?: string;
    componentId?: string;
    componentCode?: string;
  };
  const title = payload.title?.trim();
  const componentId = payload.componentId?.trim();
  const componentCode = payload.componentCode?.trim();

  if (!title || !componentId || !componentCode) {
    return Response.json({ error: "Revision details are incomplete." }, { status: 400 });
  }

  const [revision] = await getDb()
    .insert(revisions)
    .values({
      projectId: "banshee-mk2",
      title,
      componentId,
      componentCode,
      authorName: user.displayName,
      authorEmail: user.email,
    })
    .returning();

  return Response.json({ revision }, { status: 201 });
}
