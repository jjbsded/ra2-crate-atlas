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

这是静态 TMP 表面的遮挡处理，不是完整复刻游戏运行时所有对象的 Z-buffer、动画与桥梁系统。建筑／载具使用独立对象底图及可选占用标记；未验证地图状态仍明确拒绝精确概率分析，目录资源和未知物体的近似概率单独标识。桥梁 SHP 已纳入 2D 底图、小地图及地图图片导出；同时从 ISO 和普通气候 MIX 读取对应资源。高桥按原始图像偏移和坐标变化表绘制，桥上单位抬高 4 层；透明的低桥帧保留透明并在详情说明。3D 将桥梁贴图跨格拼接，高桥单独抬到桥面高度并保留桥下 TMP 地形。

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

地图外没有地形的概率来源格，绘制时借用距离最近的真实边缘格高度（地图坐标的欧氏距离；等距时选较高的格）。填色、轮廓和百分比标签共用这一显示锚点，以延续边缘地形，避免统一落到高度 0。高度缓存绑定当前地图结果，缩放、平移和切换选格不会改变它；有真实地形的来源格保留自身高度与坡面。此处理不修改地图格、搜索来源记录或概率计算。

## 验证与结果升级

`python verify-realmap.py`：原有 20 项精确计算／地图解析／六气候回归继续通过。`python verify-realmap-render.py`：检查调色盘、锚点、TMP 透明坡面、轮廓孔洞／分片、镜头范围与逐格概率不变。结果位于 `output/realmap-verification/`。

新分析保存上传的原始字节为结果目录内 `source.map`，方便复现。`python realmap_render.py output/<结果目录>/result.json` 仅升级绘图，并严格要求源地图哈希匹配；旧结果缺少原文件时需重新导入，不能使用同名地图代替修改过的地图。`render-audit.json` 记录每种实际绘制素材的文件、帧、调色盘、偏移和遮挡计数。
# Static object layer, version 4

`realmap_objects.py` preserves map object identity, house, health, facing and infantry subcell independently of the probability cells. Frame conventions and anchors were checked against the local FA2SPHE HE_1.5.3 `Body.LoadObjects.cpp` and `RendererTypes.cpp`. The implementation uses the existing SHP decoder; the bundled voxel library in `runtime/voxel` is called through a separate bounded x86 worker, with cached frames keyed by VXL/HVA bytes, facing and offsets. House colors tint the unit palette's remap ramp; no game lighting simulation is claimed.

The renderer composites a second scene alongside the unchanged original terrain. Terrain and objects use painter ordering, original paired SHP / voxel shadows are clipped against same-level ground and visible solid bodies. Ground ownership and picking polygons exclude objects deliberately. This static painter implementation is not the game's per-pixel Z-buffer. The same two scene rasters feed the main view, minimap and full-map image export, beneath probability text.

Directory resources use the local ra2yr-map read-only MIX/INI parser (preserved in `resource_context/`), including resource provenance, bounded includes and nested archive reads. Only the selected directory is saved; no named Mod profile or Mod artwork is bundled. Readable rules support approximate probabilities with explicit warnings; unknown objects use the documented retry assumption.

### Object layout, renderer version 9

Custom foundations read `Foundation.X/Y` and the enumerated `Foundation.N` cells for visual depth sorting and aircraft roof ordering. This does not change their separately assessed probability/occupancy support. OnBridge raises a sprite and its shadow receiver only when its cell actually has a high bridge; low bridges and stray OnBridge fields on land keep ground height.

SHP vehicles rotate their direction index by `Facings/8`, following FA2SPHE's frame-list rotation. Infantry sequences and voxels retain their own conventions. SHP turrets use 32 direction frames from `<image>tur.shp`, or from the body SHP after `Facings × WalkFrames` (independent of `StartWalkFrame`). Body and turret retain their own full-canvas anchors and crop origins; `TurretOffset` and `UseTurretShadow` apply generically. No unit-specific frame numbers or pixel offsets are substituted.

