/**
 * TearTris · 撕纸俄罗斯方块 — DSH 插件 Node 半部
 *
 * 在 DSH Web 服务上注册 /teartris 路由，把游戏页面与示例图片作为静态资源提供。
 * 打开 http://<dsh-host>:<port>/teartris/ 即可直接游玩；
 * 客户端半部（lib/client.js）会在 DSH Web UI 里注入一个悬浮启动按钮。
 *
 * 插件结构（GitHub 仓库根 = 插件包根）：
 *   index.html            游戏页面（单文件，内联 CSS/JS）
 *   assets/imageA.jpg     上层示例图（白天花园）
 *   assets/imageB.jpg     下层示例图（星空极光）
 */
import { readFileSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 稳定插件名（profile layer 行 id，与 cordis.patch.yml 保持一致） */
const name = 'teartris';

/** 需要 DSH 的 webServer 服务 */
const inject = ['webServer'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/** 构造一个只读静态资源处理器（带路径穿越防护） */
function staticHandler(relPath) {
  const file = resolve(PKG_ROOT, '.' + relPath);
  const underRoot =
    file === PKG_ROOT ||
    file.startsWith(PKG_ROOT + '\\') ||
    file.startsWith(PKG_ROOT + '/');
  return (_req, res) => {
    if (!underRoot) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    try {
      const data = readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + relPath);
    }
  };
}

/**
 * 激活插件：注册 /teartris 相关路由。
 * @param ctx - DSH cordis 插件上下文
 */
function apply(ctx) {
  ctx.effect(() => {
    const disposes = [
      // 页面入口（两种写法都支持）
      ctx.webServer.register({ kind: 'exact', path: '/teartris', handler: staticHandler('/index.html') }),
      ctx.webServer.register({ kind: 'exact', path: '/teartris/', handler: staticHandler('/index.html') }),
      // 页面相对引用的示例图（assets/imageA.jpg / assets/imageB.jpg）
      ctx.webServer.register({ kind: 'exact', path: '/teartris/assets/imageA.jpg', handler: staticHandler('/assets/imageA.jpg') }),
      ctx.webServer.register({ kind: 'exact', path: '/teartris/assets/imageB.jpg', handler: staticHandler('/assets/imageB.jpg') }),
    ];
    ctx.logger?.info?.('[teartris] 撕纸俄罗斯方块已挂载：/teartris/');
    return () => {
      for (const dispose of disposes) {
        try { dispose?.(); } catch { /* 忽略卸载期错误 */ }
      }
    };
  }, 'teartris: static routes');
}

export { apply, inject, name };
