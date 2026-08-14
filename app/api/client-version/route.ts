import {
  handleClientVersionGet,
  handleClientVersionPost,
} from "./routeHandler";

export const runtime = "nodejs";

export async function GET() {
  return handleClientVersionGet();
}

export async function POST(request: Request) {
  return handleClientVersionPost(request);
}
