/**
 * TearTris · 撕纸俄罗斯方块 — DSH 插件 Node 半部
 *
 * 在 DSH 的 webServer 上挂一条 /teartris 前缀路由，把游戏页面与示例图片
 * 作为静态资源提供。打开 http://<dsh-host>:<port>/teartris/ 即可直接游玩；
 * 客户端半部（lib/client.js）会在 DSH Web UI 右下角注入一个悬浮启动按钮。
 *
 * 插件结构（GitHub 仓库根 = 插件包根）：
 *   index.html            游戏页面（单文件，内联 CSS/JS）
 *   assets/imageA.jpg     上层示例图（白天花园）
 *   assets/imageB.jpg     下层示例图（星空极光）
 *
 * 说明：这里刻意不依赖任何宿主服务（除 webServer），也不读取请求体；
 * 所有资源都是只读的，路径解析一律限制在包根目录内。
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 稳定插件名（profile layer 行 id，与 cordis.patch.yml 保持一致） */
const name = 'teartris';

/** 需要 DSH 的 webServer 服务 */
const inject = ['webServer'];

/** 路由前缀；必须与客户端半部的 PANEL_URL 保持一致 */
const PREFIX = '/teartris';
const ROOT_URL = PREFIX + '/';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 允许通过 HTTP 暴露的文件类型白名单：插件只提供游戏页面与图片，别的一概不给 */
const SERVABLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff2']);

/** 读取并缓存一个包内文件；缓存键为绝对路径，附 mtime/size 以便热更新时失效 */
const fileCache = new Map();

function readAsset(absPath) {
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return null;                              // 不存在
  }
  if (!stat.isFile()) return null;
  const key = `${stat.mtimeMs}:${stat.size}`;
  const hit = fileCache.get(absPath);
  if (hit && hit.key === key) return hit;
  let data;
  try {
    data = readFileSync(absPath);
  } catch {
    return null;
  }
  const entry = {
    key,
    data,
    size: data.length,
    etag: `"${createHash('sha1').update(data).digest('hex').slice(0, 20)}"`,
    type: MIME[extname(absPath).toLowerCase()] || 'application/octet-stream',
    ext: extname(absPath).toLowerCase(),
  };
  fileCache.set(absPath, entry);
  return entry;
}

/**
 * 把请求路径解析成包内绝对路径。
 * @returns 绝对路径；越界或不可服务时返回 null。
 */
function resolvePath(pathname) {
  let rel = pathname;
  if (rel === PREFIX || rel === ROOT_URL) rel = '/index.html';
  else if (rel.startsWith(ROOT_URL)) rel = rel.slice(PREFIX.length);
  else return null;                           // 前缀不匹配（正常不会发生）

  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;                              // 畸形百分号编码
  }
  if (decoded.includes('\0')) return null;

  // 显式拒绝任何上跳片段（`..` / `.`），配合下面的包含性检查做双保险：
  // 即使宿主没有先行归一化路径，也不可能读到包外文件。
  const segments = decoded.split('/');
  if (segments.some(seg => seg === '..' || seg === '.')) return null;

  if (decoded.endsWith('/')) decoded += 'index.html';

  const abs = resolve(PKG_ROOT, '.' + normalize(decoded));
  // 目录穿越防护：解析后必须仍在包根目录内
  if (abs !== PKG_ROOT && !abs.startsWith(PKG_ROOT + sep)) return null;
  if (!SERVABLE.has(extname(abs).toLowerCase())) return null;
  return abs;
}

/**
 * /teartris 前缀路由的统一处理器。
 * 支持 GET/HEAD、ETag 协商缓存，并对静态资源给出长效缓存头。
 */
function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url || ROOT_URL, 'http://localhost').pathname;
  } catch {
    pathname = ROOT_URL;
  }

  const abs = resolvePath(pathname);
  const asset = abs ? readAsset(abs) : null;
  if (!asset) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : 'not found: ' + pathname);
    return;
  }

  const headers = {
    'content-type': asset.type,
    'content-length': String(asset.size),
    etag: asset.etag,
    // 图片可以放心长缓存；页面本身保持协商缓存，改了立刻生效
    'cache-control': asset.ext === '.html' ? 'no-cache' : 'public, max-age=3600, must-revalidate',
    'last-modified': new Date(statSync(abs).mtimeMs).toUTCString(),
  };

  if (req.headers && req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  res.end(method === 'HEAD' ? undefined : asset.data);
}

/**
 * 激活插件：注册 /teartris 前缀路由。
 * @param ctx - DSH cordis 插件上下文
 */
function apply(ctx) {
  ctx.effect(() => {
    // 一条 prefix 路由覆盖页面与全部静态资源：
    // 比逐文件注册 exact 路由更短，也不会因为新增图片而漏注册（新增资源自动可达）。
    const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler });
    ctx.logger?.info?.('[teartris] 撕纸俄罗斯方块已挂载：' + ROOT_URL);
    return () => {
      try {
        dispose?.();
      } catch {
        /* 忽略卸载期错误 */
      }
    };
  }, 'teartris: static route');
}

export { apply, inject, name };
