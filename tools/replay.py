#!/usr/bin/env python
"""把 tests/shot.mjs 录下来的 Canvas 指令序列重放成 PNG。

只支持 TearTris 实际用到的那部分 Canvas 2D：
路径（moveTo/lineTo/arcTo/quadraticCurveTo/closePath）、fill/stroke/clip（含偶奇之外的
非零环绕近似）、fillRect/strokeRect/clearRect、drawImage（3/5/9 参数）、
线性渐变、globalAlpha、save/restore、translate/rotate/setTransform。

用法：
    python tools/replay.py tests/last-frame.json screenshot.png [--board-only]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ----------------------------------------------------------------- 颜色与几何
def parse_color(value):
    """把 canvas 颜色字符串解析成 (r,g,b,a)。"""
    if value is None:
        return (0, 0, 0, 255)
    if isinstance(value, (list, tuple)):
        if len(value) == 4 and isinstance(value[0], int):
            return tuple(value)
        return parse_color(value[0] if value else None)
    text = str(value).strip()
    if text.startswith('#'):
        h = text[1:]
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        if len(h) == 6:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
        if len(h) == 8:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16))
        raise ValueError(f'认不出的颜色：{text}')
    if text.startswith('rgb'):
        inside = text[text.index('(') + 1:text.rindex(')')]
        parts = [p.strip() for p in inside.replace('/', ',').split(',') if p.strip()]
        nums = []
        for i, p in enumerate(parts):
            if p.endswith('%'):
                nums.append(round(float(p[:-1]) / 100 * 255))
            elif i == 3:
                nums.append(round(float(p) * 255))
            else:
                nums.append(round(float(p)))
        while len(nums) < 3:
            nums.append(0)
        if len(nums) == 3:
            nums.append(255)
        return tuple(nums[:4])
    named = {'white': (255, 255, 255, 255), 'black': (0, 0, 0, 255), 'transparent': (0, 0, 0, 0)}
    if text.lower() in named:
        return named[text.lower()]
    raise ValueError(f'认不出的颜色：{text}')


def apply_alpha(color, factor):
    r, g, b, a = color
    a = int(round(a * max(0.0, min(1.0, factor))))
    if a < 0:
        a = 0
    if a > 255:
        a = 255
    return (r, g, b, a)


def arc_to_points(x1, y1, x2, y2, r, current, resolution=8):
    """把 canvas 的 arcTo 近似成一段圆弧采样点（半径小、角度小，视觉上等价）。"""
    if current is None:
        return [(x1, y1)]
    px, py = current
    v1 = (px - x1, py - y1)
    v2 = (x2 - x1, y2 - y1)
    l1 = math.hypot(*v1)
    l2 = math.hypot(*v2)
    if l1 < 1e-6 or l2 < 1e-6:
        return [(x1, y1)]
    u1 = (v1[0] / l1, v1[1] / l1)
    u2 = (v2[0] / l2, v2[1] / l2)
    cos_theta = max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1]))
    theta = math.acos(cos_theta)
    if theta < 1e-6 or abs(math.pi - theta) < 1e-6:
        return [(x1, y1)]
    tangent = r / math.tan(theta / 2.0)
    tangent = min(tangent, l1, l2)
    t1 = (x1 + u1[0] * tangent, y1 + u1[1] * tangent)
    t2 = (x2 + u2[0] * tangent, y2 + u2[1] * tangent)
    # 圆心：从切点沿法线偏移
    bis = (u1[0] + u2[0], u1[1] + u2[1])
    bl = math.hypot(*bis)
    if bl < 1e-6:
        return [t1, t2]
    bis = (bis[0] / bl, bis[1] / bl)
    dist = math.hypot(t1[0] - x1, t1[1] - y1)
    h = math.sqrt(max(0.0, r * r - 0.0))
    half = theta / 2.0
    centre_dist = (r / math.sin(half)) if math.sin(half) > 1e-9 else 0.0
    cx = x1 + bis[0] * centre_dist
    cy = y1 + bis[1] * centre_dist
    a1 = math.atan2(t1[1] - cy, t1[0] - cx)
    a2 = math.atan2(t2[1] - cy, t2[0] - cx)
    delta = a2 - a1
    while delta > math.pi:
        delta -= 2 * math.pi
    while delta < -math.pi:
        delta += 2 * math.pi
    pts = []
    for i in range(1, resolution + 1):
        ang = a1 + delta * (i / resolution)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def ellipse_points(cx, cy, rx, ry, rot, a0, a1, resolution=48):
    pts = []
    span = a1 - a0
    if abs(span) < 1e-9:
        span = 2 * math.pi
    for i in range(resolution + 1):
        ang = a0 + span * (i / resolution)
        x = rx * math.cos(ang)
        y = ry * math.sin(ang)
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot),
                    cy + x * math.sin(rot) + y * math.cos(rot)))
    return pts


def quad_points(cx, cy, x, y, current, resolution=14):
    if current is None:
        return [(x, y)]
    x0, y0 = current
    pts = []
    for i in range(1, resolution + 1):
        t = i / resolution
        mt = 1 - t
        pts.append((mt * mt * x0 + 2 * mt * t * cx + t * t * x,
                    mt * mt * y0 + 2 * mt * t * cy + t * t * y))
    return pts


def transform_point(pt, matrix):
    a, b, c, d, e, f = matrix
    x, y = pt
    return (a * x + c * y + e, b * x + d * y + f)


def mat_mul(m1, m2):
    """m1 ∘ m2（先 m2 后 m1）。"""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
    )


# ----------------------------------------------------------------- 渐变
def gradient_image(x0, y0, x1, y1, stops):
    """线性渐变条。

    注意：浏览器在**预乘 alpha** 空间插值，所以 rgba(255,255,255,.38) → rgba(255,255,255,0)
    在中点上是 alpha≈.19 的白色，而不是“混了黑色”的灰。这里按同样规则算，
    否则方块的高光/暗影会被画成灰色描边。
    """
    n = 256
    strip = Image.new('RGBA', (n, 1))
    px = strip.load()
    parsed = sorted(((off, parse_color(col)) for off, col in stops), key=lambda s: s[0])
    for i in range(n):
        t = i / (n - 1)
        lo, hi = parsed[0], parsed[-1]
        for j in range(len(parsed) - 1):
            if parsed[j][0] <= t <= parsed[j + 1][0]:
                lo, hi = parsed[j], parsed[j + 1]
                break
        span = hi[0] - lo[0]
        k = 0.0 if span <= 1e-9 else (t - lo[0]) / span
        out = []
        for c in range(3):
            a_lo, a_hi = lo[1][3] / 255.0, hi[1][3] / 255.0
            pre = lo[1][c] * a_lo + (hi[1][c] * a_hi - lo[1][c] * a_lo) * k
            alpha = a_lo + (a_hi - a_lo) * k
            out.append(0 if alpha <= 1e-6 else max(0, min(255, round(pre / alpha))))
        alpha = round(255 * (lo[1][3] / 255.0 + (hi[1][3] / 255.0 - lo[1][3] / 255.0) * k))
        px[i, 0] = (out[0], out[1], out[2], max(0, min(255, alpha)))
    length = math.hypot(x1 - x0, y1 - y0)
    if length < 1e-6:
        return strip.resize((1, 1))
    angle = math.degrees(math.atan2(y1 - y0, x1 - x0))
    big = strip.resize((max(2, int(round(length))), 1), Image.BILINEAR)
    return big.rotate(-angle, expand=True, resample=Image.BILINEAR)


# ----------------------------------------------------------------- 画笔
class Painter:
    def __init__(self, surface, images, gradients=None):
        self.img = surface
        self.draw = ImageDraw.Draw(surface, 'RGBA')
        self.images = images
        self.gradients = gradients if gradients is not None else {}
        self.matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        self.stack = []
        self.alpha = 1.0
        self.path = []
        self.current = None
        self.clip = None

    def gradient_of(self, ref):
        """把 {kind:'gradient', id} 解析成渐变定义。"""
        if isinstance(ref, dict) and ref.get('kind') == 'gradient':
            return self.gradients.get(ref.get('id'))
        return None

    # ---- 变换 ----
    def push(self):
        self.stack.append((self.matrix, self.alpha, self.clip))

    def pop(self):
        self.matrix, self.alpha, self.clip = self.stack.pop()

    def tp_all(self, pts):
        return [transform_point(pt, self.matrix) for pt in pts]

    def build_polygon(self):
        return self.tp_all(self.path)

    def run(self, ops, depth=0):
        for name, args in ops:
            self.op(name, args, depth)

    def op(self, name, args, depth):
        if name == 'save':
            self.push()
        elif name == 'restore':
            self.pop()
        elif name == 'translate':
            self.matrix = mat_mul(self.matrix, (1, 0, 0, 1, args[0], args[1]))
        elif name == 'rotate':
            a = args[0]
            self.matrix = mat_mul(self.matrix, (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0))
        elif name == 'scale':
            self.matrix = mat_mul(self.matrix, (args[0], 0, 0, args[1], 0, 0))
        elif name == 'setTransform':
            self.matrix = tuple(args)
        elif name == 'resetTransform':
            self.matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        elif name == 'beginPath':
            self.path, self.current = [], None
        elif name == 'closePath':
            if self.path:
                self.path.append(self.path[0])
        elif name == 'moveTo':
            self.path.append((args[0], args[1]))
            self.current = (args[0], args[1])
        elif name == 'lineTo':
            self.path.append((args[0], args[1]))
            self.current = (args[0], args[1])
        elif name == 'arcTo':
            pts = arc_to_points(args[0], args[1], args[2], args[3], args[4], self.current)
            self.path.extend(pts)
            self.current = (args[2], args[3])
        elif name == 'quadraticCurveTo':
            pts = quad_points(args[0], args[1], args[2], args[3], self.current)
            self.path.extend(pts)
            self.current = (args[2], args[3])
        elif name == 'arc':
            pts = ellipse_points(args[0], args[1], args[2], args[2], 0, args[3], args[4])
            self.path.extend(pts)
            self.current = pts[-1] if pts else self.current
        elif name == 'ellipse':
            pts = ellipse_points(args[0], args[1], args[2], args[3], args[4], args[5], args[6])
            self.path.extend(pts)
            self.current = pts[-1] if pts else self.current
        elif name == 'rect':
            x, y, w, h = args
            self.path.extend([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
            self.current = (x, y)
        elif name == 'clip':
            self.clip = self.build_polygon()
        elif name == 'fill':
            poly = self.build_polygon()
            style, alpha = args[0], args[1]
            if len(poly) >= 3:
                if self.clip:
                    self._fill_clipped(poly, style, alpha)
                elif self.gradient_of(style) is not None:
                    self._fill_gradient(poly, self.gradient_of(style), alpha)
                else:
                    self._solid(poly, None, parse_color(style), alpha)
        elif name == 'stroke':
            poly = self.build_polygon()
            style, width, alpha = args
            if len(poly) >= 2:
                col = parse_color(None if self.gradient_of(style) is not None else style)
                lw = max(1, int(round(width * abs(self.matrix[0]))))
                self._stroke_poly(poly, lw, col, alpha)
        elif name == 'fillRect':
            x, y, w, h, style, alpha = args
            box = self.tp_all([(x, y), (x + w, y + h)])
            rect = [min(box[0][0], box[1][0]), min(box[0][1], box[1][1]),
                    max(box[0][0], box[1][0]), max(box[0][1], box[1][1])]
            grad = self.gradient_of(style)
            if grad is not None:
                self._fill_rect_gradient(rect, grad, alpha)
            else:
                self._solid(None, rect, parse_color(style), alpha)
        elif name == 'strokeRect':
            x, y, w, h, style, width, alpha = args
            box = self.tp_all([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
            self._stroke_poly(box, max(1, int(round(width * abs(self.matrix[0])))), parse_color(style), alpha)
        elif name == 'clearRect':
            x, y, w, h = args
            box = self.tp_all([(x, y), (x + w, y + h)])
            self.draw.rectangle((min(box[0][0], box[1][0]), min(box[0][1], box[1][1]),
                                 max(box[0][0], box[1][0]), max(box[0][1], box[1][1])), fill=(0, 0, 0, 0))
        elif name == 'gradient':
            pass
        elif name == 'drawImage':
            self._draw_image(args, depth)
        else:
            raise ValueError(f'重放器不认识这条指令：{name}')

    # ---- 具体绘制 ----
    def _solid(self, poly, rect, color, alpha):
        """PIL 的 Draw 会忽略 RGBA 的 alpha，所以先画到独立图层再 alpha_composite。"""
        if poly is not None:
            xs = [q[0] for q in poly]
            ys = [q[1] for q in poly]
            rect = [min(xs), min(ys), max(xs), max(ys)]
        elif rect is None:
            return
        col = apply_alpha(color, alpha)
        if col[3] == 0:
            return
        x0, y0 = int(math.floor(rect[0])), int(math.floor(rect[1]))
        x1, y1 = int(math.ceil(rect[2])) + 1, int(math.ceil(rect[3])) + 1
        if x1 <= x0 or y1 <= y0:
            return
        layer = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer, 'RGBA')
        if poly is not None:
            d.polygon([(q[0] - x0, q[1] - y0) for q in poly], fill=col)
        else:
            d.rectangle((rect[0] - x0, rect[1] - y0, rect[2] - x0, rect[3] - y0), fill=col)
        self.img.alpha_composite(layer, (x0, y0))

    def _stroke_poly(self, poly, width, color, alpha):
        col = apply_alpha(color, alpha)
        if col[3] == 0 or len(poly) < 2:
            return
        pad = width + 2
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        x0, y0 = int(math.floor(min(xs))) - pad, int(math.floor(min(ys))) - pad
        x1 = int(math.ceil(max(xs))) + pad + 1
        y1 = int(math.ceil(max(ys))) + pad + 1
        layer = Image.new('RGBA', (max(1, x1 - x0), max(1, y1 - y0)), (0, 0, 0, 0))
        ImageDraw.Draw(layer, 'RGBA').line([(q[0] - x0, q[1] - y0) for q in poly],
                                           fill=col, width=width, joint='curve')
        self.img.alpha_composite(layer, (x0, y0))

    def _fill_rect_gradient(self, rect, style, alpha):
        layer = gradient_image(style['x0'], style['y0'], style['x1'], style['y1'], style['stops'])
        w = max(1, int(round(rect[2] - rect[0])))
        h = max(1, int(round(rect[3] - rect[1])))
        layer = layer.resize((w, h), Image.BILINEAR)
        a = max(0.0, min(1.0, alpha))
        if a < 1.0:
            layer.putalpha(layer.getchannel('A').point(lambda v: int(v * a)))
        self.img.alpha_composite(layer, (int(round(rect[0])), int(round(rect[1]))))

    def _fill_gradient(self, poly, style, alpha):
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        rect = (min(xs), min(ys), max(xs), max(ys))
        layer = Image.new('RGBA', (max(1, int(rect[2] - rect[0]) + 1), max(1, int(rect[3] - rect[1]) + 1)), (0, 0, 0, 0))
        mask = Image.new('L', layer.size, 0)
        ImageDraw.Draw(mask).polygon([(q[0] - rect[0], q[1] - rect[1]) for q in poly], fill=255)
        grad = gradient_image(style['x0'], style['y0'], style['x1'], style['y1'], style['stops'])
        grad = grad.resize(layer.size, Image.BILINEAR)
        a = max(0.0, min(1.0, alpha))
        mask = mask.point(lambda v: int(v * a))
        layer.paste(grad, (0, 0), mask)
        self.img.alpha_composite(layer, (int(round(rect[0])), int(round(rect[1]))))

    def _fill_clipped(self, poly, style, alpha):
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        rect = (int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1)
        w = max(1, rect[2] - rect[0])
        h = max(1, rect[3] - rect[1])
        layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).polygon([(q[0] - rect[0], q[1] - rect[1]) for q in poly], fill=255)
        # 再与 clip 多边形求交
        clip_mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(clip_mask).polygon([(q[0] - rect[0], q[1] - rect[1]) for q in self.clip], fill=255)
        mask = Image.composite(mask, Image.new('L', (w, h), 0), clip_mask)
        grad = self.gradient_of(style)
        if grad is not None:
            paint = gradient_image(grad['x0'], grad['y0'], grad['x1'], grad['y1'], grad['stops']).resize((w, h), Image.BILINEAR)
        else:
            paint = Image.new('RGBA', (w, h), parse_color(style))
        a = max(0.0, min(1.0, alpha))
        mask = mask.point(lambda v: int(v * a))
        layer.paste(paint, (0, 0), mask)
        self.img.alpha_composite(layer, (rect[0], rect[1]))

    def _draw_image(self, args, depth):
        src_name, size, *rest = args
        if isinstance(src_name, dict):
            nested = {g['id']: g for g in (src_name.get('gradients') or [])}
            im = render_ops(src_name['ops'], src_name['w'], src_name['h'], self.images,
                            src_name.get('alpha', 1.0), depth + 1, nested)
        else:
            im = self.images.get(src_name)
            if im is None:
                base = os.path.basename(src_name)
                for key, cand in self.images.items():
                    if os.path.basename(key) == base:
                        im = cand
                        break
        if im is None:
            raise KeyError(f'重放时找不到图片：{src_name}')
        if len(rest) == 2:
            sx, sy, sw, sh = 0, 0, im.width, im.height
            dx, dy = rest
            dw, dh = im.width, im.height
        elif len(rest) == 4:
            sx, sy, sw, sh = 0, 0, im.width, im.height
            dx, dy, dw, dh = rest
        elif len(rest) == 8:
            sx, sy, sw, sh, dx, dy, dw, dh = rest
        else:
            raise ValueError(f'drawImage 参数个数不支持：{len(rest)}')
        crop = im.crop((int(round(sx)), int(round(sy)), int(round(sx + sw)), int(round(sy + sh))))
        corners = self.tp_all([(dx, dy), (dx + dw, dy + dh)])
        x0, y0 = int(round(min(corners[0][0], corners[1][0]))), int(round(min(corners[0][1], corners[1][1])))
        x1, y1 = int(round(max(corners[0][0], corners[1][0]))), int(round(max(corners[0][1], corners[1][1])))
        tw, th = max(1, x1 - x0), max(1, y1 - y0)
        crop = crop.resize((tw, th), Image.BILINEAR)
        if self.alpha < 1.0:
            crop.putalpha(crop.getchannel('A').point(lambda v: int(v * self.alpha)))
        self.img.alpha_composite(crop, (x0, y0))


def render_ops(ops, width, height, images, alpha=1.0, depth=0, gradients=None):
    """把一串 Canvas 指令渲染成一张 RGBA 贴图（drawImage 到离屏画布时递归调用）。"""
    if depth > 4:
        raise RuntimeError('重放的递归层数过深')
    surface = Image.new('RGBA', (max(1, int(width)), max(1, int(height))), (0, 0, 0, 0))
    Painter(surface, images, gradients).run(ops, depth)
    if alpha < 1.0:
        surface.putalpha(surface.getchannel('A').point(lambda v: int(v * max(0.0, min(1.0, alpha)))))
    return surface


def replay(meta):
    images = {}
    for name in (meta.get('images') or {}):
        p = os.path.join(ROOT, 'assets', name)
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA')
            images['assets/' + name] = im
            images[name] = im
    gradients = {g['id']: g for g in (meta.get('gradients') or [])}
    size = meta['board']
    surface = Image.new('RGBA', (size['w'], size['h']), (0, 0, 0, 0))
    painter = Painter(surface, images, gradients)
    painter.run(meta['ops'], 0)
    return painter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frame', help='tests/shot.mjs 输出的 JSON')
    ap.add_argument('out', help='输出 PNG')
    ap.add_argument('--scale', type=float, default=2.0)
    args = ap.parse_args()

    with open(args.frame, 'r', encoding='utf-8') as fh:
        meta = json.load(fh)

    painter = replay(meta)
    img = painter.img
    if args.scale != 1.0:
        img = img.resize((int(img.width * args.scale), int(img.height * args.scale)), Image.LANCZOS)
    img.save(args.out)
    print(f'{args.out}: {img.width}x{img.height}, {len(meta["ops"])} 条指令, '
          f'撕开 {meta.get("revealed")} 层, 得分 {meta.get("score")}')


if __name__ == '__main__':
    sys.exit(main())
