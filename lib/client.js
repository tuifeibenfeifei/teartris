/**
 * TearTris · 撕纸俄罗斯方块 — DSH 插件客户端半部（纯 DOM，无 React 依赖）
 *
 * 以 cordis client 插件的形式挂载：右下角悬浮启动按钮 + 可拖拽游戏面板
 * （iframe 指向 Node 半部提供的 /teartris/）。面板开关状态持久化在
 * localStorage。
 *
 * 注册方式与 DSH 生态一致：window.__ModuleLoader__.load({ id, factory })，
 * 由 DSH Web 客户端运行时按 cordis 插件调用 apply(ctx)。
 *
 * 注意（宿主约定）：package.json 里的 dsh.client.immediately 必须为 true，
 * 这个 bundle 才会随启动图一起加载；否则它只会被登记，永远不会执行，
 * 右下角的按钮也就不会出现。
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
      try { return localStorage.getItem(LS_OPEN) === '1'; } catch (e) { return false; }
    }
    function saveOpen(v) {
      try { localStorage.setItem(LS_OPEN, v ? '1' : '0'); } catch (e) { /* 隐私模式下忽略 */ }
    }

    var CSS =
      '.ttr-launcher{' +
        'position:fixed;right:18px;bottom:18px;z-index:2147483100;width:50px;height:50px;border-radius:14px;' +
        'border:1px solid rgba(124,156,255,.55);background:linear-gradient(135deg,rgba(124,156,255,.28),rgba(88,216,192,.22));' +
        'color:#fff;font-size:20px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 10px 28px rgba(0,0,0,.45);backdrop-filter:blur(6px);font-family:ui-monospace,Consolas,monospace;' +
        'transition:transform .12s,box-shadow .12s;padding:0;' +
      '}' +
      '.ttr-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(0,0,0,.5)}' +
      '.ttr-launcher[aria-expanded="true"]{border-color:rgba(88,216,192,.8);background:linear-gradient(135deg,rgba(88,216,192,.35),rgba(124,156,255,.28))}' +
      '.ttr-panel{' +
        'position:fixed;right:14px;bottom:14px;z-index:2147483090;width:min(400px,92vw);height:min(78vh,700px);' +
        'background:#0d1220;border:1px solid rgba(124,156,255,.35);border-radius:16px;overflow:hidden;' +
        'display:none;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.55);' +
      '}' +
      '.ttr-panel.ttr-open{display:flex}' +
      '.ttr-panel.ttr-dragging{transition:none}' +
      '.ttr-head{' +
        'height:36px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;' +
        'background:rgba(124,156,255,.10);border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none;' +
        'touch-action:none;' +
      '}' +
      '.ttr-head:active{cursor:grabbing}' +
      '.ttr-title{flex:1;font-size:12.5px;font-weight:700;color:#dfe6f5;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ttr-head button{' +
        'border:0;background:transparent;color:#8fa3c8;width:26px;height:26px;border-radius:7px;cursor:pointer;' +
        'font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;font-family:inherit;' +
      '}' +
      '.ttr-head button:hover{background:rgba(255,255,255,.10);color:#fff}' +
      '.ttr-kbd{font-size:11px;line-height:1;padding:3px 7px;border-radius:6px;border:1px solid transparent;' +
        'color:#5f6c86;letter-spacing:.5px;white-space:nowrap;cursor:default;user-select:none}' +
      '.ttr-kbd.ttr-on{color:#8fe6d2;border-color:rgba(88,216,192,.45);background:rgba(88,216,192,.10)}' +
      '.ttr-frame{flex:1;width:100%;height:100%;border:0;background:#0a0e17;display:block}';

    function mount() {
      var host = document.createElement('div');
      host.setAttribute('data-teartris', '');
      document.body.appendChild(host);

      var style = document.createElement('style');
      style.textContent = CSS;
      host.appendChild(style);

      var launcher = document.createElement('button');
      launcher.className = 'ttr-launcher';
      launcher.type = 'button';
      launcher.title = '撕纸俄罗斯方块 TearTris';
      launcher.textContent = 'T';
      launcher.setAttribute('aria-label', '打开撕纸俄罗斯方块');
      launcher.setAttribute('aria-expanded', 'false');

      var panel = document.createElement('div');
      panel.className = 'ttr-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'TearTris 撕纸俄罗斯方块');

      var head = document.createElement('div');
      head.className = 'ttr-head';
      var title = document.createElement('span');
      title.className = 'ttr-title';
      title.textContent = 'TearTris · 撕纸俄罗斯方块';
      // 键盘接管状态提示：⌨ 亮着表示面板正在吃主界面的方向键/空格
      var kbd = document.createElement('span');
      kbd.className = 'ttr-kbd';
      kbd.textContent = '⌨ 接管';
      kbd.title = '面板打开时，方向键与空格会直接送给游戏；点一下游戏画面即可让键盘回到聊天框';
      var minBtn = document.createElement('button');
      minBtn.type = 'button';
      minBtn.className = 'ttr-min';
      minBtn.title = '收起';
      minBtn.setAttribute('aria-label', '收起面板');
      minBtn.textContent = '−';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ttr-close';
      closeBtn.title = '关闭';
      closeBtn.setAttribute('aria-label', '关闭面板');
      closeBtn.textContent = '×';
      head.appendChild(title);
      head.appendChild(kbd);
      head.appendChild(minBtn);
      head.appendChild(closeBtn);

      var frame = document.createElement('iframe');
      frame.className = 'ttr-frame';
      frame.src = PANEL_URL;
      frame.title = 'TearTris';
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('loading', 'lazy');

      panel.appendChild(head);
      panel.appendChild(frame);
      document.body.appendChild(launcher);
      document.body.appendChild(panel);

      // ---- 拖拽：用指针捕获把监听限制在标题栏上，避免全局监听器 ----
      var dragging = false, offsetX = 0, offsetY = 0, pointerId = null;

      function clampToViewport() {
        var r = panel.getBoundingClientRect();
        var maxX = Math.max(4, window.innerWidth - r.width - 4);
        var maxY = Math.max(4, window.innerHeight - r.height - 4);
        var x = Math.min(Math.max(4, r.left), maxX);
        var y = Math.min(Math.max(4, r.top), maxY);
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      function onDown(e) {
        if (e.target.closest('button')) return;
        dragging = true;
        pointerId = e.pointerId;
        var r = panel.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        panel.classList.add('ttr-dragging');
        if (head.setPointerCapture) head.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      function onMove(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        var r = panel.getBoundingClientRect();
        var x = Math.min(Math.max(4, e.clientX - offsetX), Math.max(4, window.innerWidth - r.width - 4));
        var y = Math.min(Math.max(4, e.clientY - offsetY), Math.max(4, window.innerHeight - r.height - 4));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      function onUp(e) {
        if (!dragging || (e && e.pointerId !== pointerId)) return;
        dragging = false;
        pointerId = null;
        panel.classList.remove('ttr-dragging');
      }
      head.addEventListener('pointerdown', onDown);
      head.addEventListener('pointermove', onMove);
      head.addEventListener('pointerup', onUp);
      head.addEventListener('pointercancel', onUp);
      window.addEventListener('resize', clampToViewport);
      // 双击标题栏回到默认的右下角
      head.addEventListener('dblclick', function () {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '14px';
        panel.style.bottom = '14px';
      });

      function isOpen() { return panel.classList.contains('ttr-open'); }
      function show() {
        panel.classList.add('ttr-open');
        launcher.setAttribute('aria-expanded', 'true');
        kbd.classList.add('ttr-on');
        saveOpen(true);
      }
      function hide() {
        panel.classList.remove('ttr-open');
        launcher.setAttribute('aria-expanded', 'false');
        kbd.classList.remove('ttr-on');
        saveOpen(false);
      }
      function toggle() { if (isOpen()) hide(); else show(); }

      launcher.addEventListener('click', toggle);
      closeBtn.addEventListener('click', hide);
      minBtn.addEventListener('click', hide);

      // 面板打开时，把主界面的按键转给游戏 iframe。
      // 用 postMessage 而不是让 iframe 抢焦点：这样在 DSH 聊天框里打字时
      // 也能直接玩（游戏页自己会忽略输入框里的按键）。
      var GAME_CODES = {
        ArrowLeft: 1, ArrowRight: 1, ArrowDown: 1, ArrowUp: 1, Space: 1,
        KeyX: 1, KeyZ: 1, KeyC: 1, KeyP: 1, KeyR: 1, KeyM: 1
      };
      // 焦点已经在游戏里时宿主不要再抢一次，否则按一下会生效两遍
      var gameHasFocus = false;
      function onFrameFocus() { gameHasFocus = true; }
      function onFrameBlur() { gameHasFocus = false; }
      frame.addEventListener('load', function () {
        try {
          var win = frame.contentWindow;
          win.addEventListener('focus', onFrameFocus);
          win.addEventListener('blur', onFrameBlur);
        } catch (err) { /* 同源才绑得上，跨域时靠下面的判断兜底 */ }
      });

      function forwardKey(e) {
        if (!isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!GAME_CODES[e.code]) return;
        // 事件本来就来自游戏文档时不用转发（那时游戏会自己处理）
        if (gameHasFocus && e.target && frame.contentDocument && e.target.ownerDocument === frame.contentDocument) return;
        var target = frame.contentWindow;
        if (!target) return;
        try {
          target.postMessage({ type: 'teartris:key', code: e.code }, window.location.origin);
        } catch (err) { /* 跨域时静默失败；游戏仍可用面板自己的按键 */ }
        e.preventDefault();
        e.stopPropagation();
      }
      window.addEventListener('keydown', forwardKey, true);

      if (loadOpen()) show();

      return function cleanup() {
        head.removeEventListener('pointerdown', onDown);
        head.removeEventListener('pointermove', onMove);
        head.removeEventListener('pointerup', onUp);
        head.removeEventListener('pointercancel', onUp);
        window.removeEventListener('resize', clampToViewport);
        window.removeEventListener('keydown', forwardKey, true);
        launcher.remove();
        panel.remove();
        style.remove();
        host.remove();
      };
    }

    function apply(ctx) {
      ctx.effect(function () {
        return mount();
      }, 'teartris: panel mount');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;

    return module.exports;
  }
});
