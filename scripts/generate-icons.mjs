import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'apps/extension/public/icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = rowStart + 1 + x * 4;
      raw[target] = pixels[source];
      raw[target + 1] = pixels[source + 1];
      raw[target + 2] = pixels[source + 2];
      raw[target + 3] = pixels[source + 3];
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSqr = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSqr));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = size * 0.24;
  const samples = 4;
  const half = size / 2;
  const strokeHalf = size * 0.055;
  const start = { x: size * 0.3, y: size * 0.7 };
  const end = { x: size * 0.7, y: size * 0.3 };
  const headA = { x: size * 0.7, y: size * 0.3 };
  const headB = { x: size * 0.7, y: size * 0.52 };
  const headC = { x: size * 0.48, y: size * 0.3 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inside = 0;
      let stroke = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          // rounded rectangle mask
          const dx = Math.max(Math.abs(px - half) - (half - radius), 0);
          const dy = Math.max(Math.abs(py - half) - (half - radius), 0);
          if (Math.hypot(dx, dy) <= radius) inside += 1;
          const d = Math.min(
            distanceToSegment(px, py, start.x, start.y, end.x, end.y),
            distanceToSegment(px, py, headA.x, headA.y, headB.x, headB.y),
            distanceToSegment(px, py, headA.x, headA.y, headC.x, headC.y),
          );
          if (d <= strokeHalf) stroke += 1;
        }
      }
      const total = samples * samples;
      const alpha = inside / total;
      const offset = (y * size + x) * 4;
      if (alpha === 0) continue;
      const t = Math.min(1, Math.max(0, (x + y) / (size * 2)));
      const r = Math.round(79 + (46 - 79) * t);
      const g = Math.round(141 + (230 - 141) * t);
      const b = Math.round(255 + (168 - 255) * t);
      const strokeAlpha = stroke / total;
      const mix = Math.min(1, strokeAlpha * 1.15);
      pixels[offset] = Math.round(r + (255 - r) * mix);
      pixels[offset + 1] = Math.round(g + (255 - g) * mix);
      pixels[offset + 2] = Math.round(b + (255 - b) * mix);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = resolve(outDir, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  process.stdout.write(`icons: wrote ${file}\n`);
}
