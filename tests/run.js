#!/usr/bin/env node
/**
 * TearTris 测试 —— 不需要浏览器，直接跑：
 *
 *   node tests/run.js
 *
 * 一共两轮：
 *   ① 纯逻辑：把 index.html 里的游戏代码抠出来、裁掉只服务浏览器的 boot() 段，
 *      在 Node 的 vm 里执行，对消行 / 撕纸 / SRS / 计分下断言。
 *   ② 模拟 DOM 冒烟测试：给同一个脚本装上一套极简 DOM/Canvas 桩，让 boot() 真正
 *      跑起来，然后手动驱动主循环与落子，验证「消行 → 撕纸 → 计分」这条链路。
 *
 * 这样游戏本体可以继续是「单文件、双击即玩」，同时核心规则有回归测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'index.html');

// ---------------------------------------------------------------- 提取脚本
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 1) {
  console.error(`✗ index.html 里应当恰好有 1 个内联 <script>，实际 ${scripts.length} 个`);
  process.exit(1);
}
const fullCode = scripts[0];
const BOOT_MARK = 'if (isBrowser) boot();';
const bootStart = fullCode.indexOf('function boot(){');
const bootEnd = fullCode.lastIndexOf(BOOT_MARK);
if (bootStart < 0 || bootEnd < 0 || bootEnd < bootStart) {
  console.error('✗ 找不到 boot() 的边界，测试无法安全地裁剪浏览器代码');
  process.exit(1);
}

/** 顶层 const/let 不会成为 vm 沙箱的属性，因此显式导出一份给测试用 */
const LOGIC_EXPORTS = [
  'COLS', 'ROWS', 'CELL', 'BD_W', 'BD_H', 'MINI', 'MINI_PAD', 'MAX_IMAGE_EDGE',
  'EDGE_SEGMENTS', 'PIECES', 'TYPES', 'KICKS_I', 'KICKS_JLSTZ', 'LINE_SCORES',
  'mulberry32', 'hexToRgb', 'shade', 'clamp', 'rotateShape', 'shapeCells',
  'shapeBounds', 'centeredPose', 'compact', 'fullRows', 'collides', 'dropDistance',
  'emptyGrid', 'tornCount', 'dropIntervalFor', 'edgeCache', 'edgeOffsets', 'traceJagged',
  'refillBag', 'nextType'
];
const logicCode =
  fullCode.slice(0, bootStart) +
  'var BROWSER_BOOT_STRIPPED = true;\n' +
  fullCode.slice(bootEnd + BOOT_MARK.length) +
  `\n;(${JSON.stringify(LOGIC_EXPORTS)}).forEach(function(k){ globalThis[k] = eval(k); });\n`;

const logicSandbox = { console };
vm.createContext(logicSandbox);
try {
  vm.runInContext(logicCode, logicSandbox, { filename: 'index.html<script>' });
} catch (err) {
  console.error('✗ 游戏逻辑执行失败：', (err && err.stack) || err);
  process.exit(1);
}
if (logicSandbox.BROWSER_BOOT_STRIPPED !== true) {
  console.error('✗ 裁剪后的代码没有执行到预期位置');
  process.exit(1);
}
const missing = LOGIC_EXPORTS.filter(k => logicSandbox[k] === undefined);
if (missing.length) {
  console.error('✗ 这些逻辑单元在 index.html 里找不到：', missing.join(', '));
  process.exit(1);
}

const {
  COLS, ROWS, CELL, LINE_SCORES, TYPES, PIECES, KICKS_I, KICKS_JLSTZ,
  compact, fullRows, collides, dropDistance, emptyGrid, tornCount,
  rotateShape, shapeCells, shapeBounds, centeredPose, dropIntervalFor,
  edgeOffsets, clamp
} = logicSandbox;

