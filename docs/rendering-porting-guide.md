# 地图渲染修复统一移植说明

适用基线：Crate Atlas 绘图版本 **19**、3D 版本 **7**，2026-11-03。地图纹理变体、载具光照与阴影、部署外观均按这份说明接入；不必按历史修复文档逐轮叠加。源码以包含本文件的同一 Git 提交为准。

主要接收方是存档转换地图工具 Save2Map。本文描述渲染层的接入，不修改存档解码、地图导出、对象类型恢复、坐标、所属关系、占用或概率算法。保留目标工具已有的资源覆盖顺序与 Mod 兼容处理。

## 1. 需要同步的文件

路径相对于 Crate Atlas 仓库根目录；在当前工作区为 `D:/Ra2/Work/video/crate-generation-demo`。

| 功能 | 源文件 | 接入方式 |
| --- | --- | --- |
| TMP 纹理变体 | `realmap_terrain_variants.py` | 新增模块，在地形绘制取图时调用 |
| 原生 VPL 明暗 | `realmap_voxel_lighting.py`、`realmap_voxel_light_tables.py`、`realmap_voxel_normals.py` | 同步整组，替换旧水平光源近似 |
| 最终地图亮度 | `realmap_palette_lighting.py` | 保留或同步；不能只合并 VPL 阶段 |
| VXL 阴影 | `realmap_voxel_shadow.py` | 新增模块，替换 DLL 的全模型阴影 |
| 体素桥接 | `realmap_voxel.py` | 差异合并，保留目标工具的短路径与索引输出 |
| 对象、美术选择、所属色 | `realmap_objects.py` | 差异合并，保留局部换色元数据 |
| 地图合成、3D | `realmap_render.py`、`realmap_3d.py` | 合并变体取图与阴影接收；保留目标工具的绘制记录器 |
| 地图光照上下文 | `map_results.py`、`realmap_render.py` 的调用方式 | 目标工具也可在自己的解析器传入，不要求复制整条分析链 |
| 许可和桥接组件 | `runtime/voxel/CNCMaps-COPYING.txt`、既有 DLL 与来源文件 | 保留派生算法和组件声明 |

当前实现标识：

```text
表面光照       ra2-native-vpl-v2
最终调色盘亮度 ra2-voxel-palette-light-v1
载具阴影       ra2-section-footprint-v1
纹理变体元数据 ra2-tmp-lattice-v1
```

`voxel-worker.cs`、`output/realmap-tools/voxel-worker.exe` 和 `.sha256` 是匹配的一组。若同步 worker 源码，需同步或重编译对应二进制，并使用 `worker_digest()` 的规范化文本哈希。四项修复本身不要求更换现有 CncVxlRenderText DLL，也不需要启动游戏。

## 2. 总体绘制顺序

```text
有效规则、美术、地图/存档对象状态
  ├─ 地形：原始格号 → 兼容 TMP 变体 → 原有高度/深度合成
  └─ 对象：选择普通/部署美术
       ├─ VXL：原始法线 + 朝向 → 原生 VPL 页 → 已着色索引
       │        → 恒等 VPL 的几何绘制 → 所属色 + 地图亮度调色盘 → RGBA
       ├─ SHP：对应序列帧 → 所属色调色盘 → RGBA
       └─ 阴影：选定 VXL 节 / 既有 SHP 遮罩 → 接收面与本体遮挡
```

最终亮度函数用于体素调色盘，不要顺手对所有 SHP 或地形统一施加车辆的额外亮度。地形取变体与对象换造型都只改变显示输入；分析与导出继续使用原始格号、对象类型和状态数据。

## 3. 地图纹理变体

### 接口与选择规则

```python
from realmap_terrain_variants import TerrainVariants

selector = TerrainVariants(resources, theater, raw_tile_cache)
display_file = selector.file(cell)
display_tmp = selector.raws[display_file]
# 把 display_tmp 交给原有 TMP 绘制器，不回写 cell['file']。
```

