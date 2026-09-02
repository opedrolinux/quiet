/**
 * Renders the Quiet app icon to a 1024x1024 PNG with no image dependencies.
 *
 * The mark is the app's own idea drawn small: a dark glass tile holding one
 * blue bar (the first line, which is always the title) above three plain grey
 * ones. Nothing else — same rule as the interface.
 *
 * Run: node scripts/make-icon.mjs   then: pnpm tauri icon src-tauri/icons/source.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SIZE = 1024;
const SS = 3; // supersample factor; 3x is plenty for these shapes
const N = SIZE * SS;

/** Signed "inside" test for a rounded rectangle, in supersampled units. */
function inRounded(px, py, x, y, w, h, r) {
  // Clamp to the rectangle inset by r, then test against that corner circle.
  // This one expression covers the flat edges and the corners alike.
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return Math.hypot(px - cx, py - cy) <= r;
}

const S = (v) => v * SS; // design units (1024 space) -> supersampled

const TILE = { x: S(24), y: S(24), w: S(976), h: S(976), r: S(216) };
const BORDER = S(6);

const BLUE = [0x3b, 0x6f, 0xd4];
const GREY = [0x9a, 0x9a, 0x96];

// One blue title bar, three grey body bars. Widths taper the way real notes do.
const BARS = [
  { x: 252, y: 300, w: 520, h: 88, r: 44, c: BLUE, a: 1.0 },
  { x: 252, y: 470, w: 520, h: 54, r: 27, c: GREY, a: 0.62 },
  { x: 252, y: 566, w: 428, h: 54, r: 27, c: GREY, a: 0.52 },
  { x: 252, y: 662, w: 316, h: 54, r: 27, c: GREY, a: 0.42 },
].map((b) => ({ ...b, x: S(b.x), y: S(b.y), w: S(b.w), h: S(b.h), r: S(b.r) }));

// Accumulate premultiplied colour + alpha per output pixel, averaged over SSxSS.
const acc = new Float64Array(SIZE * SIZE * 4);

for (let sy = 0; sy < N; sy++) {
  for (let sx = 0; sx < N; sx++) {
    const inTile = inRounded(sx + 0.5, sy + 0.5, TILE.x, TILE.y, TILE.w, TILE.h, TILE.r);
    if (!inTile) continue;

    // Vertical gradient, lighter at the top like glass catching light.
    const t = (sy - TILE.y) / TILE.h;
    let r = 0x22 - 12 * t;
    let g = 0x22 - 12 * t;
    let b = 0x28 - 14 * t;
    let a = 1;

    // Hairline rim, same idea as the window's 1px border.
    const inInner = inRounded(
      sx + 0.5, sy + 0.5,
      TILE.x + BORDER, TILE.y + BORDER,
      TILE.w - BORDER * 2, TILE.h - BORDER * 2,
      TILE.r - BORDER,
    );
    if (!inInner) { r = 0x4a; g = 0x4a; b = 0x52; }

    for (const bar of BARS) {
      if (inRounded(sx + 0.5, sy + 0.5, bar.x, bar.y, bar.w, bar.h, bar.r)) {
        r = r * (1 - bar.a) + bar.c[0] * bar.a;
        g = g * (1 - bar.a) + bar.c[1] * bar.a;
        b = b * (1 - bar.a) + bar.c[2] * bar.a;
      }
    }

    const i = ((sy / SS) | 0) * SIZE + ((sx / SS) | 0);
    acc[i * 4] += r; acc[i * 4 + 1] += g; acc[i * 4 + 2] += b; acc[i * 4 + 3] += a;
  }
}

const px = Buffer.alloc(SIZE * SIZE * 4);
const per = SS * SS;
for (let i = 0; i < SIZE * SIZE; i++) {
  const cov = acc[i * 4 + 3] / per;
  if (cov <= 0) continue;
  // Divide colour by coverage, not by the sample count: edge pixels averaged
  // against nothing would otherwise darken into a grey fringe.
  px[i * 4] = Math.round(acc[i * 4] / (cov * per));
  px[i * 4 + 1] = Math.round(acc[i * 4 + 1] / (cov * per));
  px[i * 4 + 2] = Math.round(acc[i * 4 + 2] / (cov * per));
  px[i * 4 + 3] = Math.round(cov * 255);
}

// --- minimal PNG writer --------------------------------------------------

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const byte of buf) c = t[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/source.png", png);
console.log(`wrote src-tauri/icons/source.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
