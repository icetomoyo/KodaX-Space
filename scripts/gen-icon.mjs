// 生成 1024x1024 PNG + Windows 多尺寸 ICO icon——纯色 + 居中字母 K，避免引依赖。
//
// 为什么自己拼 PNG 而不是 import canvas / sharp：
//   - sharp 是 native，安装失败概率高（同 keytar 课）
//   - 这只是 alpha 的占位 icon，v0.1.5 会替换成真实设计资源
//   - PNG 文件结构足够简单——纯色 raster + CRC32，自己 60 行能写出来
//
// 输出：resources/icon.png + resources/icon.ico。macOS 仍由 electron-builder 从 PNG
// 生成 icns；Windows 直接使用多尺寸 ICO，避免 portable 外层启动器仅含单个
// 256px PNG entry 时在部分 Explorer / 缩放组合下显示不稳定。
//
// 一次性脚本：跑 `node scripts/gen-icon.mjs` 重新生成。CI 里也跑一次。
// resources/icon.png 是确定性输出（无时间戳/随机数），已提交到仓库（README 在
// GitHub 上直接引用它）；.ico/.icns 仍由构建生成，不 check-in 二进制。

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PNG_SIZE = 1024;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// CRC32 表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// IHDR: width, height, bit_depth=8, color_type=2 (RGB), compression=0, filter=0, interlace=0
function ihdr(w, h) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(w, 0);
  buf.writeUInt32BE(h, 4);
  buf[8] = 8;
  buf[9] = 2;
  buf[10] = 0;
  buf[11] = 0;
  buf[12] = 0;
  return chunk('IHDR', buf);
}

// raster: 每行前置 1 byte filter (0=None) + RGB triplets
// 设计：深背景 #18181b (zinc-900) + 一个粗体 "K" 字母（用大色块画近似形状，不抗锯齿）
function buildRaster(size) {
  const stride = size * 3;
  const rows = Buffer.alloc(size * (1 + stride));
  // K 字形的 bounding box（居中、size/3 宽、size*0.6 高）
  const kx0 = Math.floor(size * 0.32); // 左边竖杠左边界
  const kxBarRight = Math.floor(size * 0.42); // 左边竖杠右边界
  const kxRight = Math.floor(size * 0.68); // 右斜上下角端
  const ky0 = Math.floor(size * 0.22);
  const ky1 = Math.floor(size * 0.78);
  const kymid = Math.floor(size * 0.5);

  // BG / FG（零依赖：BG 深灰 + FG kodax-绿）
  const bg = [0x18, 0x18, 0x1b]; // zinc-900
  const fg = [0x10, 0xb9, 0x81]; // emerald-500

  function isOnK(x, y) {
    // 左竖杠
    if (x >= kx0 && x < kxBarRight && y >= ky0 && y <= ky1) return true;
    // 上斜杠：从 (kxBarRight, kymid) 到 (kxRight, ky0)
    if (y >= ky0 && y < kymid) {
      const t = (kymid - y) / (kymid - ky0);
      const xline = kxBarRight + t * (kxRight - kxBarRight);
      if (Math.abs(x - xline) < size * 0.05 && x >= kxBarRight && x <= kxRight + 8) return true;
    }
    // 下斜杠：从 (kxBarRight, kymid) 到 (kxRight, ky1)
    if (y >= kymid && y <= ky1) {
      const t = (y - kymid) / (ky1 - kymid);
      const xline = kxBarRight + t * (kxRight - kxBarRight);
      if (Math.abs(x - xline) < size * 0.05 && x >= kxBarRight && x <= kxRight + 8) return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    rows[y * (1 + stride)] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const offset = y * (1 + stride) + 1 + x * 3;
      const c = isOnK(x, y) ? fg : bg;
      rows[offset] = c[0];
      rows[offset + 1] = c[1];
      rows[offset + 2] = c[2];
    }
  }
  return rows;
}

function buildPng(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const raster = buildRaster(size);
  const compressed = deflateSync(raster);
  return Buffer.concat([
    sig,
    ihdr(size, size),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, png: buildPng(size) }));
  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO image
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(entrySize * images.length);
  for (let i = 0; i < images.length; i++) {
    const { size, png } = images[i];
    const offset = i * entrySize;
    directory[offset] = size === 256 ? 0 : size;
    directory[offset + 1] = size === 256 ? 0 : size;
    directory[offset + 2] = 0; // true color
    directory[offset + 3] = 0;
    directory.writeUInt16LE(1, offset + 4); // color planes
    directory.writeUInt16LE(32, offset + 6); // bits per pixel
    directory.writeUInt32LE(png.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += png.length;
  }

  return Buffer.concat([header, directory, ...images.map(({ png }) => png)]);
}

const outDir = resolve(__dirname, '..', 'resources');
mkdirSync(outDir, { recursive: true });
const png = buildPng(PNG_SIZE);
const pngPath = resolve(outDir, 'icon.png');
const ico = buildIco(ICO_SIZES);
const icoPath = resolve(outDir, 'icon.ico');
writeFileSync(pngPath, png);
writeFileSync(icoPath, ico);
console.log(`[gen-icon] wrote ${pngPath} (${png.length} bytes, ${PNG_SIZE}x${PNG_SIZE})`);
console.log(`[gen-icon] wrote ${icoPath} (${ico.length} bytes, ${ICO_SIZES.join('/')}px)`);