An object-only depth stencil prevents later same-level ground tiles from erasing feet and other opaque sprite pixels outside the anchor cell. Higher foreground terrain can still occlude them. Ground rasters, surface ownership, picking and probability overlays are unaffected. This remains a static preview rather than the full engine's per-pixel Z-buffer and animation system.

`python verify-object-layout.py` uses generated SHPs (no Mod data) to check facing layouts, both turret layouts, original canvas/crop positioning, offsets, valid/stray bridge flags, custom foundation ordering and foreground occlusion.

Renderer version 10 also corrects `NewTheater` terrain/overlay names. Only an A/T in the second character of an alphabetic-prefix image is treated as a climate placeholder; other names are tried unchanged first. For eligible names the search is current climate, generic climate, then the declared filename. Both Rules.Image and Art.Image are resolved before this search. This follows the editor's Ares-compatible overlay fallback and is shared by 2D and 3D; wall connection/damage frames, palettes, occupation and probabilities are unchanged. `python verify-sprite-resolution.py` checks precedence, all six climates, non-placeholder names, aliases, suffixes and genuinely missing resources using synthetic names only.

## 3D terrain inspection

The “3D查看” button loads a bounded patch around the selected cell through
`realmap_3d.py`. It reads the existing result without rerunning or modifying the
probability calculation. The frontend is `terrain3d.js` with locally bundled
Three.js r160; the portable build includes both the extractor and library.
The initial range is 21×21 cells; 31×31 is the largest selectable patch.
“概率:关” starts off whenever the inspector is opened. Enabling it displays
surface colors and multiplier labels from the main map's exact display model,
with the same palette, filter, threshold, transparency and 1× label settings.
Its on/off state is independent of the main map and survives a range change.
Labels appear at readable zoom levels and use depth testing; geometry and
shared label textures are built once per patch and reused during selection and
rotation. No probability is recomputed or renormalized to the patch.

Original TMP sub-blocks are unprojected onto their own surfaces, preserving
palette colors and theater-specific roads, snow, sand and rock. Ramp corner
heights use the top/right/bottom/left offsets documented in FA2SPHE HE_1.5.3
`FA2sp/Ext/CMapData/Body.h::RampTypes`; bilinear interpolation is a visual
reconstruction, not engine collision geometry. Multi-block cliff artwork is
often stored on the lower neighboring cell. Vertical faces first sample that
cell's actual extended image, then the upper cell, with nearby original cliff
art as a fallback.

