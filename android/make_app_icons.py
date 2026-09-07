# -*- coding: utf-8 -*-
"""
生成安卓 APP 图标 —— 使用登录页的 AGI 五角星徽标

原理：直接解析 logo_agi.svg 中的路径数据（全部是 M/L/Z 直线段），
      用 Pillow 精确重绘，不依赖任何 SVG 渲染库。

输出：Android 各密度 mipmap 图标（标准 + 圆形 + 自适应前景）

用法：python android/make_app_icons.py
"""
import os
import re
import sys
import math

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "app", "src", "main", "res")
SVG = os.path.join(HERE, "logo_agi.svg")

# Android 各密度 -> 尺寸
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

VIEW = 640.0  # SVG viewBox 尺寸
BG = "#FFFFFF"


def parse_subpaths(d):
    """把 SVG path 的 d 属性拆成子路径列表，每个子路径是 [(x,y), ...]"""
    toks = re.findall(r"[MLZmlz]|-?\d+\.?\d*", d)
    subs, cur, i, cmd = [], [], 0, None
    while i < len(toks):
        t = toks[i]
        if t in "MLZmlz":
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur:
                    subs.append(cur)
                    cur = []
            continue
        # 数字
        if cmd in (None, "M", "m"):
            # moveto：第一个坐标是新子路径起点，后续隐式 lineto
            if i + 1 < len(toks) and not re.match(r"[MLZmlz]", toks[i + 1]):
                x, y = float(t), float(toks[i + 1])
                if cur:
                    subs.append(cur)
                cur = [(x, y)]
                i += 2
                cmd = "L" if cmd == "M" else "l"  # 后续坐标视为 lineto
                continue
            i += 1
            continue
        if cmd in ("L", "l"):
            if i + 1 < len(toks):
                cur.append((float(t), float(toks[i + 1])))
                i += 2
                continue
        i += 1
    if cur:
        subs.append(cur)
    return [s for s in subs if len(s) >= 3]


def draw_path(img, d, color, scale):
    """在 img 上绘制一条 SVG path（evenodd：首个子路径填充，其余挖洞）"""
    subs = parse_subpaths(d)
    if not subs:
        return
    w, h = img.size

    # 在 mask 上操作，保证边缘干净
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)

    def pts(sub):
        return [(x * scale, y * scale) for x, y in sub]

    # 第一个子路径 = 外轮廓
    md.polygon(pts(subs[0]), fill=255)
    # 其余子路径 = 洞（evenodd）
    for sub in subs[1:]:
        md.polygon(pts(sub), fill=0)

    img.paste(color, (0, 0), mask)


