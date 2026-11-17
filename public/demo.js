/**
 * 优惠券发放与核销服务 · 单页交互演示
 *
 * 说明：本文件必须以外部脚本引入。
 * 服务端启用 helmet 默认 CSP（script-src 'self' / script-src-attr 'none'），
 * 内联 <script> 与 onclick= 属性都会被浏览器拦截，因此所有逻辑放在这里，
 * 所有事件用 addEventListener 绑定。
 */
(function () {
  'use strict';

  var API = location.origin + '/api';
  var USER_TOKEN = '';
  var ADMIN_TOKEN = '';
  var LAST_CODE = '';
  var LAST_TPL = '';
  var LAST_REDEEM = null;
  var INV_BEFORE = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* 非阻塞提示：alert() 会卡住页面并阻塞录屏，这里改成页内浮层 */
  function toast(msg) {
    var old = document.getElementById('demoToast');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'demoToast';
    d.textContent = '⚠️ ' + msg;
    d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;' +
      'background:#fef3e0;color:#b45309;border:1px solid #fcd34d;border-radius:8px;' +
      'padding:10px 18px;font-size:14px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.14)';
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
  }

  /* =========================================================
   * 操作步骤标注层（录屏用）：由录制脚本通过 window.anno.* 驱动
   * ========================================================= */
  var anno = {
    layer: null,
    on: function () {
      if (!this.layer) this.layer = el('annoLayer');
      if (this.layer) this.layer.classList.add('on');
    },
    _mk: function (cls, html, pos) {
      var d = document.createElement('div');
      d.className = cls;
      if (html) d.innerHTML = html;
      if (pos) { d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px'; }
      return d;
    },
    step: function (no, title, api) {
      this.on();
      var old = el('annoStep');
      if (old) old.remove();
      var d = this._mk('anno-step', '<span class="anno-n">' + esc(no) + '</span>' +
        '<span class="anno-t">' + esc(title) + '</span>' +
        (api ? '<span class="anno-api">' + esc(api) + '</span>' : ''));
      d.id = 'annoStep';
      this.layer.appendChild(d);
    },
    cap: function (text) {
      this.on();
      var old = el('annoCap');
      if (old) old.remove();
      var d = this._mk('anno-cap', text);
      d.id = 'annoCap';
      this.layer.appendChild(d);
    },
    ring: function (sel, label, tip) {
      this.on();
      this.clear();
      var target = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!target) return;
      this._target = target; this._label = label; this._tip = tip;
      this._place();
      if (!this._bound) {
        this._bound = true;
        var self = this;
        window.addEventListener('scroll', function () { self._place(); }, { passive: true });
        window.addEventListener('resize', function () { self._place(); }, { passive: true });
      }
    },
    /* 页面滚动后重新定位聚光灯 / 标签 / 指针，避免标注漂移到别的内容上 */
    _place: function () {
      var target = this._target;
      if (!target || !target.isConnected) { this.clear(); return; }
      var r = target.getBoundingClientRect();
      var box = el('annoRing');
      var lb = el('annoLabel');
      var tp = el('annoTip');
      var visible = r.bottom > 0 && r.top < (window.innerHeight || 1080) && r.width > 0;
      if (!visible) {
        [box, lb, tp].forEach(function (n) { if (n) n.style.display = 'none'; });
        return;
      }
      [box, lb, tp].forEach(function (n) { if (n) n.style.display = ''; });
      var pad = 6;
      if (!box) {
        box = this._mk('anno-ring');
        box.id = 'annoRing';
        this.layer.appendChild(box);
      }
      box.style.left = (r.left - pad) + 'px';
      box.style.top = (r.top - pad) + 'px';
      box.style.width = (r.width + pad * 2) + 'px';
      box.style.height = (r.height + pad * 2) + 'px';
      if (this._label) {
        if (!lb) { lb = this._mk('anno-label', esc(this._label)); lb.id = 'annoLabel'; this.layer.appendChild(lb); }
        lb.style.left = (r.left + r.width / 2) + 'px';
        lb.style.top = Math.max(4, r.top - 34) + 'px';
      }
      if (this._tip) {
        if (!tp) { tp = this._mk('anno-tip', esc(this._tip)); tp.id = 'annoTip'; this.layer.appendChild(tp); }
        tp.style.left = (r.right + 18) + 'px';
        tp.style.top = (r.top + r.height / 2) + 'px';
        tp.style.transform = 'translateY(-50%)';
      }
    },
    hit: function () {
      var box = el('annoRing');
      if (box) box.classList.add('hit');
    },
    clear: function () {
      this._target = null;
      ['annoRing', 'annoLabel', 'annoTip'].forEach(function (id) {
        var n = el(id); if (n) n.remove();
      });
    },
    reset: function () {
      this.clear();
      var s = el('annoStep'); if (s) s.remove();
      var c = el('annoCap'); if (c) c.remove();
    }
  };
  window.anno = anno;

  function fmt(resp, box) {
    var ok = resp.ok;
    var head = '<span class="' + (ok ? 'ok' : 'err') + '">' + (ok ? '✓ 成功' : '✗ 失败') + '</span>  HTTP ' + resp.status;
    el(box).innerHTML = head + '\n' + esc(JSON.stringify(resp.body, null, 2));
  }

  function needLogin() {
    if (!USER_TOKEN) { toast('请先完成第 1 步登录（user1）'); return false; }
    return true;
  }

  function needAdmin() {
    if (!ADMIN_TOKEN) { toast('请先以 admin 登录（步骤 1 的第二个按钮）'); return false; }
    return true;
  }

  async function req(path, opts, token) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var tk = token === undefined ? USER_TOKEN : token;
    if (tk) opts.headers['Authorization'] = 'Bearer ' + tk;
    var url;
    if (/^https?:\/\//i.test(path)) url = path;
    else if (path.charAt(0) === '/' && path.indexOf('/api/') === 0) url = location.origin + path;
    else url = API + path;
    try {
      var r = await fetch(url, opts);
      var body; var ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) body = await r.json();
      else body = await r.text();
      return { ok: r.ok, status: r.status, body: body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: { code: 'NETWORK', message: String(e) } } };
    }
  }

  function json(body) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

  /* 每次演示运行生成唯一的幂等键前缀：否则第二次跑演示时，
     服务端会命中历史 idempotency_records 直接 replay，导致「防超发第 2 次」变成 200。 */
  var RUN_TAG = 'run' + Date.now().toString(36);
  var uniqKey = function (name) { return RUN_TAG + '-' + name; };

  /* 把幂等键字段刷成「本次运行的新键」，保证第 1 次是真的领、第 2 次才是幂等重放 */
  function freshIdemKey(name) {
    var k = uniqKey(name);
    var el2 = document.getElementById('idemKey');
    if (el2) el2.value = k;
    return k;
  }

  async function checkHealth() {
    var r = await req('/health', {}, null);
    var ok = r.ok;
    el('svcBadge').className = 'badge ' + (ok ? 'on' : 'off');
    el('svcBadge').innerHTML = '<span class="dot"></span>服务状态：' + (ok ? '正常' : '异常');
  }

  async function doLogin(which) {
    var isAdmin = which === 'admin';
    var u = isAdmin ? 'admin' : 'user1';
    var p = isAdmin ? 'Admin@123456' : 'Test@123456';
    var r = await req('/auth/login', { method: 'POST', ...json({ username: u, password: p }) }, null);
    fmt(r, 'respLogin');
    if (r.ok && r.body.data) {
      if (isAdmin) {
        ADMIN_TOKEN = r.body.data.token;
        el('adminBadge').className = 'badge on';
        el('adminBadge').innerHTML = '<span class="dot"></span>管理员：admin';
      } else {
        USER_TOKEN = r.body.data.token;
        el('userBadge').className = 'badge on';
        el('userBadge').innerHTML = '<span class="dot"></span>已登录：user1';
        await resolveTemplate();
      }
    } else if (!isAdmin) {
      USER_TOKEN = '';
      el('userBadge').className = 'badge off';
      el('userBadge').innerHTML = '<span class="dot"></span>用户未登录';
    }
  }

  /* 从 /api/coupons?activityId=demo-activity 里取 template_id，登录后自动填入 */
  async function resolveTemplate() {
    var r = await req('/coupons?activityId=demo-activity&limit=1');
    if (r.ok && r.body.data && r.body.data.length && r.body.data[0].template_id) {
      LAST_TPL = r.body.data[0].template_id;
      el('tplId').value = LAST_TPL;
    }
  }

  async function getTemplateDetail() {
    if (!needLogin() || !LAST_TPL) return;
    var r = await req('/templates/' + LAST_TPL);
    fmt(r, 'respClaim');
  }

  async function claim(idemKey, deviceId) {
    if (!needLogin() || !LAST_TPL) return null;
    var r = await req('/claims', {
      method: 'POST',
      ...json({
        templateId: LAST_TPL,
        idempotencyKey: idemKey,
        deviceId: deviceId,
        ip: '127.0.0.1'
      })
    });
    fmt(r, 'respClaim');
    if (r.ok && r.body.data) {
      LAST_CODE = r.body.data.code;
      el('couponCode').value = LAST_CODE;
      el('claimStats').innerHTML =
        '<div class="kv"><span>券码</span><b>' + esc(LAST_CODE) + '</b></div>' +
        '<div class="kv"><span>状态</span><b><span class="pill g">unused 未使用</span></b></div>' +
        '<div class="kv"><span>幂等重放</span><b>' + (r.body.data.replay ? 'replay=true（返回首次结果）' : 'false（首次领取）') + '</b></div>' +
        '<div class="kv"><span>模板 / 活动</span><b>' + esc(r.body.data.templateId) + ' · ' + esc(r.body.data.activityId) + '</b></div>';
    }
    return r;
  }

  async function setAntiAbuse() {
    if (!needAdmin() || !LAST_TPL) return;
    var r = await req('/templates/' + LAST_TPL + '/anti-abuse', {
      method: 'PUT',
      ...json({ perUser: 1, perDevice: 1, perIp: 10, enabled: true })
    }, ADMIN_TOKEN);
    fmt(r, 'respLimit');
  }

  function showDeny(r) {
    var code = r.body && r.body.error ? r.body.error.code : '';
    var denied = !r.ok && (code === 'CLAIM_LIMIT_USER' ||
       code === 'CLAIM_LIMIT_DEVICE' ||
       code === 'CLAIM_LIMIT_IP' ||
       code === 'CLAIM_PER_USER_EXCEEDED');
    el('denyBanner').style.display = denied ? 'block' : 'none';
    if (denied) {
      el('denyBanner').textContent = '🚫 已被限领规则拦截（' + code + '：' + r.body.error.message + '）';
    }
    if (denied) {
      el('limitStats').innerHTML =
        '<div class="kv"><span>拦截结果</span><b><span class="pill r">' + esc(code) + '</span></b></div>' +
        '<div class="kv"><span>说明</span><b>' + esc(r.body.error.message) + '</b></div>' +
        '<div class="kv"><span>HTTP</span><b>429 Too Many Requests</b></div>';
    }
  }

  async function claimAgain(deviceId, tag, token) {
    if (!needLogin() || !LAST_TPL) return null;
    var r = await req('/claims', {
      method: 'POST',
      ...json({ templateId: LAST_TPL, idempotencyKey: tag, deviceId: deviceId, ip: '127.0.0.1' })
    }, token || USER_TOKEN);
    fmt(r, 'respLimit');
    showDeny(r);
    return r;
  }

  /* 防超发：新建一个只有 1 张库存的模板，同一用户连抢 2 次 */
  async function oversell() {
    if (!needAdmin()) return;
    var t = Date.now();
    var r0 = await req('/templates', {
      method: 'POST',
      ...json({
        name: '防超发演示模板（仅 1 张）',
        activityId: 'oversell-demo',
        total: 1,
        discount: 1000,
        perUser: 10,
        startAt: t - 60000,
        endAt: t + 86400000
      })
    }, ADMIN_TOKEN);
    if (!r0.ok || !r0.body.data) { fmt(r0, 'respLimit'); return; }
    var smallTpl = r0.body.data.id;
    fmt(r0, 'respLimit');
    var a = await req('/claims', {
      method: 'POST',
      ...json({ templateId: smallTpl, idempotencyKey: uniqKey('ov-1'), deviceId: 'dev-ov', ip: '127.0.0.1' })
    });
    var b = await req('/claims', {
      method: 'POST',
      ...json({ templateId: smallTpl, idempotencyKey: uniqKey('ov-2'), deviceId: 'dev-ov', ip: '127.0.0.1' })
    });
    var inv = await req('/templates/' + smallTpl + '/inventory', {}, ADMIN_TOKEN);
    el('respLimit').innerHTML =
      '<span class="ok">✓ 成功</span>  HTTP ' + a.status + '  第 1 次领取（库存 1 张）\n' +
      esc(JSON.stringify(a.body, null, 2)) + '\n\n' +
      '<span class="' + (b.ok ? 'ok' : 'err') + '">' + (b.ok ? '✓ 成功' : '✗ 失败') + '</span>  HTTP ' + b.status + '  第 2 次领取（应被拦截）\n' +
      esc(JSON.stringify(b.body, null, 2)) + '\n\n' +
      '<span class="ok">✓ 成功</span>  HTTP ' + inv.status + '  库存核对\n' +
      esc(JSON.stringify(inv.body, null, 2));
    if (inv.ok && inv.body.data) {
      var d = inv.body.data;
      el('limitStats').innerHTML =
        '<div class="kv"><span>防超发核对</span><b><span class="pill g">恰好售出 ' + d.claimed + ' / ' + d.total + ' 张，无超发</span></b></div>' +
        '<div class="kv"><span>剩余库存</span><b>' + d.remaining + '</b></div>';
    }
  }

  async function redeem(orderNo) {
    if (!needLogin()) return null;
    var code = el('couponCode').value.trim();
    if (!code) { toast('请先在步骤2领一张券'); return null; }
    var r = await req('/redemptions', { method: 'POST', ...json({ code: code, orderNo: orderNo }) });
    fmt(r, 'respRedeem');
    LAST_REDEEM = r;
    return r;
  }

  /* 同订单号重复核销：用<b>另一张新券</b>去核销<b>同一个订单号</b>，
     这样服务端走的是「该订单号已被占用」分支（409 ORDER_ALREADY_USED），
     而不是「这张券已经核销过」分支（409 COUPON_ALREADY_USED）。
     新券由管理员领（admin 在该模板上还没领过），设备换新的以绕开单设备限额。 */
  async function redeemSameOrder(orderNo) {
    if (!needLogin() || !LAST_TPL) return null;
    var r2 = await req('/claims', {
      method: 'POST',
      ...json({ templateId: LAST_TPL, idempotencyKey: uniqKey('dup-order'), deviceId: 'dev-dup', ip: '127.0.0.1' })
    }, ADMIN_TOKEN);
    if (!r2.ok || !r2.body.data) {
      toast('新券领取失败：' + (r2.body && r2.body.error ? r2.body.error.code : '未知'));
      return null;
    }
    var r3 = await req('/redemptions', {
      method: 'POST',
      ...json({ code: r2.body.data.code, orderNo: orderNo })
    });
    var first = LAST_REDEEM
      ? '<span class="ok">✓ 成功</span>  HTTP ' + LAST_REDEEM.status + '  第 1 次核销（券 ' + esc(el('couponCode').value.trim()) + '）\n' +
        esc(JSON.stringify(LAST_REDEEM.body, null, 2)) + '\n\n'
      : '';
    el('respRedeem').innerHTML = first +
      '<span class="err">✗ 失败</span>  HTTP ' + r3.status + '  换一张新券（' + esc(r2.body.data.code) + '）、用<b>同一订单号</b>核销 → 应被拦截\n' +
      esc(JSON.stringify(r3.body, null, 2)) +
      '\n\n<span class="tiny">redemption_records 对 order_no 唯一 —— 同一订单号只允许核销一张券</span>';
    return r3;
  }

  async function queryByCode() {
    if (!needLogin()) return;
    var code = el('couponCode').value.trim();
    if (!code) { toast('请先领券'); return; }
    var r = await req('/coupons/by-code/' + encodeURIComponent(code));
    fmt(r, 'respRedeem');
  }

  async function inventory(label) {
    if (!needLogin() || !LAST_TPL) return null;
    var r = await req('/templates/' + LAST_TPL + '/inventory');
    fmt(r, 'respRefund');
    if (r.ok && r.body.data) {
      var d = r.body.data;
      if (label === 'before') {
        INV_BEFORE = d;
        el('invDiff').innerHTML = invRows('退券前', d);
      } else if (label === 'after' && INV_BEFORE) {
        var diff = '';
        ['claimed', 'redeemed', 'refunded'].forEach(function (k) {
          var delta = d[k] - INV_BEFORE[k];
          diff += '<div class="kv"><span>' + k + ' 变化</span><b>' +
            (delta > 0 ? '+' : '') + delta + '（' + INV_BEFORE[k] + ' → ' + d[k] + '）</b></div>';
        });
        el('invDiff').innerHTML = invRows('退券前', INV_BEFORE) + diff + invRows('退券后', d);
      }
    }
    return r;
  }

  function invRows(title, d) {
    return '<div class="kv"><span>' + title + ' 库存</span><b>' +
      'total ' + d.total + ' · claimed ' + d.claimed + ' · redeemed ' + d.redeemed +
      ' · refunded ' + d.refunded + ' · expired ' + d.expired + ' · remaining ' + d.remaining +
      '</b></div>';
  }

  async function refund() {
    if (!needAdmin()) return;
    var code = el('couponCode').value.trim();
    if (!code) { toast('请先领券并核销'); return; }
    var r = await req('/refunds', { method: 'POST', ...json({ code: code, reason: '用户取消订单' }) }, ADMIN_TOKEN);
    fmt(r, 'respRefund');
  }

  async function loadLogs() {
    if (!needLogin()) return;
    var r = await req('/logs?activityId=demo-activity&limit=12');
    fmt(r, 'respLogs');
  }

  async function queryCoupon() {
    if (!needLogin()) return;
    var code = el('couponCode').value.trim();
    if (!code) { toast('请先领券'); return; }
    var r = await req('/coupons?code=' + encodeURIComponent(code));
    fmt(r, 'respLogs');
  }

  function bind() {
    el('btnLogin').addEventListener('click', function () { doLogin('user'); });
    el('btnAdmin').addEventListener('click', function () { doLogin('admin'); });
    el('btnClaim').addEventListener('click', function () { claim(freshIdemKey('claim'), el('deviceId').value); });
    el('btnReplay').addEventListener('click', function () { claim(el('idemKey').value, el('deviceId').value); });
    el('btnTpl').addEventListener('click', getTemplateDetail);
    el('btnRule').addEventListener('click', setAntiAbuse);
    el('btnLimitUser').addEventListener('click', function () { claimAgain('dev-2', uniqKey('limit-user')); });
    el('btnLimitDevice').addEventListener('click', function () { claimAgain(el('deviceId').value, uniqKey('limit-device'), ADMIN_TOKEN); });
    el('btnOversell').addEventListener('click', oversell);
    el('btnRedeem').addEventListener('click', function () { redeem(el('orderNo').value); });
    el('btnRedeemAgain').addEventListener('click', function () { redeemSameOrder(el('orderNo').value); });
    el('btnCode').addEventListener('click', queryByCode);
    el('btnInvBefore').addEventListener('click', function () { inventory('before'); });
    el('btnRefund').addEventListener('click', refund);
    el('btnInvAfter').addEventListener('click', function () { inventory('after'); });
    el('btnLogs').addEventListener('click', loadLogs);
    el('btnCouponList').addEventListener('click', queryCoupon);
  }

  function start() {
    bind();
    checkHealth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
