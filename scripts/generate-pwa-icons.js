const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_IMAGE = path.join(__dirname, '../public/Images/logo/favicon.png');
const OUT_DIR = path.join(__dirname, '../public/icons');
const BG_COLOR = '#1A6B5A';

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function generateIcon(filename, size, mascotRatio) {
  const mascotSize = Math.round(size * mascotRatio);
  const outPath = path.join(OUT_DIR, filename);

  // Resize mascot
  const mascotBuffer = await sharp(SOURCE_IMAGE)
    .resize({ width: mascotSize, height: mascotSize, fit: 'inside' })
    .toBuffer();

  // Create canvas and composite
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG_COLOR
    }
  })
  .composite([
    {
      input: mascotBuffer,
      gravity: 'center'
    }
  ])
  .png()
  .toFile(outPath);

  // Verify
  const stats = fs.statSync(outPath);
  const metadata = await sharp(outPath).metadata();
  
  if (metadata.width !== size || metadata.height !== size) {
    throw new Error(`${filename} size mismatch: expected ${size}x${size}, got ${metadata.width}x${metadata.height}`);
  }
  
  return {
    filename,
    sizeBytes: stats.size,
    width: metadata.width,
    height: metadata.height
  };
}

async function main() {
  try {
    const results = [];
    results.push(await generateIcon('icon-192.png', 192, 0.80));
    results.push(await generateIcon('icon-512.png', 512, 0.80));
    results.push(await generateIcon('maskable-icon-192.png', 192, 0.60));
    results.push(await generateIcon('maskable-icon-512.png', 512, 0.60));
    results.push(await generateIcon('apple-touch-icon-180.png', 180, 0.75));
    results.push(await generateIcon('favicon-32.png', 32, 0.80));
    results.push(await generateIcon('favicon-16.png', 16, 0.80));
    
    console.log("=== Verification Results ===");
    for (const r of results) {
      if (r.sizeBytes === 0) throw new Error(`${r.filename} is empty`);
      console.log(`${r.filename}: ${r.sizeBytes} bytes, ${r.width}x${r.height}`);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
