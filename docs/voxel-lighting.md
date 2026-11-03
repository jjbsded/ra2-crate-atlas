# RA2/YR 载具体素光照：复用与验收

跨工具接入请先读 [统一渲染移植说明](rendering-porting-guide.md)，其中已合并地图纹理变体、光照、阴影和部署状态。本文保留光照阶段的详细原理与历史证据。

更新：2026-11-03。表面明暗标识：`ra2-native-vpl-v2`；最终亮度标识：`ra2-voxel-palette-light-v1`；Crate Atlas 绘图版本：19，3D 版本：7。版本 19 仅补齐 [地图部署外观](deployed-art.md)，沿用版本 18 光照。

最新增量：[载具偏亮的原版坐标变换修复](vehicle-brightness-native.md)。旧水平光方向遗漏了世界光源仰角及等角相机逆变换，导致车体部分表面偏亮。现在使用原版函数输出的 4 模式 × 32 朝向页值，新增 `realmap_voxel_light_tables.py`；同时修正模式 4 法线 241 的 X 符号。保留 `ExtraUnitLight` / `ExtraAircraftLight`，地面无需统一调暗。

此前版本 17 的地面重复、盖特坦克炮塔投影、旋翼误投影和飞机阴影尺寸修复见 [地形变体与阴影修复](terrain-shadows.md)。`realmap_terrain_variants.py`、`realmap_voxel_shadow.py` 继续保留。

本文供箱子分析工具及其他本地地图／模型工具复用。已经完成静态渲染回归，尚未完成同场景游戏截图的逐像素对拍。完整渲染背景见 [RENDERING.md](../RENDERING.md)。

## 问题与修复范围

旧路径在 `voxel-worker.cs` 调用 `CncImgSetLightingSource(-1,1,1)`，DLL 用法线与该方向的 `acos` 夹角线性选择 32 页 VPL。该近似既改变受光方向，也缺少游戏式高光项；单独调整 RGB 亮度或替换三个光源数值不能完整修复。

新路径先按原始 VXL 法线和单位朝向选取 `voxels.vpl` 的页，再让现有 DLL 负责几何绘制。它适用于静止、直立的体素车体、炮塔、炮管、飞机及建筑上的体素部件。SHP 不经过此流程。地图环境色、局部灯光、闪光、动态阴影、倾斜／动画部件的法线变化及 Phobos 自定义光源均未模拟。

版本 15 补上第二阶段：地图普通环境亮度、地面高度照明和 `[AudioVisual] ExtraUnitLight / ExtraAircraftLight`。前一版只修正 VPL 受光层次，遗漏单位额外增亮，因此仍会偏暗。用户提供的 `sov01umd.map` 为 `Ambient=1`、`Ground=0`、`Level=.032`；本机原版与游戏目录规则均为 `ExtraUnitLight=.2`。地图普通 RGB 色调仍不直接染到原版单位上，局部灯光和动态天气不在此阶段模拟。此变更仅作用于 VXL 部件，不宣称补齐地形、建筑 SHP 或步兵的全部照明。

## 最终亮度与所属色顺序

### 供另一个会话合并的最新增量

