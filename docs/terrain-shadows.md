# 地形变体与载具阴影修复（2026-11-03）

完整移植以 [统一渲染接入文档](rendering-porting-guide.md) 为准；本文保留版本 17 的实现细节与证据。

本次针对用户提供的同一场景工具／游戏截图，使用已导入的 `sov01umd.map` 做对照。渲染版本升为 17；只改变显示，不改地图原文件、地形编号、占用、禁行或箱子概率。

## 地面重复

原版给许多 TMP 地块提供字母后缀变体，例如城市地面的 `clear01.urb`、`clear01a.urb` 至 `clear01g.urb`。旧工具只使用基础文件，因而同一菱形纹理不断重复。这不是 Windows DPI 或有损图片压缩造成的。

`realmap_terrain_variants.py` 现在按格坐标选取变体：少量变体使用 4×4 表，超过 4 张使用 8×8 表。游戏的 8×8 表随会话生成；工具固定一张各编号均衡、相邻格不重复的表，保证重开、导出、2D、3D 与 Toy 一致。不能据此保证与某次游戏会话每一个地面像素相同。

只接入几何兼容的变体：尺寸、透明轮廓、地形／坡面字段和深度数据必须相同；有损坏标志的数据、桥梁状态和不兼容候选不随机化。多格素材的所有子块按共同原点选图。`Cell.file`、`tileIndex`、`subTile` 保持原始分析值，显示文件另行选择。

复用时用 `TerrainVariants(resources, theater, raw_tile_cache)`，随后 `selector.file(cell)` 返回显示文件名；由 `selector.raws[name]` 读取原始素材。2D 和 3D 必须共用规则。Toy 图集中保存 `terrainVariants`，浏览器由 `toy/terrain-variants.js` 选择相同文件。

## 阴影错误

旧桥接直接采用编辑器 DLL 的全模型投影，会给每个炮塔／炮管和 VXL 内所有节生成阴影。原版机制还有以下约束：

- VXL 主体只由 `art.ini` 的 `ShadowIndex` 指定的一节投影，默认 0。夜鹰直升机 `SHAD`、武装直升机 `SCHP` 为 2，因而不包含独立旋翼。
- 原版载具的 VXL 炮塔／炮管不另投阴影。`UseTurretShadow` 的 SHP 炮塔设置不能套到 VXL；Phobos 的多节／炮塔阴影扩展不在本实现范围内。
- `ConsideredAircraft=yes` 使用半尺寸阴影。旧工具遗漏了这一步，停在地上的飞艇、飞碟和飞机也出现过大阴影。
- 按选定节的底面、HVA 首帧变换、朝向进行投影，使用 8.8 定点步进和两像素宽的落点；保留阴影与本体独立偏移。

新模块 `realmap_voxel_shadow.py` 负责上述投影。`VoxelRenderer.draw` 新增可选关键字 `shadow_section=0`、`shadow_scale=1.0`；传 `None` 不绘阴影，飞机类型传 `0.5`。外层 `ObjectPainter` 已选择这些参数，并尊重规则／美术定义中的 `NoShadow`。本体仍沿用既有 DLL 几何与两阶段光照，不应为修阴影重调亮度。

阴影是 50% 黑色遮罩，完整版延续现有的同高度地表接收和可见本体遮挡规则，本轮没有扩展其高桥桥面接收逻辑。Toy 自定义地图使用相同预烘焙 VXL 遮罩，按接收面高度和本体遮挡合成，并读取既有桥面模板；官方地图继续由完整版绘制器捕获最终阴影。本次截图与浏览器逐像素对照覆盖的是地面停放场景。

## 接入、缓存与验证

完整版新增模块须一起写入打包清单。另一个工具可复用上述两个模块及 `realmap_voxel.py`、`realmap_objects.py` 的调用方式；光照依赖仍见 [光照接入文档](voxel-lighting.md)。渲染缓存、官方图集和自定义对象帧必须随源码指纹更新，不能只替换网页 JS 却沿用旧图集。

本轮回归入口为 `verify-terrain-shadows.py`。测试覆盖原版／尤复九个气候组合、Python／浏览器的同坐标选图、多子块一致性、7 种实际 VXL 的 32 向、指定节、半尺寸阴影与本体像素不变。对照和验收记录位于 `output/terrain-shadow-verification-20261103/`。

仍是静态地图显示：没有游戏实时高度、旋翼动画帧、坡面倾斜、天气和动态局部照明。此次用户截图用于视觉对照，没有声称执行新的游戏内实验或实现完整游戏渲染器。

## 实现参照

- [CNCMaps 地形变体选择，56712d7](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Game/TileCollection.cs)
- [CNCMaps VXL 底面阴影与定点投影，同修订](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Rendering/VxlRenderer.cs)
- [Phobos：原版单节阴影、飞机半尺寸阴影及炮塔阴影扩展](https://phobos.readthedocs.io/en/stable/Fixed-or-Improved-Logics.html#voxel-body-multi-section-shadows)

复用派生算法时保留 `runtime/voxel/CNCMaps-COPYING.txt` 和源码来源说明。