“精细崖壁” is on by default. `terrain_depth.py` reads each flat TMP's base and
extended Z bytes and unprojects its painted pixels into a shared indexed mesh.
The original alpha silhouette, cliff tips and texture coordinates are retained
at pixel resolution; meshes and materials are shared by repeated sub-blocks.
These depth bytes describe rendering order, not an original solid model: the
result is a visual relief reconstruction. From the original camera, every
vertex projects back to the original texel. Slightly recessed ground and wall
backings close surfaces not painted for that camera. Missing or invalid depth
data falls back to the existing simplified terrain; slopes keep their actual
ramp corner reconstruction. The checkbox switches locally without reloading
the patch. Mesh picking, overlays and relations continue to refer to the
original cell and its integer level; relief heights never enter probability or
passability calculations. The depth layout follows the primary
[CNCMaps TMP reader](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.FileFormats/TmpFile.cs)
and [TMP renderer](https://github.com/zzattack/ccmaps-net/blob/main/CNCMaps.Engine/Rendering/TmpRenderer.cs).

Cut boundaries use a neutral material. Mineral overlays
follow the surface; trees and solid terrain objects use original static SHP
billboards. Buildings and units are not part of this terrain inspector.
Cliff faces toward the original +X/+Z game camera preserve the artwork's
original brightness with an unlit textured material, avoiding a second layer
of shading over the painted cliff art. Rear faces and cut boundaries retain
their existing Lambert lighting. This choice follows world orientation and
does not move with the inspection camera.

Cliff relations use the full saved map, including neighbors outside the patch,
the six original offsets and an integer Cell.Level difference of at least 4.
They are shown only when the original-model result enables
CliffBackImpassability=2. Rough exceptions remain distinct from existing Rock.
Risk colors reuse the saved main-map flags: solid pink for `marked`, hatched
pink for `potentialMarked`. Remaining Rough cells with a cliff relation and
zero probability use amber dots and a dashed border; they are not random-crate
anomalies. Missing/other probabilities are never silently classified as zero.
Legend counts apply to the displayed patch, and selection details explain
projection rejection and clearance support when that evidence is available.
Mod previews show only geometry and original artwork, with no new passability
or crate claims. The 3D mesh does not reproduce the exact original 2D silhouette,
hidden backs of sprites or a complete movement/pathfinding model.

Bridge SHPs are sampled across their actual neighboring cells, including sprite
owners outside the selected patch. Low decks follow the ground; high decks use
separate surfaces at the saved `deckLevel`, with water/ground retained below.
Bridge geometry stays fixed when the camera rotates, and the decorations toggle
also hides bridges. Railings and piers remain painted artwork, not reconstructed
volumes. Cliff markers and crate previews still inspect the ground layer.

## 区域编辑与交互渲染缓存

主视图将地形、概率底色、占用和格线缓存为静态图层，区域选区、概率文字、来源格和选择标记继续按原顺序绘制。全图概览在像素预算允许时缓存整张图，平移直接复用；高倍缩放改为缓存当前视野，避免生成过大的画布。筛选、缩放、配色、图层开关和地图数据改变时重建对应缓存。小地图底图和色阶也单独缓存。

区域使用修改版本号分别缓存统计、缩略图和地形轮廓路径。未改动的区域不重复遍历格子；只有更名或排序时也不重算概率。主图及小地图的区域位图共用有界 LRU，最多 1600 万像素；主视图底图最多 800 万像素。较小区域缓存整个范围以复用平移，大区域只缓存可见部分。概率标签始终处于区域着色上方。

笔刷和选格先通过屏幕坐标／游戏坐标索引缩小候选集，再执行原有精确命中判定；绘制顺序保持不变。此优化不改变区域成员、零概率格的面积计数或概率计算模型。

区域编辑的边界过滤要求 `usable` 且 `cameraCoverage > 0`，排除 `visibleBand`；旧结果没有覆盖比例时退回投影中心与镜头矩形比较。它只限制区域成员，不过滤主图的空间索引。椭圆笔刷将投影 Y 坐标乘 2 后计算点到线段的距离，因此点击、连续拖动与光标预览一致，保持横向直径与纵向直径 2:1。

`player-starts.js` 使用结果已有的 `metadata.waypoints`，仅解码 0–7，按 `Y*1000+X` 找到真实格并沿用高度，显示为 1–8。不是出生槽的路径点、负值和不存在的格子不显示；新增结果明确记录 `multiplayerOnly`，单人地图不显示玩家出生标记。主图标记位于区域着色上方、概率文字下方，采用轻微上移及连接线避免占据格子中央；小地图和区域缩略图在实际出生位置显示同款缩小数字。

`node verify-regions.cjs <result.json>` 检查 12 区域默认值、配色、旧数据迁移、索引与遍历选择一致性及真实地图统计守恒。`node verify-map-view-cache.cjs` 对比缓存／直接渲染的图像、标签数量，并检查平移、缩放、筛选和图层切换后的缓存失效。图像测试和 `node benchmark-map-view.cjs <result.json>` 需要 Node 能找到 `@napi-rs/canvas`，便携版可将 `NODE_PATH` 指向 `runtime/node/node_modules`。基准测量离屏 Canvas 工作耗时，不代表浏览器实际呈现帧率。