1. 第一阶段 VPL 使用最新 `realmap_voxel_lighting.py` 及 `realmap_voxel_light_tables.py`，并保留修正后的 `realmap_voxel_normals.py`。之后必须继续执行本节的最终亮度，保留 `realmap_palette_lighting.py`、`realmap_objects.py` 的地图高度／调色盘强度／缓存键，以及 `map_results.py` / `realmap_render.py` 的地图光照传递。新表与旧 PNG 不能混用。
2. Save2Map 的局部所属色重绘须先换色、后增亮；记录未增亮的原始所属色梯度和 `paletteLightStep`，不能从已截断到 255 的亮色像素反推原色。接入位置与短路径约束见 `D:/Ra2/Work/save2map/vendor/realmap/VOXEL-LIGHTING-INTEGRATION.md`。
3. 绘图版本 16 同时修正 SHP 所属色：RA2/YR 不使用旧 `Remapable=no` 禁止单位调色盘换色。`ObjectPainter.shp()` 不再用该字段屏蔽索引 16–31；底座、附属动画及升级部件都按实际房屋颜色绘制。保留 `TerrainPalette` 和调用方显式 `remap=False`。这修复心灵控制塔、裂缝产生器、光棱塔以及中立油井／机场的红色遗漏；不要把整张图里的红色 RGB 直接替换，否则会误改装饰和灯光。依据：[CNCMaps Drawable.LoadFromRulesFull](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Drawables/Drawable.cs#L90)。真实素材回归脚本：`verify-building-remap.py`。
4. 原生底图不再缩到最长边 9000 像素，`rasterScale=1`；PNG／WebP 继续无损。浏览器主画布和离屏缓存按实际 CSS 尺寸 × DPR 绘制，像素图放大关闭平滑；缩小总览仍需采样。这些属于显示修复，不改地图占用／概率计算。2026-11-03 复查另补上 DPR 媒体查询监听：跨屏时即使 CSS 尺寸不变，也重建物理像素画布，并保留地图视角。仅监听 ResizeObserver/window.resize 不足以覆盖此情形。

请使目标工具自己的渲染缓存失效并重新打包。本文记录的是箱子工具的实现；不代表另一个会话已把最新增量合入 Save2Map。

`realmap_palette_lighting.py` 提供 `light_step(rules, map_lighting, category, level)` 和 `light_palette(colors, step)`。输入为未增亮的 256 项 RGB 调色盘；先按原所属色算法换色，再按强度行转换调色盘，最后将已通过 VPL 的像素索引映射成 RGBA。不能对最终截图统一调曝光，也不能对阴影重复增亮。

```text
intensity = Ambient - Ground + Level * cell.level + ExtraLight
brightness = truncate(clamp(intensity, 0, 2) * 1000)
shade = min(254, (261 * brightness) >> 11)
step = min(62, floor(127 * shade * 62 / 32258))
channel = min(255, floor(original_channel * step / 31))
```

车辆使用 `ExtraUnitLight`，飞机使用 `ExtraAircraftLight`，建筑体素炮塔不加车辆额外亮度。无地图设置时环境亮度为 1、Ground/Level 为 0；无 Extra 配置时为 0。中性环境的原版车辆得到 `step=37`，实际倍率 `37/31`，而不是连续浮点的 1.2。索引 0 保持透明，240–254 保留自发光／特殊色，阴影、轮廓、锚点与几何不变。调色盘仍沿用项目原有 6 位到 8 位展开与所属色算法；尚不保证与游戏的 16 位输出逐像素相等。

`ObjectPainter.prepare()` 保存地块高度，部件缓存包含最终强度行。同一模型、朝向和所属色出现在不同亮度位置时，不得共用已转成 RGB 的部件缓存。直接使用 `parts()` 的调用方需要设置 `painter.cells` 和 `theater['mapLighting']`，或先调用 `prepare(cells, origin)`；直接使用 `VoxelRenderer.draw()` 的调用方须传入已经过上述处理的调色盘。

Toy 官方图集预烘焙最终 RGBA；自定义对象库预烘焙 VPL 索引，继续用现有 256 色换色路径，在所属色替换后应用强度行。对象素材键附带亮度行，避免复用另一张地图的亮度；模板键独立于亮度，体素调色盘记录第三项为 `true`。这无需增加 Python、DLL、原始 VXL 或新浏览器依赖。

## 可直接复用的接口

| 文件 | 职责 |
| --- | --- |
| `realmap_voxel_lighting.py` | VPL 校验、法线到明暗页映射、临时 VXL 着色、恒等 VPL |
| `realmap_voxel_light_tables.py` | 原版坐标变换后的静态 32 向页值，包含快速数学／舍入结果 |
| `realmap_voxel_normals.py` | VXL 模式 1–4 的标准法线表；包含来源声明 |
| `realmap_palette_lighting.py` | 单位额外亮度、地图环境及高度照明、63 行亮度量化 |
| `realmap_voxel.py` | 独立 x86 进程、帧缓存、索引到 RGBA 转换、退出回收 |
| `voxel-worker.cs`、`runtime/voxel/` | 既有几何渲染桥接及运行依赖 |
| `verify-voxel-lighting.py` | 数学、损坏输入、真实素材、轮廓及概率回归 |

最低层接口需要 Python、NumPy、`realmap_voxel_lighting.py` 和 `realmap_voxel_light_tables.py`：

```python
from realmap_voxel_lighting import vpl_tables, shade_vxl, identity_vpl

# map_facing 是地图记录的 0..255 朝向；桥接几何分为 32 向。
bridge_facing = (map_facing // 8 - 8) % 32
tables = vpl_tables(original_vpl_bytes)
lit_vxl_bytes = shade_vxl(original_vxl_bytes, bridge_facing, tables)
passthrough_vpl_bytes = identity_vpl(original_vpl_bytes)

# 把 lit_vxl_bytes、原始 HVA、passthrough_vpl_bytes 交给几何渲染器。
# 必须使用恒等 VPL，不能让几何渲染器再次按旧光源修改颜色。
```

复用完整桥接时，外层直接调用 `VoxelRenderer(folder, original_vpl_bytes)`，随后 `draw(vxl, hva, bridge_facing, [F,L,H], fire_angle, colors)`。`folder` 应为存在的独立任务目录，`colors` 为 256 项 RGB 调色盘；`draw` 返回本体图、阴影、各自的绘制偏移。用 `try/finally` 调用 `close()`。每种 VPL 使用自己的实例；同一实例不应被并发调用。`ObjectPainter` 已处理所属色、炮塔／炮管组合与部件顺序，能复用时优先使用它。

## 朝向、法线与公式

不要把 DLL 镜像后的屏幕坐标直接当作 VXL 法线坐标，也不要把 Phobos 文档中的 `VoxelLightSource` 数值未经变换直接传给该 DLL。

将桥接方向还原为 `direction32=(bridge_facing+8)%32`。世界光源约为 `(-.5,-.707106,.5)`，经过 `Rx(-60°) * Rz(-45°) * Rz(-(direction32-8)*2π/32)` 的逆变换得到模型光方向 `l`；`h=normalize(l+(0,0,1))`。旧版本的水平光简化式已废弃。对原始法线 `n`：

```text
diffuse  = max(n·l, 0)
t        = n·h
specular = max(t / (3 - 2*t), 0)
page     = clamp(truncate(16 * (diffuse + specular)), 0, 31)
color    = originalVPL[page][originalColorIndex]
```

保留法线索引 253–255 固定使用中性页 16。原始颜色索引 0 保持透明。函数会校验 VXL 节、span 起止、游程及 VPL 长度，只改临时副本的颜色和已消费的法线字节；原始文件、HVA、尺寸及偏移不改。不要使用着色后的 VXL 再作输入，否则会重复施光。

地图朝向 0 对应桥接方向 24。生产代码使用原版计算输出，避免标准数学库在少量临界页上的差异。精确向量、法线修正、原版地址和生成器见 [原版光照增量说明](vehicle-brightness-native.md)；法线 253–255 始终选页 16。

## 缓存、打包与验收要求

缓存身份须包含原始 VXL/HVA/VPL、朝向、几何参数以及光照实现／法线表的版本或哈希。把新渲染代码接入旧 PNG 图集却继续复用旧帧缓存，会得到“代码已修但画面未更新”的结果。Crate Atlas 的临时已着色 VXL 按实际内容命名，官方画面缓存包含 `realmap*.py`；旧报告须重新分析或显式重绘。箱子概率预计算不因本次光照变化而改变。

如果目标工具采用浏览器图集，建议在构建阶段应用此算法，浏览器继续显示最终图片／调色盘索引。不要为静态光照把 Python、DLL、原始 MIX、VXL 或 HVA 一起加入网页包。新旧图集应替换，而不是同时保留。

Toy 已统一为一个产品，保留官方图集与自定义地图静态帧的构建时预烘焙；原普通版停止维护。历史上两个方案均已接入。首次 VPL 修复的成品及大小见 [正式预烘焙构建](toy-lighting-release.md)，最终亮度阶段见 [亮度修复交付记录](toy-brightness-release.md)，前期评估见 [Toy 光照包体实测](toy-lighting-size.md)。每次构建独立检查 50 MB ZIP 门槛，旧 Toy 包保留。

复制模块时一并保留文件内声明和 `runtime/voxel/CNCMaps-COPYING.txt`；调用原 DLL 时保留其原有组件与来源说明。完整接入须包含 `realmap_voxel_lighting.py`、`realmap_voxel_light_tables.py`、`realmap_voxel_normals.py`、`realmap_palette_lighting.py` 及外层地图／高度上下文，不能只替换 `realmap_voxel.py`。

```powershell
.\run-python.cmd -B verify-voxel-lighting.py --integration
.\run-python.cmd -B verify-palette-lighting.py
.\run-python.cmd -B verify-toy-lighting-build.py
.\run-python.cmd -B verify-voxel-lifecycle.py
.\run-python.cmd -B verify-object-layout.py
```

当前证据覆盖 4 种法线模式、32 向、11 类真实模型共 352 组朝向，透明轮廓、锚点及阴影保持一致；原版温带、尤复雪地夹具的地形与全部概率字段一致，旧报告显式重绘也已检查。记录与对照图位于 `output/voxel-lighting-verification/`。原版算术输出、针对版本 17 的 224 组轮廓／阴影比较及用户截图配准测量，另见 `output/brightness-native-20261103/`。时空目录的 5 种模型加载检查是此前兼容性证据，不代表完整 Mod 光照或扩展兼容验收。

## 一手实现参照

- [CNCMaps 单位额外亮度与高度调色盘，56712d7](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Map/Map.cs#L548)
- [CNCMaps 亮度量化与特殊索引保护，同修订](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Rendering/Palette.cs#L77)

- [World-Altering Editor 光照计算，f01be61](https://github.com/CnCNet/WorldAlteringEditor/blob/f01be61e460c1fe5d76c827ed0f4eb1adaa2bf92/src/TSMapEditor/Rendering/ObjectRenderers/VxlRenderer.cs)
- [CNCMaps 光照计算，56712d7](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Rendering/VxlRenderer.cs)
- [CNCMaps VXL 法线数值表，同修订](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.FileFormats/VxlFile.cs)
- [现有 DLL 的夹角算法，755dbb6](https://github.com/handama/CncVxlRenderText/blob/755dbb6e9bf751d7c3c4c1c2dc07ac8bb094d1d0/src/vxlfile.cpp)
# Deployment artwork, renderer 19

For the four requested deployable units, automatic map-state rendering now preserves the native lighting described below. SCHP with the `Unload` mission selects SCHD art and its shadow index; building turrets keep their existing rendering. See [deployment integration notes](deployed-art.md).
