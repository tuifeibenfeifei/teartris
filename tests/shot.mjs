#!/usr/bin/env node
/**
 * 用真实渲染路径生成一张新截图（不需要浏览器）：
 *
 *   node tests/shot.mjs [输出.json]
 *
 * 做法：用 tests/dom-stub.mjs 把游戏跑起来，读取 index.html 真正加载的示例图，
 * 然后让内置 AI 真的玩几十步（走的是 hardDrop → lock → 撕纸 这条真实链路），
 * 最后录制**一帧**完整的 Canvas 指令序列，交给 tools/replay.py 出 PNG。
 *
 * 好处：截图内容和游戏代码永远一致；渲染一旦画错，人眼在 PR 里就能看出来。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './dom-stub.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'last-frame.json');

/** 从文件头读出图片真实尺寸（够 coverRect 用），不依赖任何图像库 */
function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  throw new Error('认不出图片格式：' + file);
}

// ---- 准备沙箱：示例图按真实文件尺寸“加载” ----
const rel = src => path.resolve(ROOT, String(src).replace(/^\/+/, ''));
const { sandbox } = createSandbox({
  devicePixelRatio: 2,
  origin: 'http://localhost',
  imageFor(src) {
    const file = rel(src);
    if (!fs.existsSync(file)) return null;
    const size = imageSize(file);
    return { width: size.width, height: size.height, __origin: path.relative(ROOT, file).split(path.sep).join('/') };
  }
});

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'index.html<script>' });

const api = sandbox.__teartris;
if (!api) throw new Error('游戏没有启动成功，拿不到 __teartris 接口');

// ---- 等示例图加载完（桩里用 setTimeout 模拟异步） ----
await new Promise(r => setTimeout(r, 50));
const st = api.getState();
const imgA = sandbox.document.getElementById('board') && true;
console.log('示例图：', sandbox.__loadedImages ? '' : '(由桩接管)');

// ---- 让内置 AI 真的玩：每 0.7 秒落一块，直到撕开 5 层 ----
const TARGET = Number(process.env.TEARS || 5);
let t = 1000;
let placed = 0;
while (st.revealed < TARGET && placed < 220) {
  const pick = api.botPick();
  if (pick && st.piece) {
    for (let i = st.piece.rot; i !== pick.rot; i = (i + 1) % 4) { if (!api.rotate(1)) break; }
    let guard = 0;
    while (st.piece.x < pick.px && guard++ < 14) { if (!api.move(1, 0)) break; }
    guard = 0;
    while (st.piece.x > pick.px && guard++ < 14) { if (!api.move(-1, 0)) break; }
    api.hardDrop();
    placed++;
  }
  t += 700;
  sandbox.__now = t;
  api.frame(t);
  if (st.over) { api.newGame(); }
}
console.log(`AI 落子 ${placed} 次，撕开 ${st.revealed} / ${st.torn.length} 层，得分 ${st.score}`);

// ---- 录制最后一帧：先清空录制，再跑一帧 ----
const board = sandbox.document.getElementById('board');
const ctx = board.getContext('2d');
ctx.ops.length = 0;
ctx.gradients.length = 0;
t += 16;
sandbox.__now = t;
api.frame(t);
const ops = ctx.ops;

// 把画布逻辑尺寸、渐变定义和示例图尺寸一起写出去，重放时用得上
const meta = {
  board: { w: 340, h: 680 },
  dpr: sandbox.devicePixelRatio,
  gradients: ctx.gradients,
  images: {},
  revealed: st.revealed,
  score: st.score,
  lines: st.lines,
  level: st.level,
  ops
};
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  const p = path.join(ROOT, 'assets', f);
  const size = imageSize(p);
  meta.images[f] = { w: size.width, h: size.height };
}

fs.writeFileSync(OUT, JSON.stringify(meta));
console.log(`已写出 ${path.relative(ROOT, OUT)}（${ops.length} 条绘制指令）`);
