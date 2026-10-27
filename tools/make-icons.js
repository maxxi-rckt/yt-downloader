// Renders the extension icons (rounded gradient square + download arrow) to PNG without dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'extension', 'icons');

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// signed distance helpers, in a 0..1 coordinate space
const sdRoundBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSegment = (x, y, ax, ay, bx, by, r) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * h, py - dy * h) - r;
};

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling
  const stroke = size <= 16 ? 0.075 : 0.062;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        if (sdRoundBox(x, y, 0.5, 0.5, 0.47, 0.47, 0.22) > 0) continue;
        // diagonal gradient #ff3b4e -> #ff7a45
        const t = (x + y) / 2;
        let cr = 255, cg = 59 + (122 - 59) * t, cb = 78 + (69 - 78) * t;
        const glyph = Math.min(
          sdSegment(x, y, 0.5, 0.22, 0.5, 0.6, stroke),
          sdSegment(x, y, 0.5, 0.62, 0.33, 0.45, stroke),
          sdSegment(x, y, 0.5, 0.62, 0.67, 0.45, stroke),
          sdSegment(x, y, 0.27, 0.78, 0.73, 0.78, stroke),
        );
        if (glyph < 0) { cr = 255; cg = 255; cb = 255; }
        r += cr; g += cg; b += cb; a++;
      }
      const i = (py * size + px) * 4;
      if (a) {
        buf[i] = r / a; buf[i + 1] = g / a; buf[i + 2] = b / a;
        buf[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return png(size, buf);
}

for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(OUT, `${s}.png`), render(s));
console.log('icons written to', OUT);
