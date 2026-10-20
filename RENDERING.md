# 真实地图渲染修正（2026-10-13）

本次仅修改画面和点击几何，不修改随机坐标、搜索顺序、可用格判定、精确概率分数或 Rock 检测。当前浏览器中的 `map-690d23bccea0` 已按原地图 SHA-256 核对后原位重绘。

## 调色盘与绘制锚点

依据本机 World-Altering Editor 的实际 IL，归档在 `assets/source/wae-palette-selection.il.txt`、`wae-rendering.il.txt`、`wae-anchors.il.txt`；不是仅凭截图调整颜色／坐标。

| 对象 | 雪地调色盘 | SHP 整画布左上角，相对格心 |
| --- | --- | --- |
| TMP 地形、普通树木、岩石 | isosno.pal | 树木：(-W/2, -H/2 + YDrawFudge) |
| 黄金 TIB01、宝石 GEM01 | snow.pal | (-W/2, -H/2 - 12) |
| 矿井 TIBTRE01～03 | unitsno.pal | (-W/2, -H/2 - 15) |
| 墙 | unitsno.pal | (-W/2, -H/2 - 12) |

其他气候按对应名称读取原版 MIX 内的调色盘。SHP 帧内裁切偏移已在解码时保留，不能再次做底部对齐。旧算法 `cy + 15 - H` 与正确的树木锚点相差 `H/2 - 15` 像素，因各树的画布高度不同，不能统一平移两格。矿石读取 OverlayDataPack 指定的密度帧。一个单元格存在 Terrain 和 Overlay 时，分别绘制两者。

六位调色盘通道展开为 `(v << 2) | (v >> 4)`，索引 0 透明。原始 SHP 的配对阴影帧已加入，详见下节。原图的灯光与动画仍未重建；颜色为原调色盘静态帧，不承诺与特定时刻的游戏灯光逐像素一致。


## 原始阴影（渲染版本 3）

`assets/source/wae-shadows.il.txt` 归档了本机编辑器的 `GetShadowFrameIndex`、`DrawShadow` 及 Terrain／Overlay 绘制调用：阴影帧为 `SHP 总帧数 / 2 + 本体帧号`，使用相同的画布、帧内偏移和对象绘制锚点，透明度取 `128/255`。树木一般是 2 帧；矿井为 22 帧，本次静态本体 0 帧对应阴影 11 帧。原始阴影的非透明像素使用索引 1，按黑色遮罩处理，不使用单位调色盘给它上色。

绘制接收面从最终 TMP 表面归属取得：阴影可以跨同高相邻格并盖住平铺矿石，但被前景崖壁、不同高度地面和物体本体挡住。物体和阴影始终在格线、坐标及概率层之下。空阴影帧（如黄金／宝石）、未配对图像或 `NoShadow=yes` 不补造阴影。

这是原始静态阴影轮廓的复刻；跨高度／斜坡接收使用静态地表裁切，不模拟实时光源、光线追踪或逐帧动画形变。冰天雪地共画出 402 个有可见阴影的树木、矿井、岩石等对象。`render-audit.json` 记录每种素材的阴影帧、像素数、画布包围框和透明度。

`python verify-realmap-shadows.py` 检查树木、三种矿井、箱子、岩石的真实帧，空矿石阴影、NoShadow、地面／物体／悬崖分层、画布越界，以及整张图只变暗、不发生对象移位或着色改变。所有概率、单元格几何、Rock 标记逐项保持一致。

## 坡面与遮挡

旧 TMP 解码把底面索引 0 当成不透明色，同时概率层永远使用平地菱形。新底图保留底面与扩展图像的透明像素，斜坡的显示轮廓来自实际 TMP 非透明轮廓，包含抬高的坡面部分。