// ---------------------------------------------------------------- 断言工具
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    const message = (err && err.message) || String(err);
    failures.push({ name, message });
    process.stdout.write(`  ✗ ${name}\n      ${message}\n`);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || '值不相等'}：实际 ${a}，期望 ${b}`);
}
function ok(value, message) {
  if (!value) throw new Error(message || '断言失败');
}
function section(title) {
  process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------- 夹具
function makeGrid(fill) {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => (fill ? fill(r, c) : null)));
}
function makeTorn(indices) {
  const torn = new Array(ROWS).fill(false);
  for (const r of indices || []) torn[r] = true;
  return torn;
}
/** 复刻 lock() 里的消行流程，用来验证 grid 与 torn 是否同步压缩 */
function lockRows(grid, torn, cleared) {
  compact(grid, torn, cleared);
  return { revealed: tornCount(torn) };
}

// ================================================================
// 第一轮：纯逻辑
// ================================================================
section(`TearTris 逻辑测试 · index.html（${ROWS}×${COLS}）`);

section('撕纸：消行后纸固定、内容下落');
check('消掉最底一行后，撕口留在纸上、上面的内容整体下移一格', () => {
  const grid = makeGrid();
  const torn = makeTorn();
  grid[19] = new Array(COLS).fill('L');
  grid[18][0] = 'T';
  lockRows(grid, torn, [19]);
  ok(torn[0] === true, '撕口应当落到第 0 行（纸的顶部）');
  eq(tornCount(torn), 1, '撕开的行数');
  ok(grid[19][0] === 'T', '第 18 行的内容应当随之下落到第 19 行');
  ok(grid[18].every(v => v === null), '腾出来的第 18 行应当是空的');
});

check('grid 与 torn 同步压缩：撕口不会跟它对应的图案错位（回归 Bug）', () => {
  const grid = makeGrid();
  const torn = makeTorn();
  grid[5][3] = 'S';
  torn[5] = true;                                 // 第 5 行先被撕开
  grid[4][3] = 'Z';                               // 撕口上方的内容
  grid[19] = new Array(COLS).fill('I');           // 触发一次消行
  lockRows(grid, torn, [19]);
  ok(torn[6] === true, '原有撕口应当随内容一起下移一行（5 → 6）');
  ok(grid[6][3] === 'S', '撕口里的图案也应当一起下移');
  ok(grid[5][3] === 'Z', '撕口上方的内容应当落到撕口原来的位置');
  eq(tornCount(torn), 2, '新撕口 + 旧撕口');
});

check('一次消 4 行：4 个撕口一起落在最上面', () => {
  const grid = makeGrid();
  const torn = makeTorn();
  for (const r of [16, 17, 18, 19]) grid[r] = new Array(COLS).fill('L');
  grid[15][9] = 'J';
  lockRows(grid, torn, [16, 17, 18, 19]);
  eq(torn.slice(0, 4), [true, true, true, true], '前 4 行都是撕口');
  eq(tornCount(torn), 4, '撕开行数');
  ok(grid[19][9] === 'J', '内容下移 4 行');
});

check('连续 20 次单行消除 → 整张上层图被撕光', () => {
  const grid = makeGrid();
  const torn = makeTorn();
  for (let i = 0; i < 20; i++) {
    grid[19] = new Array(COLS).fill('L');
    lockRows(grid, torn, [19]);
  }
  eq(tornCount(torn), ROWS, '20 次单行消除后应当全部撕开');
  ok(torn.every(Boolean), '每一行都应当是撕口');
});

check('compact 返回本次新撕开的行数，空输入不动棋盘', () => {
  const grid = makeGrid();
  const torn = makeTorn();
  const snapshot = JSON.stringify(grid);
  eq(compact(grid, torn, []), 0, '没有满行时返回 0');
  eq(JSON.stringify(grid), snapshot, '棋盘不应被修改');
  grid[19] = new Array(COLS).fill('T');
  grid[18] = new Array(COLS).fill('T');
  eq(compact(grid, torn, [18, 19]), 2, '消两行返回 2');
  eq(tornCount(torn), 2, '撕开行数');
});

section('满行判定与碰撞');
check('fullRows 只返回真正填满的行', () => {
  const grid = makeGrid();
  grid[3] = new Array(COLS).fill('X');
  grid[19] = new Array(COLS).fill('X');
  eq(fullRows(grid), [3, 19], '满行列表');
});

check('collides：左右下越界、压到已有方块都算碰撞', () => {
  const grid = makeGrid();
  grid[5][5] = 'T';
  ok(collides(grid, -1, 0, PIECES.O.shape), '左侧越界应当碰撞');
  ok(collides(grid, COLS - 1, 0, PIECES.O.shape), '右侧越界应当碰撞');
  ok(collides(grid, 4, ROWS - 1, PIECES.O.shape), '底部越界应当碰撞');
  ok(collides(grid, 4, 4, PIECES.O.shape), '压到已有方块应当碰撞');
  ok(!collides(grid, 0, -2, PIECES.O.shape), '完全在棋盘上方不算碰撞（允许出生在那里）');
  ok(!collides(grid, 3, 10, PIECES.O.shape), '空位上不碰撞');
});

check('dropDistance 就是硬降落差', () => {
  const grid = makeGrid();
  grid[19] = new Array(COLS).fill('X');
  grid[19][4] = null; grid[19][5] = null;
  eq(dropDistance(grid, 4, 0, PIECES.O.shape), 18, 'O 从 y=0 落到 y=18（底行被占掉两格）');
  eq(dropDistance(grid, 4, 18, PIECES.O.shape), 0, '已经落地时距离为 0');
  const empty = makeGrid();
  eq(dropDistance(empty, 4, 0, PIECES.O.shape), ROWS - 2, '空棋盘上 O 落到 y=18，落差 18');
});

section('SRS 旋转与踢墙');
check('旋转矩阵：每个方块顺转再逆转都回到原状', () => {
  for (const type of TYPES) {
    eq(rotateShape(rotateShape(PIECES[type].shape, 1), -1), PIECES[type].shape, `${type} 顺转再逆转`);
  }
});

check('旋转矩阵：转 4 次回到原状', () => {
  for (const type of TYPES) {
    let s = PIECES[type].shape;
    for (let i = 0; i < 4; i++) s = rotateShape(s, 1);
    eq(s, PIECES[type].shape, `${type} 转 4 次`);
  }
});

check('每个方块在 4 个朝向下都只有 4 个格子（形状不退化）', () => {
  for (const type of TYPES) {
    let s = PIECES[type].shape;
    for (let rot = 0; rot < 4; rot++) {
      eq(shapeCells(s).length, 4, `${type} 第 ${rot} 朝向的格子数`);
      s = rotateShape(s, 1);
    }
  }
});

check('踢墙表覆盖全部 8 个状态转移，首项都是原地旋转', () => {
  for (const table of [KICKS_I, KICKS_JLSTZ]) {
    for (let from = 0; from < 4; from++) {
      for (const dir of [1, -1]) {
        const to = (from + dir + 4) % 4;
        const kicks = table[`${from}>${to}`];
        ok(Array.isArray(kicks), `${from}>${to} 应当有踢墙表`);
        eq(kicks[0], [0, 0], `${from}>${to} 的首项应当是原地旋转`);
        eq(kicks.length, 5, `${from}>${to} 应当有 5 个候选偏移`);
      }
    }
  }
});

check('贴左墙旋转 T：踢墙把方块推回棋盘内', () => {
  const grid = makeGrid();
  const shape = rotateShape(PIECES.T.shape, 1);
  let placed = null;
  for (const k of KICKS_JLSTZ['0>1']) {
    if (!collides(grid, 0 + k[0], 10 - k[1], shape)) { placed = k; break; }
  }
  ok(placed, '至少有一个踢墙候选应当成立');
  ok(0 + placed[0] >= 0, '落点应当在棋盘内');
});

check('竖起来的 I 只有一列宽（I 走专属踢墙表的前提）', () => {
  const b = shapeBounds(shapeCells(rotateShape(PIECES.I.shape, 1)));
  eq([b.w, b.h], [1, 4], '竖 I 的包围盒');
});

section('生成、计分与等级');
check('出生位置：所有方块水平居中且贴着顶部', () => {
  for (const type of TYPES) {
    const pose = centeredPose(type, PIECES[type].shape);
    const cells = shapeCells(PIECES[type].shape).map(c => ({ x: c.x + pose.x, y: c.y + pose.y }));
    const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
    ok(Math.min(...xs) >= 0 && Math.max(...xs) < COLS, `${type} 出生时应当在棋盘内`);
    eq(Math.min(...ys), 0, `${type} 的顶边应当贴着第 0 行`);
    const left = Math.min(...xs), right = COLS - 1 - Math.max(...xs);
    ok(Math.abs(left - right) <= 1, `${type} 应当水平居中（左 ${left} / 右 ${right}）`);
  }
});

check('7-bag：每 7 个方块恰好是七种各一次', () => {
  const bag = [];
  const drawn = [];
  for (let i = 0; i < 700; i++) drawn.push(logicSandbox.nextType(bag));
  eq(drawn.length, 700, '抽样长度');
  const sorted = [...TYPES].sort().join(',');
  for (let i = 0; i < 700; i += 7) {
    eq(drawn.slice(i, i + 7).slice().sort().join(','), sorted, `第 ${i / 7 + 1} 个 bag`);
  }
  // 打乱顺序：不同 bag 的排列不应总是一样
  const shapes = new Set();
  for (let i = 0; i < 140; i += 7) shapes.add(drawn.slice(i, i + 7).join(''));
  ok(shapes.size > 1, '7-bag 应当打乱顺序，而不是每次都一样');
});

check('计分表：1/2/3/4 行 = 100/300/500/800', () => {
  eq(LINE_SCORES, [0, 100, 300, 500, 800], 'LINE_SCORES');
});

check('源码里重力下落走不带计分的 move(0, 1)（回归 Bug）', () => {
  ok(/if \(!move\(0, 1\)\) lock\(\)/.test(fullCode), '重力下落应当调用 move(0, 1)');
  ok(!/move\(0, 1, false\)/.test(fullCode), '不应再出现 move(0,1,false) 这种带计分开关的写法');
  ok(/function softDrop\(\)/.test(fullCode), '玩家软降应当是独立的 softDrop()');
  ok(/state\.score \+= 1/.test(fullCode), '软降每格 +1 分');
});

check('等级：每 10 行升一级，下落间隔逐级收窄且有下限', () => {
  const levelFor = lines => Math.floor(lines / 10) + 1;
  eq([0, 9, 10, 19, 20, 200].map(levelFor), [1, 1, 2, 2, 3, 21], '等级曲线');
  eq(dropIntervalFor(1), 900, '1 级 900ms');
  eq(dropIntervalFor(2), 825, '2 级 825ms');
  eq(dropIntervalFor(50), 90, '高等级不应低于 90ms');
  let prev = Infinity;
  for (let lv = 1; lv <= 20; lv++) {
    const cur = dropIntervalFor(lv);
    ok(cur <= prev, '下落间隔应当单调不增');
    prev = cur;
  }
});

section('渲染工具');
check('撕纸锯齿是确定性的：同一个边界每次偏移一致', () => {
  const a = edgeOffsets(7), b = edgeOffsets(7);
  eq(a, b, '同一边界两次调用');
  eq(a.length, 23, '采样点数量（22 段）');
  ok(a.every(v => Math.abs(v) <= 3), '偏移限制在 ±3px，不会撕出格子');
  ok(JSON.stringify(a) !== JSON.stringify(edgeOffsets(8)), '相邻边界应当有不同的锯齿形状');
});

check('clamp 限幅', () => {
  eq([clamp(-5, 0, 1), clamp(0.5, 0, 1), clamp(9, 0, 1)], [0, 0.5, 1], 'clamp');
});

check('空棋盘各行是独立数组（否则消行会互相串改）', () => {
  const grid = emptyGrid();
  eq(grid.length, ROWS, '行数');
  eq(grid[0].length, COLS, '列数');
  ok(grid.every(row => row.every(v => v === null)), '初始全空');
  grid[0][0] = 'X';
  ok(grid[1][0] === null, '各行必须是独立数组');
});

// ================================================================
// 第二轮：模拟 DOM 冒烟测试
// ================================================================
section('模拟 DOM：启动 → 消行 → 撕纸 → 计分');

// ---- 极简 DOM / Canvas 桩 ----
const drawCalls = [];
function makeCtx2d(){
  const ctx = {
    canvas: null,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    save(){}, restore(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){},
    arc(){}, arcTo(){}, ellipse(){}, rect(){}, clip(){}, stroke(){}, fill(){},
    strokeRect(){}, fillRect(){}, clearRect(){}, translate(){}, rotate(){}, scale(){},
    setTransform(){}, resetTransform(){},
    createLinearGradient(){ return { addColorStop(){} }; },
    drawImage(){ drawCalls.push('drawImage'); }
  };
  return ctx;
}
function makeEl(id){
  const el = {
    id: id || '', tagName: 'DIV', dataset: {}, style: {}, textContent: '', innerHTML: '',
    width: 112, height: 112, hidden: false, files: [], className: '',
    _cls: new Set(),
    classList: {
      add(...c){ c.forEach(x => el._cls.add(x)); },
      remove(...c){ c.forEach(x => el._cls.delete(x)); },
      toggle(c, on){ if (on === undefined) el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); else on ? el._cls.add(c) : el._cls.delete(c); },
      contains(c){ return el._cls.has(c); }
    },
    _listeners: {},
    addEventListener(type, fn){ (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener(){},
    appendChild(){}, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    click(){}, focus(){}, setPointerCapture(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { left: 0, top: 0, width: 340, height: 680, right: 340, bottom: 680 }; },
    getContext(){ this._ctx = this._ctx || makeCtx2d(); return this._ctx; },
    toBlob(cb){ cb(null); }
  };
  return el;
}
const elements = new Map();
const touchButtons = ['left', 'right', 'rotl', 'rotr', 'drop'].map(a => {
  const b = makeEl('touch-' + a);
  b.tagName = 'BUTTON'; b.dataset.act = a;
  return b;
});
const documentStub = {
  hidden: false,
  body: makeEl('body'),
  getElementById(id){
    if (!elements.has(id)){
      const el = makeEl(id);
      if (/Cv$/.test(id)){ el.tagName = 'CANVAS'; el.width = 112; el.height = 112; }
      if (id === 'board'){ el.width = 340; el.height = 680; }
      elements.set(id, el);
    }
    return elements.get(id);
  },
  createElement(tag){
    const el = makeEl('created-' + tag);
    el.tagName = String(tag).toUpperCase();
    if (el.tagName === 'CANVAS') el.width = el.height = 300;
    return el;
  },
  querySelectorAll(sel){ return sel === '.touchbar button' ? touchButtons : []; },
  querySelector(){ return null; },
  addEventListener(type, fn){ (documentStub._l = documentStub._l || {}), (documentStub._l[type] = documentStub._l[type] || []).push(fn); },
  removeEventListener(){},
  _fire(type){ (documentStub._l && documentStub._l[type] || []).forEach(fn => fn({ target: null, preventDefault(){}, stopPropagation(){} })); }
};
const store = new Map();
const rafQueue = [];
const sandbox2 = {
  console,
  window: null,
  document: documentStub,
  navigator: {},
  location: { search: '' },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn){ rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame(){},
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL(){} },
  URLSearchParams: class { constructor(){} has(){ return false; } get(){ return null; } },
  indexedDB: { open(){ const req = {}; setTimeout(() => req.onerror && req.onerror(), 0); return req; } },
  Image: class { constructor(){ this.width = 640; this.height = 1280; } set src(_v){} },
  AudioContext: undefined,
  matchMedia: undefined,
  devicePixelRatio: 2,
  innerWidth: 1280, innerHeight: 900,
  addEventListener(){}, removeEventListener(){}
};
sandbox2.window = sandbox2;
sandbox2.globalThis = sandbox2;
vm.createContext(sandbox2);

let bootError = null;
try {
  vm.runInContext(fullCode, sandbox2, { filename: 'index.html<script>#boot' });
} catch (err) {
  bootError = err;
}
const api = sandbox2.__teartris;

check('游戏在模拟 DOM 下能正常启动（无异常）', () => {
  if (bootError) throw bootError;
  ok(api, 'boot 没有暴露 __teartris 测试接口');
  ok(api.getState().started, '新游戏应当处于已开始状态');
  ok(api.getState().piece, '开局应当有一个活动方块');
});

check('每帧都真的画了棋盘（drawImage/clearRect 被调用）', () => {
  drawCalls.length = 0;
  api.frame(1000);
  ok(drawCalls.length > 0, '主循环应当绘制画面');
});

check('重力下落不改变分数，玩家软降才 +1', () => {
  const st = api.getState();
  api.newGame();
  // 让重力跳一整格
  st.lastTime = 0;
  st.dropCounter = 0;
  const before = st.score;
  api.frame(2000);                      // dt 被钳到 50ms，先跑几帧累计
  for (let t = 2000; t < 4000; t += 50) api.frame(t);
  const afterGravity = st.score;
  ok(st.piece, '方块应当还在');
  // 主动软降一格
  const yBefore = st.piece.y;
  const dropped = api.softDrop();
  if (dropped) {
    eq(st.score, afterGravity + 1, '软降一格应当 +1 分');
    eq(st.piece.y, yBefore + 1, '软降应当下移一格');
  }
  ok(afterGravity <= before + 1, `重力本身不应加分（${before} → ${afterGravity}）`);
});

check('消行链路：撕口位置正确 + 计分 + 撕纸动画 + 进度', () => {
  api.newGame();
  const st = api.getState();
  const scoreBefore = st.score;
  // 铺一个只差两格的底行，再用 O 方块补上
  st.grid = emptyGrid();
  st.torn = new Array(ROWS).fill(false);
  st.grid[19] = new Array(COLS).fill('L');
  st.grid[19][4] = null; st.grid[19][5] = null;
  st.grid[18][0] = 'T';                       // 用来验证内容是否随纸下落
  st.piece = { type: 'O', rot: 0, shape: PIECES.O.shape, x: 4, y: 0 };
  api.hardDrop();

  // O 补满第 19 行 → 消 1 行
  eq(st.lines, 1, '应当消掉 1 行');
  eq(st.revealed, 1, '撕纸进度应当是 1');
  ok(st.torn[0] === true, '撕口应当留在纸上（第 0 行）');
  ok(st.grid[19][0] === 'T', '撕口上方的内容应当整体下移一格');
  ok(st.score > scoreBefore, `得分应当增加（${scoreBefore} → ${st.score}）`);
  eq(st.score - scoreBefore, 100 + 18 * 2, '硬降 18 格 +36 分，消 1 行 +100 分');
  eq(st.tearing.length, 1, '应当有一个撕开动画');
  eq(st.tearing[0].row, 19, '撕开动画应当发生在被消掉的那一行');
  ok(st.particles.length > 0, '应当有纸屑粒子');
});

check('连击加成与等级提升按 10 行推进', () => {
  api.newGame();
  const st = api.getState();
  // 连续三次单行消除，连击应当累加
  for (let i = 0; i < 3; i++){
    st.grid = emptyGrid();
    st.grid[19] = new Array(COLS).fill('L');
    st.grid[19][4] = null; st.grid[19][5] = null;
    st.piece = { type: 'O', rot: 0, shape: PIECES.O.shape, x: 4, y: 0 };
    api.hardDrop();
  }
  eq(st.lines, 3, '连续三次单行消除');
  eq(st.combo, 2, '连击计数应当累加到 2');
  // 凑满 10 行 → 2 级
  for (let i = st.lines; i < 10; i++){
    st.grid = emptyGrid();
    st.grid[19] = new Array(COLS).fill('L');
    st.grid[19][4] = null; st.grid[19][5] = null;
    st.piece = { type: 'O', rot: 0, shape: PIECES.O.shape, x: 4, y: 0 };
    api.hardDrop();
  }
  eq(st.lines, 10, '累计 10 行');
  eq(st.level, 2, '应当升到 2 级');
  eq(st.dropInterval, dropIntervalFor(2), '下落间隔应当跟着等级走');
});

check('暂停后不能移动/旋转/硬降，恢复后可以', () => {
  api.newGame();
  const st = api.getState();
  const x0 = st.piece.x, y0 = st.piece.y, s0 = st.score;
  api.togglePause();
  eq(st.paused, true, '应当在暂停中');
  ok(!api.move(-1, 0), '暂停时不应能左移');
  ok(!api.move(1, 0), '暂停时不应能右移');
  ok(!api.rotate(1), '暂停时不应能旋转');
  api.hardDrop();
  eq([st.piece.x, st.piece.y, st.score], [x0, y0, s0], '暂停时不应有任何状态变化');
  api.togglePause();
  eq(st.paused, false, '应当已恢复');
  ok(api.move(-1, 0) || api.move(1, 0), '恢复后应当可以移动');
});

check('顶部溢出判定为游戏结束，并写入最高分', () => {
  api.newGame();
  const st = api.getState();
  st.grid = emptyGrid();
  st.grid[0] = new Array(COLS).fill('L');     // 把棋盘上方堵死
  st.grid[1][4] = 'L';
  st.piece = { type: 'O', rot: 0, shape: PIECES.O.shape, x: 4, y: -2 };
  api.lock();
  ok(st.over, '顶部溢出应当结束游戏');
  ok(!st.piece, '结束后不应再有活动方块');
  eq(store.get('teartris:best'), String(st.score), '最高分应当写进 localStorage');
});

check('重新开始会清空棋盘、分数与撕口', () => {
  api.newGame();
  const st = api.getState();
  ok(!st.over, '新游戏不应是结束状态');
  eq([st.score, st.lines, st.revealed, st.combo], [0, 0, 0, -1], '分数/行数/撕口/连击归零');
  ok(st.torn.every(v => v === false), '撕口应当全部复位');
  ok(st.grid.every(row => row.every(v => v === null)), '棋盘应当清空');
  ok(st.piece, '应当有新的活动方块');
  eq(st.queue.length, 3, '预览队列应当保持 3 个');
});

check('切走标签页会自动暂停（回来后不会一口气掉到底）', () => {
  api.newGame();
  const st = api.getState();
  eq(st.paused, false, '前置条件：未暂停');
  documentStub.hidden = true;
  documentStub._fire('visibilitychange');
  eq(st.paused, true, '页面隐藏时应当自动暂停');
  documentStub.hidden = false;
});

check('硬降越远分越高，且落地后立刻冒新方块', () => {
  api.newGame();
  const st = api.getState();
  const s0 = st.score;
  // 落差按「方块最低格到棋盘底部」算，别硬编码，避免测试和实现一起错
  const piece = st.piece;
  const lowest = Math.max(...shapeCells(piece.shape).map(c => c.y));
  const d = (ROWS - 1) - (piece.y + lowest);
  ok(d > 0, '前置条件：方块应当还能下落');
  api.hardDrop();
  eq(st.score - s0, d * 2, `硬降 ${d} 格应当 +${d * 2} 分`);
  ok(st.piece, '应当立刻出现新方块');
  ok(st.piece.y <= 2, '新方块应当从顶部开始');
  ok(TYPES.indexOf(st.piece.type) >= 0, '方块类型应当来自 7-bag');
});

check('暂存：第一次把当前方块放进 HOLD，第二次换回来，且落地后重置', () => {
  api.newGame();
  const st = api.getState();
  const first = st.piece.type;
  api.holdPiece();
  eq(st.hold, first, 'HOLD 应当拿到刚才的方块');
  ok(st.piece, '应当立刻换上新方块');
  eq(st.holdUsed, true, '同一块只能暂存一次');

  // 第二次暂存：此时 holdUsed 仍为 true，应当被拒绝
  const before = st.piece.type;
  api.holdPiece();
  eq(st.piece.type, before, '同一块落地前不能二次暂存');

  // 换到下一块（直接让当前方块落地），此时应当可以再暂存
  api.hardDrop();
  eq(st.holdUsed, false, '新方块出现后应当可以再次暂存');
  const current = st.piece.type;
  api.holdPiece();
  eq(st.hold, current, 'HOLD 应当换成刚才那块');
  eq(st.piece.type, first, 'HOLD 里的方块应当换回来');
});

// ================================================================
// 汇总
// ================================================================
process.stdout.write(`\n${'-'.repeat(56)}\n`);
if (failures.length) {
  process.stdout.write(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`);
  for (const f of failures) process.stdout.write(`  · ${f.name}\n    ${f.message}\n`);
  process.exit(1);
}
process.stdout.write(`✓ 全部 ${passed} 项通过\n`);