`cell` 至少包含 `file`、`x`、`y`、`subTile`。典型素材包括 `clear01.urb` 及 `clear01a.urb` 至 `clear01g.urb`。最多 4 张时用 4×4 坐标表，多于 4 张用 8×8 表；以 `(x, y, subTile, 宽, 高)` 求共同原点，保证多格素材的子块选择同一变体。

不能用每次绘图的随机数，否则平移、局部换色、导出或缓存重建会改变地面。游戏的 8×8 表随会话生成，本工具采用固定、均衡且相邻格不重复的表；目的在于还原自然变化，不保证与某次游戏会话逐格相同。

### 可接受的变体

候选必须与基础 TMP 的尺寸、透明轮廓、地形/坡面字段、额外图边界及深度数据相同。损坏数据、桥梁状态、缺失或不兼容候选不参与变体选择。不要修改 `tileIndex`、`subTile`、`Cell.file`、地形属性或占用。

2D、3D、导出与局部重绘必须共用选择规则。若目标工具把 TMP 解码结果缓存起来，应按最终 `display_file` 区分缓存，避免所有变体仍命中基础图。

## 4. 载具光照与最终亮度

### 第一阶段：法线选择 VPL 页

旧算法把水平光方向直接与模型法线计算，缺少世界光源仰角及等角相机/单位矩阵逆变换，因此部分车体顶面和侧面过亮。不要通过整体压暗地图或取消单位额外亮度来补偿。

```python
from realmap_voxel_lighting import vpl_tables, shade_vxl, identity_vpl

bridge_facing = (map_facing // 8 - 8) % 32  # 地图方向为 0..255
tables = vpl_tables(original_vpl)
lit_vxl = shade_vxl(original_vxl, bridge_facing, tables)
geometry_vpl = identity_vpl(original_vpl)
# lit_vxl + 原始 HVA + geometry_vpl → 几何渲染器
```

生产实现使用 `realmap_voxel_light_tables.py` 中原版函数生成的 4 种法线模式 × 32 朝向、共 11,552 个页值，保留快速三角函数、平方根和舍入边界。地图方向 0 对应桥接方向 24。法线 253–255 固定页 16；模式 4、法线 241 的 X 分量修正为负。

必须使用原始 VXL 作为 `shade_vxl()` 输入，并给 DLL 恒等 VPL；否则会重复施光。原始资源、HVA、节布局、锚点与几何不改。页值拼接 SHA-256 为 `f33cc716b0ea4942f7083d1273608d9cf736753f7f23cff6a20ae9d88c5c3576`。运行时直接使用表，不需要携带生成器或原游戏可执行文件。

### 第二阶段：地图强度行

`light_step(rules, lighting, category, level)` 与 `light_palette(colors, step)` 来自 `realmap_palette_lighting.py`：

```text
intensity = Ambient - Ground + Level * cell.level + ExtraLight
brightness = truncate(clamp(intensity, 0, 2) * 1000)
shade = min(254, (261 * brightness) >> 11)
step = min(62, floor(127 * shade * 62 / 32258))
channel = min(255, floor(original_channel * step / 31))
```

先按所属方修改调色盘索引 16–31，再执行最终亮度，最后把 VPL 后的像素索引映射成 RGBA。索引 0 保持透明，240–254 保持特殊色，255 仍参与亮度处理；阴影不参与增亮。中性行是 31，原版默认车辆的 `.2` 额外亮度通常得到行 37，而非直接乘浮点 1.2。

| 对象类别 | 额外亮度来源 | 说明 |
| --- | --- | --- |
| `UNITS` | `AudioVisual.ExtraUnitLight` | 包括记录在 Units 中的 SCHP，不能仅按外观判成 Aircraft |
| `AIRCRAFT` | `AudioVisual.ExtraAircraftLight` | 按原始对象类别选择 |
| 建筑体素炮塔 | 不加车辆/飞机额外亮度 | NALASR、NAFLAK、NASAM、GTGCAN、YAGGUN 等使用新 VPL，SHP 底座不走 VPL |

`ObjectPainter` 需要有效规则、实际房屋颜色、`theater['mapLighting']` 和格子高度。`prepare(cells, origin)` 会保存格子；直接调用 `parts()` 时，须先设置 `painter.cells = cells`。由存档恢复地图的工具应传入完成类型恢复后的真实地图上下文，不从尚未补全的临时 `source.map` 读取光照。