def make_icon(size, foreground=False):
    """生成一张图标。foreground=True 时生成【自适应图标前景】。

    为什么前景要特殊处理（V2026.09.05.29 修复）：
      Android 自适应图标是 108dp 画布，系统只会保证【中央 66dp 的圆形区域】一定可见，
      四角会被各家桌面的遮罩（圆形/方形/圆角/水滴）裁掉。
      以前的前景是一块占 56% 的【白色方块】：方块对角线 = 0.56 × 1.414 ≈ 0.79，
      远超安全圆直径 0.61 → 白色方块的四个角被切掉，看起来就是
      "LOGO 太大，小格子装不下"。

    现在的做法：
      ① 白色底改成【圆形】（与徽标外框同心的圆，徽标内容严格在圆内，不会切到字）
      ② 整体缩到画布的 60%：圆半径 30% < 安全圆半径 30.5%，任何遮罩都切不到
    """
    if foreground:
        side = 1024
        square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
        draw_all(square, side / VIEW)

        # 裁成圆形（内容全部落在圆内，不丢笔画）
        mask = Image.new("L", (side * 2, side * 2), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, side * 2, side * 2), fill=255)
        mask = mask.resize((side, side), Image.LANCZOS)
        circ = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        circ.paste(square, (0, 0), mask)

        # 缩到画布 60% 并居中（半径 30% < 安全圆半径 30.5%）
        w = int(round(size * 0.60))
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        fg.paste(circ.resize((w, w), Image.LANCZOS), ((size - w) // 2, (size - w) // 2))
        return fg

    img = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    draw_all(img, size / VIEW)
    return img


def draw_all(img, scale):
    """把 logo 画到 img 上"""
    size = img.size[0]
    d = ImageDraw.Draw(img)

    # 1. 白色底
    d.rectangle([0, 0, size, size], fill="#FFFFFF")

    # 2. 三层椭圆边框
    for rx, ry in [(315.10, 231.08), (309.95, 225.96), (304.76, 220.80)]:
        cx, cy = 318.25 * scale, 312.19 * scale
        x0, y0 = cx - rx * scale, cy - ry * scale
        x1, y1 = cx + rx * scale, cy + ry * scale
        # 描边宽度随缩放（SVG 里是 2.0）
        wdt = max(1, round(2.0 * scale))
        d.ellipse([x0, y0, x1, y1], outline="#111111", width=wdt)

    # 3. AGI 三个字母
    paths = [
        ("#000000", "M 125,220 117,232 115,257 109,278 90,322 70,362 62,370 49,376 47,380 48,388 56,394 67,396 100,396 115,392 120,388 122,381 117,374 111,372 106,367 106,360 111,354 118,352 161,353 171,357 174,362 174,367 161,376 159,384 164,391 173,395 236,396 248,394 260,388 263,383 262,375 259,372 249,368 242,360 213,297 193,257 180,236 167,222 153,215 136,215 Z M 137,284 141,284 153,300 160,314 160,320 158,322 132,323 124,322 122,320 122,314 129,295 Z"),
        ("#B40500", "M 431,219 423,218 409,222 375,215 346,217 320,226 304,236 291,248 281,262 272,285 272,326 282,351 288,360 304,376 320,386 344,395 357,397 383,397 407,391 422,383 435,372 446,356 453,336 463,334 470,327 469,316 462,309 448,304 403,303 384,307 375,312 371,319 373,330 379,334 391,335 397,342 397,351 391,359 384,362 373,361 366,358 349,343 341,329 339,320 337,319 337,312 335,311 335,280 338,269 345,257 359,247 375,245 387,248 395,253 417,276 428,280 439,278 447,269 447,264 449,263 449,248 447,247 447,241 443,235 443,232 Z M 392,336 394,336 Z M 398,256 400,256 Z M 286,255 288,255 Z"),
        ("#FDC101", "M 484,224 478,232 479,239 482,239 488,247 493,249 496,254 496,263 498,264 499,335 498,351 496,352 494,367 481,376 480,383 482,383 483,387 488,391 504,397 527,397 528,395 543,396 544,394 551,396 555,393 561,394 564,391 574,389 575,384 578,383 577,374 567,366 563,365 562,360 559,359 559,256 561,255 562,249 567,246 567,243 572,239 577,238 576,236 578,231 575,224 571,224 567,220 553,218 551,216 509,217 Z"),
    ]
    for color, pd in paths:
        draw_path(img, pd, color, scale)

    # 4. 五颗蓝星
    stars = [
        "M238.5 431.5 L241.9 440.2 L251.2 440.5 L243.9 446.1 L246.7 454.9 L238.5 449.8 L230.3 454.9 L233.1 446.1 L225.8 440.5 L235.1 440.2 Z",
        "M283.0 431.5 L286.4 440.2 L295.7 440.5 L288.4 446.1 L291.2 454.9 L283.0 449.8 L274.8 454.9 L277.6 446.1 L270.3 440.5 L279.6 440.2 Z",
        "M319.0 431.5 L322.4 440.2 L331.7 440.5 L324.4 446.1 L327.2 454.9 L319.0 449.8 L310.8 454.9 L313.6 446.1 L306.3 440.5 L315.6 440.2 Z",
        "M360.0 431.5 L363.4 440.2 L372.7 440.5 L365.4 446.1 L368.2 454.9 L360.0 449.8 L351.8 454.9 L354.6 446.1 L347.3 440.5 L356.6 440.2 Z",
        "M402.5 431.5 L405.9 440.2 L415.2 440.5 L407.9 446.1 L410.7 454.9 L402.5 449.8 L394.3 454.9 L397.1 446.1 L389.8 440.5 L399.1 440.2 Z",
    ]
    for sd in stars:
        draw_path(img, sd, "#215065", scale)


def add_circle_mask(img):
    """裁成圆形（ic_launcher_round）"""
    size = img.size[0]
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    if not os.path.isfile(SVG):
        print("缺少 logo_agi.svg")
        sys.exit(1)

    print("=" * 56)
    print("  生成 APP 图标（AGI 五角星徽标）")
    print("=" * 56)
    print("  源: logo_agi.svg (与网页登录页一致)\n")

    for folder, size in SIZES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)

        base = make_icon(size)
        base.save(os.path.join(out_dir, "ic_launcher.png"), "PNG")

        round_img = add_circle_mask(base)
        round_img.save(os.path.join(out_dir, "ic_launcher_round.png"), "PNG")

        fg = make_icon(size, foreground=True)
        fg.save(os.path.join(out_dir, "ic_launcher_foreground.png"), "PNG")

        print("  %-16s %3dx%-3d  标准/圆形/前景" % (folder, size, size))

    # 自适应图标配置（Android 8+）
    xml_dir = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(xml_dir, exist_ok=True)
    for fname in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(xml_dir, fname), "w", encoding="utf-8") as f:
            f.write("""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""")

    # 背景色（自适应图标用紫色底，与主题一致）
    colors_path = os.path.join(RES, "values", "colors.xml")
    with open(colors_path, "r", encoding="utf-8") as f:
        colors = f.read()
    if "ic_launcher_background" not in colors:
        colors = colors.replace(
            "</resources>",
            '    <color name="ic_launcher_background">#6B5CE7</color>\n</resources>'
        )
        with open(colors_path, "w", encoding="utf-8") as f:
            f.write(colors)

    print("\n  自适应图标配置: mipmap-anydpi-v26/")
    print("=" * 56)
    print("  完成。共生成 %d 组图标。" % len(SIZES))
    print("=" * 56)


if __name__ == "__main__":
    main()
