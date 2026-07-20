const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '../public/icons/favicon-32.png');
const icoPath = path.join(__dirname, '../app/favicon.ico');

if (!fs.existsSync(pngPath)) {
  console.error(`PNG source not found at ${pngPath}`);
  process.exit(1);
}

const pngData = fs.readFileSync(pngPath);

// Create ICO header (22 bytes total: 6 bytes ICONDIR + 16 bytes ICONDIRENTRY)
const header = Buffer.alloc(22);

// ICONDIR (6 bytes)
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type (1 = ICO)
header.writeUInt16LE(1, 4); // count (1 image)

// ICONDIRENTRY (16 bytes)
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // colorCount
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bitCount
header.writeUInt32LE(pngData.length, 14); // bytesInRes
header.writeUInt32LE(22, 18); // imageOffset

const icoData = Buffer.concat([header, pngData]);

fs.writeFileSync(icoPath, icoData);
console.log(`Generated app/favicon.ico with size: ${icoData.length} bytes`);
