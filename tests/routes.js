#!/usr/bin/env node
/**
 * TearTris 插件 Node 半部（lib/index.js）的路由测试 —— 直接跑：
 *
 *   node tests/routes.js
 *
 * 做法：给 apply() 一个假的 ctx.webServer，拿到注册进去的 handler，
 * 然后用假的 req/res 黑盒调用它，验证：
 *   · 页面与示例图都能取到，MIME / 缓存头正确
 *   · 目录穿越（含 URL 编码变体）一律 404
 *   · GET/HEAD/405、ETag 304 协商缓存
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(new URL('../lib/index.js', import.meta.url).href);

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

// ---------------------------------------------------------------- 夹具
let handler = null, route = null, effectLabel = null;
const fakeCtx = {
  effect(fn, label) {
    effectLabel = label;
    const dispose = fn();
    assert.equal(typeof dispose, 'function', 'ctx.effect 的回调应当返回 disposer');
    return dispose;
  },
  webServer: {
    register(r) { route = r; handler = r.handler; return () => { route = null; handler = null; }; }
  },
  logger: { info() {} }
};

function call(url, method, headers) {
  const out = { status: 0, headers: null, body: undefined, ended: false };
  const res = {
    writeHead(code, h) { out.status = code; out.headers = h || {}; },
    end(body) { out.ended = true; out.body = body; }
  };
  handler({ url, method: method || 'GET', headers: headers || {} }, res);
  return out;
}

process.stdout.write(`TearTris 路由测试 · lib/index.js\n\n`);
process.stdout.write('注册契约\n');
check('插件导出 name / inject / apply', () => {
  assert.equal(mod.name, 'teartris');
  assert.deepEqual(mod.inject, ['webServer']);
  assert.equal(typeof mod.apply, 'function');
});

check('apply() 通过 ctx.effect 注册一条 /teartris 前缀路由', () => {
  mod.apply(fakeCtx);
  assert.ok(route, '没有调用 webServer.register');
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/teartris');
  assert.equal(typeof handler, 'function');
  assert.match(String(effectLabel), /teartris/);
});

check('只注册一条路由（前缀路由一次覆盖页面与全部资源）', () => {
  let count = 0;
  const ctx = Object.assign({}, fakeCtx, {
    effect: fakeCtx.effect,
    webServer: { register() { count++; return () => {}; } }
  });
  mod.apply(ctx);
  assert.equal(count, 1, `应当只注册 1 条路由，实际 ${count} 条`);
});

process.stdout.write('\n资源可达性\n');
const reachable = [
  ['/teartris', 200, 'text/html'],
  ['/teartris/', 200, 'text/html'],
  ['/teartris/index.html', 200, 'text/html'],
  ['/teartris/assets/imageA.webp', 200, 'image/webp'],
  ['/teartris/assets/imageB.webp', 200, 'image/webp'],
  ['/teartris/assets/imageA.jpg', 200, 'image/jpeg'],
  ['/teartris/assets/imageB.jpg', 200, 'image/jpeg'],
  ['/teartris/icon.svg', 200, 'image/svg+xml'],
  ['/teartris/favicon.ico', 404]                    // 没放这个文件，应当老实 404
];
for (const [url, status, type] of reachable) {
  check(`${url} → ${status}${type ? ' ' + type : ''}`, () => {
    const r = call(url);
    assert.equal(r.status, status, `状态码 ${r.status}`);
    if (type) assert.ok(String(r.headers['content-type']).startsWith(type), `content-type=${r.headers['content-type']}`);
    if (status === 200) assert.ok(r.body && r.body.length > 0, '应当有响应体');
  });
}

check('页面内容确实是游戏本体', () => {
  const r = call('/teartris/');
  assert.ok(String(r.body).includes('TEARTRIS'), 'HTML 里应当有游戏标题');
  assert.ok(String(r.body).includes('teartris:key'), 'HTML 里应当有宿主转发按键的入口');
});

check('示例图确实是 WebP/JPEG 二进制', () => {
  const webp = call('/teartris/assets/imageA.webp');
  assert.equal(webp.body.subarray(0, 4).toString('latin1'), 'RIFF', 'WebP 应当以 RIFF 开头');
  assert.equal(webp.body.subarray(8, 12).toString('latin1'), 'WEBP');
  const jpg = call('/teartris/assets/imageA.jpg');
  assert.equal(jpg.body[0], 0xff, 'JPEG 应当以 FF D8 开头');
  assert.equal(jpg.body[1], 0xd8);
});

process.stdout.write('\n目录穿越与非法输入\n');
const blocked = [
  '/teartris/../package.json',
  '/teartris/../../package.json',
  '/teartris/..%2f..%2fpackage.json',
  '/teartris/%2e%2e%2fpackage.json',
  '/teartris/%2E%2E/%2E%2E/package.json',
  '/teartris/assets/..%2f..%2fpackage.json',
  '/teartris/assets/../../../../Windows/win.ini',
  '/teartris/./../package.json',
  '/teartris/%00',
  '/teartris/%E0%A4%A',
  '/teartris/no-such-file.txt',
  '/teartris/assets/imageC.webp',
  '/teartris/assets/',
  '/teartris/package.json/../../index.html'
];
for (const url of blocked) {
  check(`${url} → 404`, () => {
    const r = call(url);
    assert.equal(r.status, 404, `状态码 ${r.status}（不能读到包外或不存在的东西）`);
  });
}

check('不暴露 README.md（不在可服务白名单内）', () => {
  assert.equal(call('/teartris/README.md').status, 404);
  assert.equal(call('/teartris/LICENSE').status, 404);
});

process.stdout.write('\nHTTP 语义\n');
check('POST 等写方法 → 405 且带 Allow 头', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = call('/teartris/', method);
    assert.equal(r.status, 405, `${method} 应当被拒`);
    assert.equal(r.headers.allow, 'GET, HEAD');
  }
});

check('HEAD 返回同样的头但不带响应体', () => {
  const get = call('/teartris/assets/imageA.webp');
  const head = call('/teartris/assets/imageA.webp', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined, 'HEAD 不应有响应体');
  assert.equal(head.headers['content-length'], get.headers['content-length']);
  assert.equal(head.headers.etag, get.headers.etag);
});

check('ETag 命中 → 304 Not Modified', () => {
  const first = call('/teartris/assets/imageB.webp');
  assert.ok(first.headers.etag, '应当带 ETag');
  const second = call('/teartris/assets/imageB.webp', 'GET', { 'if-none-match': first.headers.etag });
  assert.equal(second.status, 304);
  assert.equal(second.body, undefined);
  const stale = call('/teartris/assets/imageB.webp', 'GET', { 'if-none-match': '"nope"' });
  assert.equal(stale.status, 200, 'ETag 不匹配时应当正常返回');
});

check('缓存头：图片可长缓存，页面必须每次协商', () => {
  const img = call('/teartris/assets/imageA.webp');
  assert.match(img.headers['cache-control'], /max-age=\d+/);
  const html = call('/teartris/');
  assert.equal(html.headers['cache-control'], 'no-cache');
  assert.ok(html.headers['last-modified'], '应当带 Last-Modified');
});

check('未知方法请求不会抛异常（handler 内部兜底）', () => {
  const r = call('/teartris/', 'OPTIONS');
  assert.equal(r.status, 405);
});

check('畸形 URL 也不会让 handler 崩掉', () => {
  for (const url of [':::', '', 'http://[', '/teartris/%']) {
    const r = call(url);
    assert.ok(r.status === 404 || r.status === 200, `状态码 ${r.status} 应当是 404/200 而不是异常`);
  }
});

// ---------------------------------------------------------------- 汇总
process.stdout.write(`\n${'-'.repeat(56)}\n`);
if (failures.length) {
  process.stdout.write(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`);
  for (const f of failures) process.stdout.write(`  · ${f.name}\n    ${f.message}\n`);
  process.exit(1);
}
process.stdout.write(`✓ 全部 ${passed} 项通过\n`);
