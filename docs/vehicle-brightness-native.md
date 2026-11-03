# 载具偏亮修复：原版坐标变换与 VPL 页

2026-11-03；绘图版本 18、3D 版本 7；表面光照模型 `ra2-native-vpl-v2`。
本增量替代 `ra2-vpl-diffuse-specular-v1` 的方向计算。适用于完整版及唯一维护的 Toy。

## 原因

此前采用编辑器的近似：将水平光 `(-cos(r), -sin(r), 0)` 直接与 VXL 法线点乘。原版游戏先给世界光源加入仰角，再通过完整的等角相机／单位矩阵逆变换，得到模型坐标中的光源。遗漏这两步会错误地照亮部分顶面和侧面；提高亮度补偿旧模型后，车辆的白色、金属色尤其偏亮。

这不是地图整体曝光问题。用户同场景截图的两块无遮挡地面，旧工具的加权 RGB 亮度约高 2.2%–2.3%，载具内部约高 12.7%。截图经过缩放、显示过滤，数值只用于诊断，不能当作原生帧逐像素测量。

`ExtraUnitLight=.2` / `ExtraAircraftLight=.2` 是原版规则，不能通过删除它们来掩盖方向错误。修正方向后继续保留这两项，所属色、地图高度和环境强度处理不变。调色盘 16 位量化、所属色梯度、几何细节、动态姿态等仍存在独立近似，本次不声称整个画面与游戏逐像素一致。

## 原版算术证据

在隔离的 32 位辅助进程中，只调用本地已验证 YR 1.001 映像的纯数学函数，不调用游戏入口、不打开游戏窗口、不访问运行中的游戏进程。映像 SHA256：

`58144dbadf8a5ce7fa834b81498a41607a0405365c832171545494ae71321397`

| 地址 | 用途 |
| --- | --- |
| `0x754c00` | 世界光源仰角初始化 |
| `0x5ae860`、`0x5aef60`、`0x5af1a0` | 恒等矩阵、X/Z 旋转 |
| `0x5afc20`、`0x5afb80` | 逆矩阵和向量变换 |
| `0x7586f0` | 法线到 VPL 页的漫反射／高光计算 |
| `0x8469f4`、`0xb45990` | 法线数量表、页计算结果 |

调用关系另经 `0x754cb0`（等角矩阵）、`0x73b470`（单位绘制）、`0x55a730` / `0x4aff60`（朝向）、`0x753d00`（光源变换）核对。辅助程序采用游戏的 x87 控制字 `0x0e7f`。

实际世界光源约为 `(-.5, -.707106, .5)`。先将桥接方向还原为地图方向 `direction32=(bridgeFacing+8)%32`。直立单位的默认矩阵为 `Rx(-60°) * Rz(-45°) * Rz(-(direction32-8)*2π/32)`；模型光源为该矩阵的逆乘以世界光源，视向量为 `(0,0,1)`。例如地图方向 0（桥接方向 24）的原版模型光源为 `(-.910113811, -.201302215, -.362170935)`。游戏的快速三角函数使其与标准数学库结果略有差别。

随后仍使用：

```text
h = normalize(light + (0,0,1))
diffuse = max(dot(normal, light), 0)
t = dot(normal, h)
specular = max(t / (3 - 2*t), 0)
page = clamp(truncate(16 * (diffuse + specular)), 0, 31)
```

原版快速平方根及浮点舍入也会影响极少量临界值。例如模式 1、地图方向 16（桥接方向 26）、法线 6，原版结果为页 17，普通数学库重算可能得到页 16。为保留这些细节，本工具存储原版四种法线模式 × 32 个朝向共 11,552 个页值，压缩后仅几 KB。未定义法线保留页 0，特殊法线 253–255 保留页 16。

同时修正标准法线表模式 4、索引 241 的 X 符号，应为 `(-.328188, .140251, .93414301)`。不改 VXL/HVA 原始文件。

## 合并与重建

复用工具需复制 `realmap_voxel_lighting.py`、新增的 `realmap_voxel_light_tables.py`、修正后的 `realmap_voxel_normals.py`。既有 `realmap_palette_lighting.py`、阴影模块与外层所属色／地图光照上下文继续保留。`shade_vxl()`、`identity_vpl()` 和 `lighting_pages(mode, bridgeFacing)` 接口未变；SHP 不经过本次 VPL 修复。

完整流程仍为：原始法线选 VPL 页 → 用恒等 VPL 做几何绘制 → 已换所属色、已算地图强度的调色盘映射 RGBA。不可给最终截图整体降曝光，也不可再次应用 DLL 的旧光照。

更新缓存版本并重新生成官方图集、自定义对象模板、2D／3D 预览。Toy 只换预烘焙图集／索引，不新增 Python、DLL、原始 VXL 或游戏可执行文件。每次成品仍须独立检查 50,000,000 字节 ZIP 上限。

## 复现与验收

生成器 `generate-voxel-light-tables.py` 在执行前严格校验上述映像 SHA256；其他版本直接拒绝。C 辅助程序为 `voxel-lighting-oracle.c`。使用支持 `-m32` 的 MinGW GCC：

```powershell
.\run-python.cmd -B generate-voxel-light-tables.py --game D:/Ra2/Work/yr-veterancy-lab/runtime/gamemd.exe --compiler D:/Algorithm/Toolchains/w64devkit-2.10.0/w64devkit/bin/gcc.exe --check
.\run-python.cmd -B verify-voxel-lighting.py --integration
.\run-python.cmd -B verify-palette-lighting.py
.\run-python.cmd -B verify-toy-lighting-build.py
```

原版页值按模式、桥接方向、法线顺序拼接后的 SHA256：
`f33cc716b0ea4942f7083d1273608d9cf736753f7f23cff6a20ae9d88c5c3576`。

本轮诊断、截图测量、轮廓／阴影回归、成品校验保存在 `output/brightness-native-20261103/`。其中 `native-verified.json` 是独立原版函数输出；`geometry-invariants.json` 检查 7 种真实模型 × 32 朝向；`body-comparison.json` 是用户截图的配准比较；`release-summary.json` 记录完成后的成品路径、校验和、体积和测试结论。

本场景配准后，33,317 个去掉一像素边缘的车体内部采样点，加权 RGB 平均亮度从游戏 86.527 / 旧工具 97.538，改善为新工具 87.686（约 +1.34%）；RGB 平均绝对误差从 35.81 降至 27.15。两份用户地图报告重绘后，地面逐像素相同，概率／区域数据相同。该平均值不代表每个颜色或像素都达到 1.34% 精度；截图缩放过滤、所属色梯度和现有几何仍产生局部差异。

一手项目交叉参照：[Phobos 原版体素光源说明](https://phobos.readthedocs.io/en/stable/Fixed-or-Improved-Logics.html#voxel-light-source-customization) 给出的默认方向约为 `(0.201,-0.907,-0.362)`，同样包含负的 Z 分量，并非旧实现的水平光。不同接口的方向／轴约定不能直接互换；生产表以本地原版函数及上述桥接换算为准。