按世界格子的前后关系绘制地形与对象；另生成原生像素分辨率的地形归属缓冲区。平格只有底面属于可选表面，垂直崖壁不属于平面；斜坡则包括扩展的坡面。前景 TMP 的不透明像素覆盖背后的表面，输出每格剩余可见轮廓。格线、概率层与鼠标选择共用这一轮廓，不再穿透悬崖。轮廓有约 1 个原图像素以内的简化容差，完整平格仍采用共享四角，以避免双线。信息文字位于剩余可见表面，树木／矿石美术仍在信息层之下。

这是静态 TMP 表面的遮挡处理，不是完整复刻游戏运行时所有对象的 Z-buffer、动画与桥梁系统。建筑／载具使用独立对象底图及可选占用标记；原有不支持地图状态仍明确拒绝精确概率分析，目录资源外观预览单独标识。

## 可视边界和顶部禁区

`VisibleRect=(L,T,VW,VH)` 名称容易混淆：它是引擎用于可用格判定的矩形参数，不直接等于镜头能画出的范围。

依据已归档的原版 YR `0x6D8640`，把镜头中心限制减／加视口半宽半高，得到世界投影坐标下的矩形：

```text
left   = 30 × (2L - W)
right  = left + 60 × VW
top    = 15 × (W + 2T - 5)
bottom = top + 30 × VH + 135
```

显示时加上绘图原点。顶部公式相对平地可用格的比较阈值向上延伸 75 像素；底部也保留该镜头公式的边距，不能简单把 LocalSize 画成唯一的可视框。该范围不表示玩家黑幕／战争迷雾。

- 蓝线：镜头允许显示的范围；线外统一压暗。
- 琥珀：镜头范围内但单元格不满足原版可用判定，包含顶部不可移动／建造区。
- 普通可用区域保留原素材效果，另独立叠加概率层。
- 镜头边界使用矩形裁切，因此同一格可以半格、四分之一格或其他比例分别显示两侧效果。
- 可用区与顶部禁区之间按照原生整格判定，不把格子劈开。高度与顶部坡面的修正沿用原有二进制公式。

跨显示边界不改变概率；冰天雪地实际 358 个部分可视格的精确概率全部为零。概率为零的原因是原生候选规则，而非绘图裁切主动清零。

## 验证与结果升级

`python verify-realmap.py`：原有 20 项精确计算／地图解析／六气候回归继续通过。`python verify-realmap-render.py`：检查调色盘、锚点、TMP 透明坡面、轮廓孔洞／分片、镜头范围与逐格概率不变。结果位于 `output/realmap-verification/`。

新分析保存上传的原始字节为结果目录内 `source.map`，方便复现。`python realmap_render.py output/<结果目录>/result.json` 仅升级绘图，并严格要求源地图哈希匹配；旧结果缺少原文件时需重新导入，不能使用同名地图代替修改过的地图。`render-audit.json` 记录每种实际绘制素材的文件、帧、调色盘、偏移和遮挡计数。
# Static object layer, version 4

`realmap_objects.py` preserves map object identity, house, health, facing and infantry subcell independently of the probability cells. Frame conventions and anchors were checked against the local FA2SPHE HE_1.5.3 `Body.LoadObjects.cpp` and `RendererTypes.cpp`. The implementation uses the existing SHP decoder; the bundled voxel library in `runtime/voxel` is called through a separate bounded x86 worker, with cached frames keyed by VXL/HVA bytes, facing and offsets. House colors tint the unit palette's remap ramp; no game lighting simulation is claimed.

The renderer composites a second scene alongside the unchanged original terrain. Terrain and objects use painter ordering, original paired SHP / voxel shadows are clipped against same-level ground and visible solid bodies. Ground ownership and picking polygons exclude objects deliberately. This static painter implementation is not the game's per-pixel Z-buffer. The same two scene rasters feed the main view, minimap and full-map image export, beneath probability text.

Mod profiles use the local ra2yr-map v0.9 read-only MIX/INI parser (preserved in `resource_context/`), including resource provenance, bounded includes and nested archive reads. Mod results are strictly visual: null probability, empty terms, no risks, disabled probability controls and explicit export captions.

