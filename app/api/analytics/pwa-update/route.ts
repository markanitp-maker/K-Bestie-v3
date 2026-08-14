import { handlePwaUpdatePost } from "./routeHandler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handlePwaUpdatePost(request);
}
