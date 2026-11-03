# 单位最终亮度修复构建

日期：2026-11-03。此版本在第一次 VPL 法线修复之上增加单位额外亮度、地图环境亮度和高度照明。算法与适用范围见 [光照复用说明](voxel-lighting.md)。

## 交付状态

完整版已生成：`output/CrateAtlas-Windows-x64-brightness-20261103.zip`，347,826,114 字节。使用包内 Python、原版资源和体素组件完成绘制检查，文件清单及 ZIP 完整性通过。原版概率缓存身份仍为 `fb5a1ed7203efec72a1cb4c00edde7b065d0986ce279a0ea89b93b1c955f3cd8`，278 套布局继续有效。

两份 Toy 均已生成，包含 131 个菜单选项、147 个地图／版本组合、294 套布局，图集共 663 页；现场版另有 67 页单位索引图集。

| ZIP | 实际字节 | 距 50,000,000 字节余量 |
| --- | ---: | ---: |
| [官方贴图版](../output/toy-original-brightness-20261103.zip) | 49,779,157 | 220,843 |
| [现场计算版](../output/toy-live-brightness-20261103.zip) | 48,977,071 | 1,022,929 |

50 MB 门槛指 ZIP，解压后分别为 52,997,853 和 50,191,971 字节。每份 ZIP 旁有 `.zip.sha256`；[大小、模型身份与 SHA-256 记录](../output/voxel-brightness-verification-20261103/packages.json)已核对。旧包哈希不变，保留在 [第一次构建记录](toy-lighting-release.md)。本次仅本地交付，没有远端发布。

## 构建与复现

```powershell
.\run-python.cmd -B build-toy.py --output output/toy-brightness-base-v2-20261103 --mode standard --mode teamgame --jobs 3 --artwork-style tiles
.\run-python.cmd -B build-toy-original.py --source output/toy-brightness-base-v2-20261103 --output output/toy-original-brightness-20261103 --art-cache output/toy-original-brightness-cache-20261103 --reuse-atlases output/toy-original-lighting-20261103/art --jobs 4
.\run-python.cmd -B build-toy-live.py --source output/toy-original-brightness-20261103 --output output/toy-live-brightness-20261103 --object-cache output/toy-live-brightness-object-cache-20261103
```

实际构建将已完成的报告提前送入同一个 `capture()`，并提前无损编码；最终构建使用 `--reuse-atlases output/toy-brightness-atlas-warmup/art`，仍逐页核对完整解码像素后才复用。此调度只缩短等待，不改变构建器或校验规则。上面的命令不需要这些临时调度脚本，也能生成同样的绘制内容。

地图光照由渲染层从哈希匹配的源地图读取，保留概率模型身份；画面缓存另包含新亮度模块、地图参数及最终强度行。正式构建使用上面的独立 v2 底包，原有概率缓存的校验规则保持不变。

## 验证

- `verify-palette-lighting.py`：实际模型增亮、透明轮廓／阴影／锚点保持、特殊色与截白、地图覆盖及不同高度的缓存区分。
- `verify-toy-lighting-build.py`：带非中性环境光的 Toy 命令合成与完整版逐像素相同；最终亮度模块变化会使缓存失效。
- `verify-toy-palette-lighting.py`：30 个对象的 Python／JavaScript 素材键一致；378 组调色盘／所属色组合覆盖全部 63 个强度行。
- 16 套现场分析夹具继续通过精确格子、搜索来源与概率检查。
- `verify-object-layout.py` 六项布局检查和 `verify-portable.py` 八项便携构建检查通过。
- 两款 Toy 的桌面／手机模拟浏览器回归通过，覆盖加载、导航、3D、布局切换、保存及导出；现场版另外覆盖自定义地图、取消与错误恢复。浏览器证据分别位于证据目录的 `original-browser/`、`live-browser/`，两张桌面 3D 图已人工查看。
- 两份最终 ZIP 均通过全包校验：各 131 个菜单项、294 套布局的格子、精确概率、搜索来源和文件清单一致，ZIP CRC、SHA-256 与 50 MB 门槛通过。现场对象库另外通过 32 个真实原版状态的像素、所属色换色、锚点、朝向及损坏建筑对照。

最终摘要见 [release-summary.json](../output/voxel-brightness-verification-20261103/release-summary.json)，完整数据核对见 [官方贴图版](../output/voxel-brightness-verification-20261103/original-package.json) 和 [现场计算版](../output/voxel-brightness-verification-20261103/live-package.json)。QA 临时静态服务已关闭。源码服务曾验证为绘图版本 15；随后发现 8767 被 `output/release-v0.5.0/CrateAtlas-v0.5.0-Windows-x64`（绘图版本 13）重新接管。旧安装保留，使用本次新完整版的启动入口后，重新分析或显式重绘旧结果才能看到修复。

现场素材模板沿用旧版相同的 276 项不可用状态，无新增缺失项。模板预热后，正式构建日志中的 `0 unavailable stock states` 是缓存分支未重新收集缺失列表的旧日志行为，不表示原有缺失消失；实际列表保存在 `output/toy-live-brightness-object-cache-20261103/missing.json`。

证据目录：`output/voxel-brightness-verification-20261103/`。`brightness-before-after.png` 为同一原始模型、方向和所属色的原生渲染前后对照，并非游戏截图对拍。未模拟局部灯光、动态天气、倾斜／动画法线及扩展引擎光源；SHP 光照不在这次修复范围内。
