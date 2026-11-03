# Toy 载具光照预烘焙构建

日期：2026-11-03。算法与适用范围见 [光照复用说明](voxel-lighting.md)，前期容量评估见 [体积实测](toy-lighting-size.md)。

后续版本补齐了单位最终亮度；本页保留首次 VPL 修复交付的历史数据。后续成品及验收见 [最终亮度修复构建](toy-brightness-release.md)。

## 本地成品

| 成品 ZIP | 大小／字节 | 距 50,000,000 字节余量 |
| --- | ---: | ---: |
| [官方地图原版贴图版](../output/toy-original-lighting-20261103.zip) | 49,644,853 | 355,147 |
| [现场计算实验版](../output/toy-live-lighting-20261103.zip) | 48,836,405 | 1,163,595 |

两个包均包含 131 个官方菜单选项、147 个地图／版本组合、294 套布局。旧包保留；这次完成本地成品构建，没有发布到远端平台。与前期测量包相比，这次按当前源码重建了匹配底包及清单，因此实际体积略有变化。

50 MB 指 ZIP 大小。解压后分别为 52,865,370 和 50,056,276 字节，不能据此声称解压目录小于 50 MB。每份 ZIP 旁都有 `.zip.sha256` 校验文件；[成品身份、大小及旧包保留验证](../output/toy-lighting-release-verification.json) 同时记录哈希。

## 构建实现

光照在开发机读取原始 VXL 法线、朝向及 VPL 时计算，输出无损图集。浏览器不运行体素渲染器；官方地图的 2D、小地图、裁图、导出和 3D 使用同一批新素材。现场计算版另烘焙原版单位及朝向的调色盘索引图集，仍支持所属色换色。

- `realmap_render.render(..., save_images=False)` 为命令采集提供明确入口，保留绘制和审计，跳过整图编码。`toy_original.capture()` 不再调用需要真实像素表面的图片保存接口。
- `toy_build_inputs.artwork_fingerprint()` 覆盖绘制模块、新光照算法、法线表、实际 worker／DLL 及经内容校验的原版资源身份。官方图集和现场对象库均使用该身份使旧缓存失效。
- 构建清单记录 `voxelLightingModel`、`artworkSourceSha256`，现场版另记录 `liveObjectSourceSha256`。新成品没有实验测量用的 `artworkMeasurementOnly` 标记。
- 保留分析源码指纹校验。本次从当前源码生成匹配的底包，复用经过验证的官方概率预计算；不通过修改旧清单指纹来跳过检查。
- `--reuse-atlases` 只复用完整解码像素与尺寸相同的已压缩页；不同像素重新无损编码。复制前校验源包文件清单，拒绝将新的底包与旧输出目录中的分析／图集混合。
- 重新生成现场版共享素材索引、补充对象库及浏览器资源版本，继续执行 ZIP ≤ 50,000,000 字节门槛。

## 构建命令

下列路径用于本次构建；复现时使用新的输出目录。`--reuse-atlases` 是可选的编码加速，不改变绘制结果。

```powershell
.\run-python.cmd -B build-toy.py --output output/toy-lighting-base-20261103 --mode standard --mode teamgame --jobs 3 --artwork-style tiles
.\run-python.cmd -B build-toy-original.py --source output/toy-lighting-base-20261103 --output output/toy-original-lighting-20261103 --art-cache output/toy-original-lighting-cache-20261103 --reuse-atlases output/toy-original/art --jobs 4
.\run-python.cmd -B build-toy-live.py --source output/toy-original-lighting-20261103 --output output/toy-live-lighting-20261103 --object-cache output/toy-live-lighting-object-cache-20261103
```

这两份输出是独立目录，不覆盖 `output/toy-original` 或 `output/toy-live`。本地预览可指定新目录：

```powershell
.\run-python.cmd -B serve-toy.py --root output/toy-original-lighting-20261103 --port 8790 --open
.\run-python.cmd -B serve-toy.py --root output/toy-live-lighting-20261103 --port 8791 --open
```

## 验证入口

```powershell
.\run-python.cmd -B verify-toy-lighting-build.py
.\run-python.cmd -B verify-toy.py output/toy-original-lighting-20261103 --mode standard --mode teamgame
.\run-python.cmd -B verify-toy.py output/toy-live-lighting-20261103 --mode standard --mode teamgame
.\run-python.cmd -B verify-toy-live-objects.py --root output/toy-live-lighting-20261103 --output output/toy-lighting-live-pixel-qa
```

浏览器回归使用 `verify-toy-original.cjs`、`verify-toy-live-ui.cjs`。`TOY_BASE` 指向所测新包的静态服务，`TOY_QA_OUT` 指定独立证据目录；原版测试还接受 `TOY_ROOT`，确保本地解码检查也读取同一个新包。Node 需要可用的 Playwright 模块和 Edge。

`verify-toy-lighting-build.py` 会比较采集后逐条合成的地形／对象图与完整版像素，检查法线表、算法及 worker 变化能否使两类缓存失效，并验证不同像素不会误用旧编码图集。

## 本次验证结果

- 两份 ZIP 分别通过 131 项、294 套布局的精确格子／概率／来源数据校验，以及完整文件清单、相对链接、压缩包哈希和体积检查。
- 全部 278 套新采集结果与前期已验证的新光照像素／绘制命令完全一致；两个旧基线 ZIP 的 SHA-256 未变。
- 两款网页的桌面和手机模拟回归通过，覆盖地图加载、导航、区域保存、3D、布局切换及导出；现场版另外验证自定义地图、取消／错误恢复。手机检查是浏览器模拟及 4 倍 CPU 降速，不等于实机平台验收。
- 现场对象库的 32 个代表状态通过真实渲染器像素、所属色换色、朝向、锚点与损坏建筑对照。
- 首次现场版手机测试中的固定 350 毫秒等待与 300 毫秒延迟保存发生时序竞争。测试已改为等待实际持久化状态，重跑桌面及手机测试通过；网页包没有为此修改，首次日志保留。

记录见 [整体回归摘要](../output/toy-lighting-qa-20261103/summary.json)、[官方图集数据校验](../output/toy-lighting-qa-20261103/original/package.json)、[现场版数据校验](../output/toy-lighting-qa-20261103/live/package.json) 及 [成品像素／身份校验](../output/toy-lighting-release-verification.json)。测试用静态服务已关闭，预览时按上文命令启动。
