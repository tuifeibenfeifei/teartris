/**
 * 极简 DOM / Canvas 桩 —— 让 index.html 里只服务浏览器的那段 boot() 能在 Node 里跑起来。
 *
 * 用途：
 *   · tests/run.js      → 驱动真实的游戏主循环，验证「消行 → 撕纸 → 计分」
 *   · tests/shot.mjs    → 把这一帧真实产生的 Canvas 指令录下来，交给 tools/replay.py 出图
 *
 * 它不是浏览器模拟器：只实现游戏真正用到的那部分 API，任何没实现的调用都会
 * 直接抛错，这样一旦游戏用了新的 Canvas 能力，测试会立刻发现而不是静默漏画。
 */

/** 记录型 2D 上下文：把调用原样存下来，供离线重放 */
export function makeRecordingCtx() {
  const ops = [];
  const gradients = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '' };
  const stack = [];
  const rec = (name, args) => { ops.push([name, args]); };
  const num = v => (typeof v === 'number' ? v : null);
  /** 记进指令流时把渐变对象换成可序列化的引用 */
  const ser = v => (v && v.__gradientRef) ? v.__gradientRef : v;
  const ctx = {
    ops,
    gradients,
    canvas: null,
    save() { stack.push(Object.assign({}, state)); rec('save', []); },
    restore() { const s = stack.pop(); if (s) Object.assign(state, s); rec('restore', []); },
    beginPath() { rec('beginPath', []); },
    closePath() { rec('closePath', []); },
    moveTo(x, y) { rec('moveTo', [x, y]); },
    lineTo(x, y) { rec('lineTo', [x, y]); },
    arc(x, y, r, a0, a1) { rec('arc', [x, y, r, a0, a1]); },
    arcTo(x1, y1, x2, y2, r) { rec('arcTo', [x1, y1, x2, y2, r]); },
    ellipse(x, y, rx, ry, rot, a0, a1) { rec('ellipse', [x, y, rx, ry, rot, a0, a1]); },
    rect(x, y, w, h) { rec('rect', [x, y, w, h]); },
    quadraticCurveTo(cx, cy, x, y) { rec('quadraticCurveTo', [cx, cy, x, y]); },
    clip() { rec('clip', []); },
    stroke() { rec('stroke', [ser(state.strokeStyle), state.lineWidth, state.globalAlpha]); },
    fill() { rec('fill', [ser(state.fillStyle), state.globalAlpha]); },
    strokeRect(x, y, w, h) { rec('strokeRect', [x, y, w, h, ser(state.strokeStyle), state.lineWidth, state.globalAlpha]); },
    fillRect(x, y, w, h) { rec('fillRect', [x, y, w, h, ser(state.fillStyle), state.globalAlpha]); },
    clearRect(x, y, w, h) { rec('clearRect', [x, y, w, h]); },
    translate(x, y) { rec('translate', [x, y]); },
    rotate(a) { rec('rotate', [a]); },
    scale(x, y) { rec('scale', [x, y]); },
    setTransform(a, b, c, d, e, f) { rec('setTransform', [a, b, c, d, e, f]); },
    resetTransform() { rec('resetTransform', []); },
    createLinearGradient(x0, y0, x1, y1) {
      const stops = [];
      const id = gradients.length;
      gradients.push({ kind: 'gradient', id, x0, y0, x1, y1, stops });
      rec('gradient', [id, x0, y0, x1, y1, stops]);
      const ref = { kind: 'gradient', id };
      return {
        __gradientRef: ref,
        addColorStop(off, color) { stops.push([off, color]); }
      };
    },
    drawImage(img, ...rest) {
      // 支持 drawImage(img, dx, dy) / (img, dx, dy, dw, dh) / (img, sx, sy, sw, sh, dx, dy, dw, dh)
      // 源也可能是离屏 canvas（上层图缓存就是），那种情况把它的指令序列嵌进去递归重放
      let src;
      let size = null;
      if (img && img.__recording) {
        src = {
          canvas: img.__name,
          ops: img.getContext('2d').ops,
          gradients: img.getContext('2d').gradients,
          w: img.width,
          h: img.height,
          alpha: state.globalAlpha          // 贴图时要乘上去的 globalAlpha
        };
        size = [img.width, img.height];
      } else {
        src = (img && img.__name) || (img && img.src) || 'unknown';
        size = img ? [img.width, img.height, img.__origin || null] : null;
      }
      rec('drawImage', [src, size, ...rest.map(num)]);
    }
  };
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign', 'textBaseline']) {
    Object.defineProperty(ctx, key, {
      get() { return state[key]; },
      set(v) { state[key] = v; }
    });
  }
  return ctx;
}

