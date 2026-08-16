import fs from "fs";
// 16kHz mono 16-bit PCM WAV, alternating 3s tone / 3s silence, 60s total.
const SR = 16000, TOTAL = 60, seg = 3;
const n = SR * TOTAL;
const data = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const seance = Math.floor(t / seg) % 2 === 0; // tone on even segments
  let v = 0;
  if (seance) {
    // amplitude-modulated tone to mimic speech energy above VAD threshold
    v = Math.sin(2 * Math.PI * 220 * t) * (0.35 + 0.25 * Math.sin(2 * Math.PI * 4 * t));
  }
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
const out = process.argv[2] || "/tmp/fake-speech.wav";
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log("wrote", out, (44 + data.length), "bytes");
