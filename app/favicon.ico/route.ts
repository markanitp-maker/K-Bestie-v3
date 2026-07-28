import { readFile } from "fs/promises";
import path from "path";
import { getPwaIcons } from "@/lib/pwaIcons";

export const runtime = "nodejs";

// 정적 app/favicon.ico를 이 라우트로 대체한 이유: Next.js의 app/favicon.ico 특수 파일
// 규칙은 항상 같은 파일 하나만 서빙하므로 환경별 분기가 불가능하다. 기존 PNG를 그대로
// ICO 컨테이너로 감싸기만 하던 scripts/generate-favicon-ico.js와 동일한 무손실 래핑
// 로직을 재사용해, 환경에 맞는 기존 PNG(재가공 없음)를 요청 시점에 ICO로 감싸 반환한다.
function wrapPngAsIco(pngData: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type (1 = ICO)
  header.writeUInt16LE(1, 4); // count (1 image)
  header.writeUInt8(size, 6); // width
  header.writeUInt8(size, 7); // height
  header.writeUInt8(0, 8); // colorCount
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bitCount
  header.writeUInt32LE(pngData.length, 14); // bytesInRes
  header.writeUInt32LE(22, 18); // imageOffset
  return Buffer.concat([header, pngData]);
}

export async function GET() {
  const icons = getPwaIcons();
  // favicon32는 "/icons/xxx.png" 형태 public 경로이므로 실제 파일시스템 경로로 변환한다.
  const pngPath = path.join(process.cwd(), "public", icons.favicon32);
  const size = icons.favicon32.includes("-v4") ? 192 : 32;
  const pngData = await readFile(pngPath);
  const icoData = wrapPngAsIco(pngData, size);

  return new Response(new Uint8Array(icoData), {
    headers: {
      "Content-Type": "image/x-icon",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