### 所属色及局部换色

不能用 `Remapable=no` 跳过原版单位调色盘索引 16–31 的 SHP 所属色替换；仍保留 `TerrainPalette` 与显式 `remap=False` 的例外。建筑主体、底座、附属动画和升级部件均需覆盖，特别检查心灵控制塔、裂缝产生器、光棱塔、中立油井与机场。

Save2Map 必须继续保存 VPL 后、RGBA 前的 `image.info['palette_indices']`，未增亮的原始所属色梯度 `palette_shades`，以及每个部件的 `paletteLightStep`。局部改色时重新生成所属色再施加强度行，不能从已截白的 RGB 反推颜色，也不能让未改色区域再次增亮。局部改色的结果要与相同输入的完整重绘一致。

## 5. 载具阴影

优先复用 `ObjectPainter.voxel_parts()` 的参数选择；低层接口为：

```python
image, shadow, x, y, shadow_x, shadow_y = renderer.draw(
    original_vxl, original_hva, bridge_facing, offsets, fire_angle, lit_colors,
    shadow_section=section,       # None 禁用；主体默认 0
    shadow_scale=0.5 if considered_aircraft else 1.0,
)
```

`renderer` 是 `VoxelRenderer(task_folder, original_vpl)`。一实例对应一种 VPL，不并发调用；用 `try/finally` 关闭 worker。

- 主体只投射 `art.ini` 中 `ShadowIndex` 指定的节，默认 0；SHAD、普通 SCHP 是 2，避免旋翼进入地面投影。
- VXL 炮塔、炮管不单独投影；SHP 的 `UseTurretShadow` 不可套用到 VXL。保留规则和美术的 `NoShadow`。
- `ConsideredAircraft=yes` 使用半尺寸，作用于阴影，不缩小本体。
- `realmap_voxel_shadow.footprint()` 从选定节底面、HVA 首帧变换与朝向计算遮罩，使用 8.8 定点步进及两像素落点。使用原始 VXL/HVA，保留独立的阴影偏移。
- 阴影为 alpha=128 的黑色遮罩，按已有地表高度和可见本体遮挡规则合成。不能继续使用 DLL 全节阴影，也不能把遮罩按图像亮度处理。

本次验收重点是地面停放场景。高桥桥面、跨高度投影、运行中飞行高度及扩展引擎多节阴影不能据此宣称全部复现；移植时保留目标工具的接收面规则，并单独验证其特殊场景。

## 6. 部署状态

| 单位 | 地图/美术标识 | 完成部署后的静态外观 |
| --- | --- | --- |
| 美国大兵 | E1 / GI | `GISequence.Deployed=292,1,1` |
| 重装大兵 | GGI | `GuardianGISequence.Deployed=315,1,1` |
| 辐射工兵 | DESO | `DesoSequence.Deployed=298,1,0`，所有方向第 298 帧 |
| 武装直升机 | SCHP | `UnloadingClass=SCHD`，`schd.vxl` + `schdtur.vxl` |

地图模式读取 `[Infantry]` / `[Units]` 第 7 个字段（从 1 开始）的 `Unload` 任务，忽略首尾空白和大小写。步兵方向在第 8 个字段，载具方向在第 6 个字段，不能共用字段下标。步兵帧选择为 `start + ((7-facing//32)%8)*stride`，保留 DESO 的零步长。

`deployed_voxel_type()` 仅识别 Units 中 `Image=SCHP`、`IsSimpleDeployer=yes` 且存在 `UnloadingClass` 的对象；同美术别名也可使用。不要泛化到所有 `UnloadingClass`，否则运输单位或 SCHD 的反向转换会被误处理。

部署 SCHP 只切换显示用的模型与美术，采用 SCHD 默认 `ShadowIndex=0`；普通 SCHP 仍为 2。保留原始对象 SCHP 的类别、规则、所属方、位置、朝向和最终亮度，不把分析对象改写成 SCHD。原本已经使用 SCHD 美术的对象不再反向切换。

