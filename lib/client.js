/**
 * TearTris · 撕纸俄罗斯方块 — DSH 插件客户端半部（纯 DOM，无 React 依赖）
 *
 * 以 cordis client 插件的形式挂载：右下角悬浮启动按钮 + 可拖拽游戏面板（iframe
 * 指向 Node 半部提供的 /teartris/）。面板开关状态持久化在 localStorage。
 *
 * 注册方式与 DSH 生态一致：window.__ModuleLoader__.load({ id, factory })，
 * 由 DSH Web 客户端运行时按 cordis 插件调用 apply(ctx)。
 */
window.__ModuleLoader__.load({
  id: 'teartris',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var name = 'teartris-client';
    var inject = [];
    var LS_OPEN = 'teartris:open';
    var PANEL_URL = '/teartris/';

    function loadOpen() {
      try { return localStorage.getItem(LS_OPEN) === '1'; } catch { return false; }
    }
    function saveOpen(v) {
      try { localStorage.setItem(LS_OPEN, v ? '1' : '0'); } catch {}
    }

    function mount() {
      var host = document.createElement('div');
      host.setAttribute('data-teartris', '');
      document.body.appendChild(host);

      var style = document.createElement('style');
      style.textContent =
        '.ttr-launcher{' +
          'position:fixed;right:18px;bottom:18px;z-index:2147483100;width:50px;height:50px;border-radius:14px;' +
          'border:1px solid rgba(124,156,255,.55);background:linear-gradient(135deg,rgba(124,156,255,.28),rgba(88,216,192,.22));' +
          'color:#fff;font-size:20px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
          'box-shadow:0 10px 28px rgba(0,0,0,.45);backdrop-filter:blur(6px);font-family:ui-monospace,Consolas,monospace;' +
          'transition:transform .12s,box-shadow .12s;' +
        '}' +
        '.ttr-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(0,0,0,.5)}' +
        '.ttr-panel{' +
          'position:fixed;right:14px;bottom:14px;z-index:2147483090;width:min(400px,92vw);height:min(78vh,700px);' +
          'background:#0d1220;border:1px solid rgba(124,156,255,.35);border-radius:16px;overflow:hidden;' +
          'display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.55);' +
        '}' +
        '.ttr-head{' +
          'height:36px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;' +
          'background:rgba(124,156,255,.10);border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none;' +
        '}' +
        '.ttr-head:active{cursor:grabbing}' +
        '.ttr-title{flex:1;font-size:12.5px;font-weight:700;color:#dfe6f5;letter-spacing:1px;white-space:nowrap;overflow:hidden}' +
        '.ttr-head button{' +
          'border:0;background:transparent;color:#8fa3c8;width:26px;height:26px;border-radius:7px;cursor:pointer;' +
          'font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;' +
        '}' +
        '.ttr-head button:hover{background:rgba(255,255,255,.10);color:#fff}' +
        '.ttr-frame{flex:1;width:100%;height:100%;border:0;background:#0a0e17}';

      host.appendChild(style);

      var launcher = document.createElement('button');
      launcher.className = 'ttr-launcher';
      launcher.title = '撕纸俄罗斯方块 TearTris';
      launcher.textContent = 'T';
      launcher.setAttribute('aria-label', '打开撕纸俄罗斯方块');

      var panel = document.createElement('div');
      panel.className = 'ttr-panel';
      panel.style.display = 'none';
      panel.innerHTML =
        '<div class="ttr-head">' +
          '<span class="ttr-title">TearTris · 撕纸俄罗斯方块</span>' +
          '<button class="ttr-min" title="收起">−</button>' +
          '<button class="ttr-close" title="关闭">×</button>' +
        '</div>' +
        '<iframe class="ttr-frame" src="' + PANEL_URL + '" title="TearTris" loading="lazy"></iframe>';

      document.body.appendChild(launcher);
      document.body.appendChild(panel);

      var offsetX = 0, offsetY = 0, dragging = false;
      function onDown(e) {
        if (e.target.closest('button')) return;
        dragging = true;
        var r = panel.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        e.preventDefault();
      }
      function onMove(e) {
        if (!dragging) return;
        var w = panel.offsetWidth, h = panel.offsetHeight;
        var x = Math.min(Math.max(4, e.clientX - offsetX), window.innerWidth - w - 4);
        var y = Math.min(Math.max(4, e.clientY - offsetY), window.innerHeight - h - 4);
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      function onUp() { dragging = false; }

      function show() {
        panel.style.display = 'flex';
        saveOpen(true);
      }
      function hide() {
        panel.style.display = 'none';
        saveOpen(false);
      }

      launcher.addEventListener('click', function () {
        if (panel.style.display === 'none') show();
        else hide();
      });
      panel.querySelector('.ttr-close').addEventListener('click', hide);
      panel.querySelector('.ttr-min').addEventListener('click', hide);
      panel.querySelector('.ttr-head').addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);

      if (loadOpen()) show();

      return function cleanup() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        launcher.remove();
        panel.remove();
        style.remove();
        host.remove();
      };
    }

    function apply(ctx) {
      ctx.effect(function () {
        var cleanup = mount();
        return cleanup;
      }, 'teartris: panel mount');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;

    return module.exports;
  }
});