function makeEl(id) {
  const el = {
    id: id || '', tagName: 'DIV', dataset: {}, style: {}, textContent: '', innerHTML: '',
    width: 112, height: 112, hidden: false, files: [], _cls: new Set(),
    classList: {
      add(...c) { c.forEach(x => el._cls.add(x)); },
      remove(...c) { c.forEach(x => el._cls.delete(x)); },
      toggle(c, on) {
        if (on === undefined) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); }
        else if (on) el._cls.add(c); else el._cls.delete(c);
      },
      contains(c) { return el._cls.has(c); }
    },
    _listeners: {},
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    click() {}, focus() {}, setPointerCapture() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 680, right: 340, bottom: 680 }; },
    getContext() {
      if (!this._ctx) {
        this._ctx = makeRecordingCtx();
        this._ctx.canvas = this;
      }
      return this._ctx;
    },
    toBlob(cb) { cb(null); }
  };
  // className 要和 classList 保持一致，否则 `el.className = 'x'` 之后选择器找不到它
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) {
      el._cls.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach(c => el._cls.add(c));
    }
  });
  return el;
}

/** 迷你预览画布只是一块 112×112 的方图，给个独立的记录上下文即可 */
function makeMiniCanvas(id) {
  const el = makeEl(id);
  el.tagName = 'CANVAS';
  el.width = 112; el.height = 112;
  return el;
}

/**
 * 给 lib/client.js（DSH 客户端插件半部）用的轻量 DOM：不需要 Canvas，
 * 但需要真实的树关系与 class 查询，才能验证 mount/cleanup、拖拽与按键转发。
 */