### 存档实际状态的适配

`Unload` 是地图任务命令，不是运行时“已部署”标志。存档中的已部署单位可能已经回到 Guard，也可能正在执行部署命令但尚未完成。因此 Save2Map 如果已经可靠恢复实际部署标志，应在渲染适配层优先使用该标志；无法确认时才退回地图任务约定。

可对仅用于显示的对象副本适配现有接口：

```python
display_obj = dict(source_obj)
# 调用方已确认这是上述四种支持对象之一，且标志是可靠的 bool。
if type(is_deployed) is bool:
    display_obj['mission'] = 'Unload' if is_deployed else 'Guard'
parts = painter.parts(display_obj)
# 不把 display_obj 的任务或类型写回转换数据/导出地图。
```

这是目标工具的接入建议，不表示 Crate Atlas 已实现存档解析。部署阶段未知时，不推断着陆、DeployDir 转向、过渡动画、开火或辐射。显示姿态按已恢复的对象朝向，不模拟后续游戏行为。

## 7. Save2Map 合并位置与缓存

2026-11-03 查阅本机目标副本时，`vendor/realmap/realmap_render.py` 是版本 16，VPL 标识为 `ra2-vpl-diffuse-specular-v1`，已存在最终强度行和局部换色扩展。该记录只是接入前快照，合并前应重新检查实际文件，不能仅凭旧版本说明认定已同步。

| 目标位置 | 要做的合并 | 必须保留 |
| --- | --- | --- |
| `hd_preview_worker.py` → `vendor/realmap/realmap_render.py` | 变体取图、新阴影合成、对象状态选择 | `recolor_cache=True`、RecolorRecorder、目标的像素面积保护 |
| `vendor/realmap/realmap_voxel.py` | 原生页表 + 恒等 VPL + 选定节阴影 | 短文件名及碰撞校验、`palette_indices` 输出、worker 关闭逻辑 |
| `vendor/realmap/realmap_objects.py` | 部署美术、ShadowIndex、所属色和强度行 | `recolor_metadata()`、原始梯度、部件记录 |
| `vendor/realmap/realmap_parser.py` / 调用上下文 | 传递恢复后的地图光照和地块 | 已有类型恢复、资源路径、地图覆盖 |
| `src/preview_recolor.py` | 确认使用 VPL 后索引，先改所属色后增亮 | 缓存格式 2 的 `paletteLightStep` 与固定像素保护 |
| `src/hd_preview.py` | 更新渲染身份和状态绑定 | `renderer_hash()`、环境身份、`shape_key` 和迟到任务隔离 |

不要整份覆盖目标的三个绘制模块：上游不包含 Save2Map 的全部局部换色扩展，也不替代其中文长路径适配。

缓存至少应区分原始资源及 VPL、实现版本/哈希、地图有效光照与高度、对象朝向、实际显示模型和部署状态、所属色、最终强度行、几何参数、阴影节与缩放。若存档实际部署标志不在生成的地图字节里，须把它加入 `shape_key` 或其已参与绑定的状态文件；否则部署与普通姿态会错误共用换色缓存。

目标现有 `renderer_hash()` 会遍历 `vendor/realmap/*.py`，新增模块会改变身份，但仍需检查索引缓存、`recolor.zip`、缩略图、导出图和 3D 纹理是否都随新身份重建。旧图不能仅改版本号继续使用。更新便携打包内容及来源清单，核对最终包中的实际文件。

高清图继续保留 `rasterScale=1` 与无损输出。Windows 原生视口应沿用自己的物理像素绘制和内存保护，不照搬网页 DPR 监听。缩小总览的采样与图集有损压缩是两回事。

## 8. 若复用到浏览器 / Toy

这部分不要求桌面 Save2Map 一并移植。Toy 官方地图捕获完整绘制结果；自定义对象库烘焙 VPL 后的索引与阴影，浏览器进行所属色和最终强度行转换。无需把 Python、DLL、MIX、VXL 或 HVA 放入网页包。

