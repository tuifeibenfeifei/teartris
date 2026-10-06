#!/usr/bin/env node
/**
 * TearTris 客户端半部（lib/client.js）测试 —— 直接跑：
 *
 *   node tests/client.js
 *
 * 客户端半部是 DSH Web 页里那段「右下角悬浮按钮 + 游戏面板」。它有两个
 * 容易悄悄坏掉的地方，这里都钉住：
 *   ① package.json 的 dsh.client.immediately 必须为 true —— 否则宿主只会
 *      登记这个 bundle，永远不会执行它，右下角按钮根本不出现（曾经的真 Bug）。
 *   ② 键必须通过 postMessage 转发给游戏 iframe，而不是让 iframe 抢焦点。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeClientDom } from './dom-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failures.push({ name, message: (err && err.message) || String(err) });
    process.stdout.write(`  ✗ ${name}\n      ${(err && err.message) || err}\n`);
  }
}
function ok(v, m) { if (!v) throw new Error(m || '断言失败'); }
function eq(a, b, m) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || '不相等'}：实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}

process.stdout.write('TearTris 客户端插件测试 · lib/client.js\n\n');
process.stdout.write('宿主契约\n');

check('package.json 声明 dsh.client 且 immediately 为 true', () => {
  const decl = PKG.dsh && PKG.dsh.client;
  ok(decl, 'package.json 缺少 dsh.client');
  eq(decl.platform, 'web', 'dsh.client.platform');
  eq(decl.immediately, true, 'dsh.client.immediately —— 少了它宿主不会执行这个 bundle');
});

check('package.json 导出 ./client（宿主靠它找 bundle）', () => {
  const exp = PKG.exports || {};
  eq(exp['./client'], './lib/client.js', 'exports["./client"]');
  ok((PKG.files || []).includes('lib'), 'files 里应当包含 lib');
});

check('bundle 文件存在并注册到 __ModuleLoader__', () => {
  const source = fs.readFileSync(CLIENT, 'utf8');
  ok(source.includes('window.__ModuleLoader__.load('), '必须通过 __ModuleLoader__.load 注册');
  ok(source.includes("id: 'teartris'"), 'bundle id 应当与包名一致（id = teartris）');
});

// ---------------------------------------------------------------- 装载
const dom = makeClientDom();
let registration = null;
const sandbox = {
  console,
  document: dom,
  localStorage: {
    _s: new Map(),
    getItem(k) { return this._s.has(k) ? this._s.get(k) : null; },
    setItem(k, v) { this._s.set(k, String(v)); },
    removeItem(k) { this._s.delete(k); }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date,
  __ModuleLoader__: { load(reg) { registration = reg; } }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
// 宿主页就是 window 本身，所以 window 级的监听 = sandbox 级监听
sandbox.addEventListener = dom.addEventListener;
sandbox.removeEventListener = dom.removeEventListener;
sandbox.location = { origin: 'http://127.0.0.1:19387', href: 'http://127.0.0.1:19387/' };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'lib/client.js' });

check('注册的是一个惰性工厂，工厂本身没有副作用', () => {
  ok(registration, '没有调用 __ModuleLoader__.load');
  eq(registration.id, 'teartris', 'id');
  eq(typeof registration.factory, 'function', 'factory');
  eq(dom.appendLog.length, 0, '工厂执行前不应该往 body 里插任何东西');
});

const mod = registration.factory(s => { throw new Error('没有可用依赖：' + s); });

check('工厂导出 cordis 插件形状（apply / name）', () => {
  eq(typeof mod.apply, 'function', 'exports.apply');
  eq(typeof mod.name, 'string', 'exports.name');
  ok(Array.isArray(mod.inject) || mod.inject === undefined, 'inject 应当是数组或省略');
});

// ---------------------------------------------------------------- 挂载
let disposer = null;
check('apply(ctx) 用 ctx.effect 注册挂载并在卸载时清理', () => {
  let label = null;
  const ctx = {
    effect(fn, l) { label = l; disposer = fn(); return () => {}; }
  };
  mod.apply(ctx);
  eq(typeof disposer, 'function', 'ctx.effect 的回调应当返回 cleanup');
  ok(String(label).includes('teartris'), `effect 标签应当可辨识，实际 ${label}`);
});

const appended = dom.appendLog;
const launcher = appended.find(el => el._cls.has('ttr-launcher'));
const panel = appended.find(el => el._cls.has('ttr-panel'));
const style = appended.find(el => el.tagName === 'STYLE');

check('挂载出启动按钮、面板和一个 <style>', () => {
  ok(launcher, '缺少 .ttr-launcher');
  ok(panel, '缺少 .ttr-panel');
  ok(style, '缺少 <style>');
  eq(launcher.textContent, 'T', '按钮上应当是 T');
  eq(launcher.getAttribute('aria-expanded'), 'false', '初始 aria-expanded');
});

check('面板里是 iframe，指向 /teartris/（与 Node 半部路由一致）', () => {
  const frame = panel.querySelector('.ttr-frame');
  ok(frame, '缺少 iframe');
  eq(frame.tagName, 'IFRAME', 'frame 标签');
  eq(frame.src, '/teartris/', 'iframe 地址');
  ok(panel.querySelector('.ttr-head'), '缺少标题栏');
  ok(panel.querySelector('.ttr-close'), '缺少关闭按钮');
});

check('默认不打开面板', () => {
  ok(!panel._cls.has('ttr-open'), '初始不应当带 ttr-open');
});

check('点击按钮开合面板，并同步 aria 与键盘接管提示', () => {
  const kbd = panel.querySelector('.ttr-kbd');
  launcher.dispatch('click');
  ok(panel._cls.has('ttr-open'), '点一下应当打开');
  eq(launcher.getAttribute('aria-expanded'), 'true', '打开后的 aria-expanded');
  ok(kbd._cls.has('ttr-on'), '打开时键盘接管提示应当点亮');
  launcher.dispatch('click');
  ok(!panel._cls.has('ttr-open'), '再点一下应当收起');
  ok(!kbd._cls.has('ttr-on'), '收起后键盘接管提示应当熄灭');
});

check('打开状态会被记住（localStorage）', () => {
  launcher.dispatch('click');
  eq(sandbox.localStorage.getItem('teartris:open'), '1', '打开时应当写入 1');
  launcher.dispatch('click');
  eq(sandbox.localStorage.getItem('teartris:open'), '0', '收起时应当写入 0');
});

// ---------------------------------------------------------------- 按键转发
check('面板打开时把游戏按键 postMessage 给 iframe', () => {
  const sent = [];
  const frame = panel.querySelector('.ttr-frame');
  // 面板还没真正打开时不该转发
  dom.fire('keydown', { code: 'ArrowLeft' });
  eq(sent.length, 0, '收起状态不应当转发按键');

  launcher.dispatch('click');                       // 打开
  frame.contentWindow = { postMessage: (msg, origin) => sent.push([msg, origin]) };
  dom.fire('keydown', { code: 'ArrowLeft' });
  dom.fire('keydown', { code: 'Space' });
  eq(sent.length, 2, '打开后应当转发');
  eq(sent[0][0], { type: 'teartris:key', code: 'ArrowLeft' }, '转发格式');
  eq(sent[0][1], 'http://127.0.0.1:19387', 'targetOrigin 应当是宿主 origin');

  // 不认识的键不要吞掉
  dom.fire('keydown', { code: 'KeyA' });
  eq(sent.length, 2, '聊天用的字母键不应当被转发');

  // 带修饰键的组合放行（Ctrl+R 之类）
  dom.fire('keydown', { code: 'KeyR', ctrlKey: true });
  eq(sent.length, 2, 'Ctrl+R 不应当被吞掉');

  launcher.dispatch('click');                       // 收起
  dom.fire('keydown', { code: 'ArrowLeft' });
  eq(sent.length, 2, '收起后不应当再转发');
});

check('清理时移除全部元素与 window 监听', () => {
  const before = dom.listenerCount('keydown');
  ok(before > 0, '前置条件：应当有 keydown 监听');
  disposer();
  eq(dom.listenerCount('keydown'), 0, 'cleanup 后不应当残留 keydown 监听');
  eq(dom.listenerCount('resize'), 0, 'cleanup 后不应当残留 resize 监听');
  eq(dom.body.children.length, 0, 'cleanup 后 body 里不应当残留节点');
});

check('代码里没有 innerHTML 注入（避免把宿主页面搞坏）', () => {
  const source = fs.readFileSync(CLIENT, 'utf8');
  ok(!/\.innerHTML\s*=/.test(source), '客户端半部不应当写 innerHTML');
});

process.stdout.write(`\n${'-'.repeat(56)}\n`);
if (failures.length) {
  process.stdout.write(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`);
  for (const f of failures) process.stdout.write(`  · ${f.name}\n    ${f.message}\n`);
  process.exit(1);
}
process.stdout.write(`✓ 全部 ${passed} 项通过\n`);