export function makeClientDom() {
  const all = [];
  let appendLog = [];

  function create(tag) {
    const el = makeEl('el-' + all.length);
    el.tagName = String(tag).toUpperCase();
    el.children = [];
    el.parentNode = null;
    el.ownerDocument = dom;
    el.setAttribute = (k, v) => { el['attr:' + k] = v; };
    el.getAttribute = k => (k in el ? el[k] : (el['attr:' + k] === undefined ? null : el['attr:' + k]));
    el.appendChild = child => {
      child.parentNode = el;
      el.children.push(child);
      appendLog.push(child);          // 挂到任何节点上都记一笔，测试好断言
      return child;
    };
    el.removeChild = child => {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    };
    el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    el.closest = sel => {
      const want = String(sel).replace(/^\./, '').toUpperCase();
      let node = el;
      while (node) {
        if (node.tagName === want || (node._cls && node._cls.has(String(sel).replace(/^\./, '')))) return node;
        node = node.parentNode;
      }
      return null;
    };
    el.querySelector = sel => {
      const want = String(sel).replace(/^\./, '');
      const walk = node => {
        for (const c of node.children || []) {
          if (c._cls && c._cls.has(want)) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(el);
    };
    el.querySelectorAll = () => [];
    el.dispatch = (type, ev) => {
      const e = Object.assign({ type, target: el, preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0, pointerId: 1 }, ev || {});
      (el._listeners[type] || []).forEach(fn => fn(e));
      return e;
    };
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700 });
    all.push(el);
    return el;
  }

  const dom = {
    hidden: false,
    documentElement: null,
    _winListeners: {},
    createElement(tag) { return create(tag); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (dom._winListeners[type] = dom._winListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = dom._winListeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    fire(type, ev) {
      const list = (dom._winListeners[type] || []).slice();
      const e = Object.assign({ type, preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 }, ev || {});
      list.forEach(fn => fn(e));
      return e;
    },
    listenerCount(type) { return (dom._winListeners[type] || []).length; },
    get all() { return all; },
    get appendLog() { return appendLog; }
  };
  dom.body = create('body');
  dom.body.appendChild = child => { child.parentNode = dom.body; dom.body.children.push(child); appendLog.push(child); return child; };
  dom.documentElement = create('html');
  return dom;
}

/**
 * 造一个能跑起 TearTris 的沙箱环境。
 * @param opts.imageFor  (slot, src) => 图片对象；不传则图片永远不会加载成功
 * @param opts.origin    location.origin（默认 http://localhost）
 * @param opts.search    查询串（'?demo' 之类）
 */
export function createSandbox(opts = {}) {
  const elements = new Map();
  let createdSeq = 0;
  const touchButtons = ['left', 'right', 'rotl', 'rotr', 'drop'].map(a => {
    const b = makeEl('touch-' + a);
    b.tagName = 'BUTTON'; b.dataset.act = a;
    return b;
  });
  const docListeners = {};

  const documentStub = {
    hidden: false,
    body: makeEl('body'),
    getElementById(id) {
      if (!elements.has(id)) {
        const el = /Cv$/.test(id) ? makeMiniCanvas(id) : makeEl(id);
        if (id === 'board') { el.tagName = 'CANVAS'; el.width = 340; el.height = 680; }
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement(tag) {
      const name = String(tag).toUpperCase();
      const el = makeEl('created-' + name.toLowerCase() + '-' + (++createdSeq));
      el.tagName = name;
      if (name === 'CANVAS') {
        el.width = el.height = 300;
        el.__recording = true;              // 离屏画布：重放时要递归它的指令
      }
      return el;
    },
    querySelectorAll(sel) { return sel === '.touchbar button' ? touchButtons : []; },
    querySelector() { return null; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (docListeners[ev && ev.type] || []).forEach(fn => fn(ev)); return true; },
    _fire(type, ev) { (docListeners[type] || []).forEach(fn => fn(ev || { target: null, preventDefault() {}, stopPropagation() {} })); }
  };

  const store = new Map();
  const rafQueue = [];
  const sandbox = {
    console,
    document: documentStub,
    navigator: {},
    location: { search: opts.search || '', origin: opts.origin || 'http://localhost', href: 'http://localhost/teartris/' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    performance: { now: () => (sandbox.__now === undefined ? 0 : sandbox.__now) },
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    URLSearchParams: class { constructor() {} has() { return false; } get() { return null; } },
    indexedDB: { open() { const req = {}; setTimeout(() => req.onerror && req.onerror(), 0); return req; } },
    Image: class {
      constructor() { this.width = 0; this.height = 0; this.__name = ''; }
      set src(v) {
        this.__name = String(v);
        const img = opts.imageFor ? opts.imageFor(this.__name) : null;
        // 同步回调：测试要的是确定性，真实浏览器是异步的
        if (img) { this.width = img.width; this.height = img.height; this.__origin = img.__origin; setTimeout(() => this.onload && this.onload(), 0); }
        else setTimeout(() => this.onerror && this.onerror(), 0);
      }
      get src() { return this.__name; }
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, init) { this.type = type; this.code = (init && init.code) || ''; }
    },
    AudioContext: undefined,
    matchMedia: undefined,
    devicePixelRatio: opts.devicePixelRatio || 2,
    innerWidth: 1280, innerHeight: 900,
    addEventListener(type, fn) { (sandbox._winListeners = sandbox._winListeners || {}), (sandbox._winListeners[type] = sandbox._winListeners[type] || []).push(fn); },
    removeEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return { sandbox, elements, documentStub, touchButtons, rafQueue, store };
}