需要同步 `toy_original.py`、`toy_build_inputs.py`、`toy_live_materials.py`、`toy_live_objects.py`，以及 `toy/terrain-variants.js`、`toy-live/parser.js`、`toy-live/objects.js`、`toy-live/artwork.js` 和 `toy-live/mixed-painter.js` 的对应调用。地形元数据保存 `terrainVariants`；对象签名保留 SCHP 的 `UNLOAD`、`ISSIMPLEDEPLOYER`、`UNLOADINGCLASS` 和实际强度行，模板键则独立于所属色和强度行。

后续源码另增加 `toy_object_components.py` 与 `toy-live/components.js`，支持地图内 rules 的常规底座／炮塔组合。它们仅用于 Toy 的素材导出和浏览器组装，完整版仍使用 `ObjectPainter`。接入顺序、缓存和参数边界见 [炮塔组合说明](toy-turret-components.md)；这项增量尚未包含在 v0.6.0 发布包中。

更新构建指纹及脚本 URL 版本，替换旧图集/索引。渲染版本 19 的 Toy ZIP 为 **47,648,424 字节**，比上一版增加 9,769 字节；82 页对象图集仍逐字节相同，新增部署状态复用了已有 SCHD 像素。这是该次成品测量，每次重建仍须检查 50,000,000 字节上限。

## 9. 移植完成后的验收

在配置好原版资源和 Python 依赖的 Crate Atlas 源码中可运行以下参照检查；移植到 Save2Map 后还要用目标的实际调用链验证，不能把上游测试通过当作目标已完成。

```powershell
python -B verify-source-package.py
python -B verify-voxel-lighting.py --integration
python -B verify-palette-lighting.py
python -B verify-building-remap.py
python -B verify-terrain-shadows.py
python -B verify-deployed-art.py
python -B verify-voxel-lifecycle.py
# 可选：验证已经构建的 Toy 包
python -B verify-toy-live-objects.py --root output/toy
```

| 验收项 | 应达到的结果 |
| --- | --- |
| 地形 | 原版/尤复各气候、多子块统一变体；重开、局部重绘、导出、3D 一致；格号和通行数据不变 |
| 光照 | 4 模式、32 向及保留法线；带炮塔建筑仍正确；不通过整体地图降曝光补偿 |
| 阴影 | YTNK 无额外炮塔投影；SHAD/SCHP 不用旋翼作主体阴影；飞机半尺寸；本体不缩放 |
| 部署 | 四种单位普通/部署姿态、全朝向、所属色、阴影；SCHD 不反向转换 |
| 局部换色 | 多所属色、不同高度/亮度、建筑附属部件及部署模型，与完整重绘逐像素一致 |
| 缓存 | 旧缓存不命中新身份；部署状态变化会更新模型；迟到结果不覆盖新请求 |
| 转换与打包 | 原始存档与导出逻辑数据不变；新解压便携包在中文长路径可绘制；worker 正常退出 |

上游已有证据：352 组载具方向光照、384 组部署状态、248 组 Full/Toy 对象像素检查；部署测试区域 224,000 像素一致；Toy 的 294 份报告和 278 组唯一布局保持概率/搜索数据不变。本机证据在 `output/brightness-native-20261103/`、`output/terrain-shadow-verification-20261103/`、`output/deployed-art-20261103/`，这些缓存和截图不进入 Git，公开源码中的验证脚本可供复现。

仍未完整模拟地图 RGB 染色、局部灯光、天气、动态闪光、HVA 动画/倾斜法线、真实飞行高度及 Phobos 自定义光源。部分体素几何与所属色梯度仍采用现有桥接近似；不能把测试场景的 Full/Toy 一致理解为与游戏所有画面逐像素一致。

实现细节与历史证据：[纹理及阴影](terrain-shadows.md)、[光照接口与最终强度](voxel-lighting.md)、[原版坐标变换与页表复现](vehicle-brightness-native.md)、[部署外观](deployed-art.md)。目标工具的旧接入说明位于 `save2map/vendor/realmap/VOXEL-LIGHTING-INTEGRATION.md`，保留其中的目标专用扩展，但以本文所列的新模型和接口为合并基线。
