# Toy 地图内 rules 的炮塔组合

这些更新已打入 2026-11-04 本地 Toy 包 `output/CrateAtlas-Toy-20261104.zip`，尚未更新 GitHub v0.6.0 下载文件。只改变自定义地图的美术组装，不改地图内容、单位规则、占用或概率计算。

## 支持范围

- 注册的新类型用 `Image=` 复用包内单位／建筑；不会继承原类型规则。布尔写法 `yes`、`true`、`1` 按同一含义处理。
- `Turret=no`（或新类型没有声明 `Turret`）省略独立炮塔／炮管，保留底座、附属动画及对应阴影。
- 建筑用 `TurretAnim`、`TurretAnimIsVoxel` 选择已收录的炮塔零件，按 `TurretAnimX/Y` 平移；`VoxelBarrelFile` 可引用已有且投影状态匹配的炮管。损坏／残骸底座、炮塔方向和前后顺序与完整版共用同一来源。
- 载具 `Turret=yes` 仍使用该 `Image` 的配套炮塔，不引入完整版没有支持的任意载具炮塔混搭。
- 车身／底座和炮塔分别保留调色板索引；VXL 炮塔按目标建筑的调色板、所属色和地图亮度换色。SHP 保持自身调色板。`NoShadow` 可省略整组阴影。
- 美国大兵、重装大兵、辐射工兵、武装直升机原有部署状态路径保留；正常／部署底座使用不同键。

不读取外部 art、MIX 或 Mod DLL。只使用库内已有的模型、帧和已烘焙几何参数；`FireAngle` 等没有对应状态时采用缺失素材简绘，不用相近角度假装支持。SHP 炮塔也必须存在已收录的帧组合。地图中的 `TurretAnimZAdjust` 等完整版当前未应用的字段不增加额外解释。画进底座贴图或合入同一 VXL 的部分不能独立移除。额外建筑升级件仍沿用原有完整模板匹配路径。

## 实现

`toy_live_objects.py` 导出原有整组模板，同时通过 `toy_object_components.py` 生成 `components` 元数据。新增 `toy-live/components.js` 在浏览器按实际渲染依赖选择零件，`toy-live/objects.js` 解码、换色并返回共享的绘制部件；2D、3D 和导出共用这条路径。

- 底座键包括类别、Image、雪地步兵外观、飞行器阴影比例、损坏状态、朝向和部署状态；与武器、生命上限等无关。
- 体素零件键包括模型名、32 向朝向及已烘焙的 FireAngle。只有零 lepton 偏移的模型可以跨建筑复用，避免将旋转后的偏移误当成二维平移。
- 载具配套炮塔保留原生装配后的偏移及顺序。建筑炮塔在零偏移模型上施加二维偏移，并按目标底座的 `BarrelOverTurret` 和地图方向排定顺序。
- 单独保存可用 VXL/HVA 名称，区分“本来没有炮管”与“素材存在但角度未收录”。后者不能静默省略。
- 运行时对象结果缓存包含类型 ID：当炮塔名不以 `tur` 结尾时，完整版的默认炮管可能是 `<类型ID>barl`，同一个 Image 不保证相同炮管。
- 新组合同时导出底座 SHP 阴影；旧补充模板只有 VXL 阴影，不足以复现移除炮塔后的底座。影子仍作为独立接收面绘制，不染所属色。
- 新构建脚本在 `objects.js` 前加载 `components.js`。组件生成源码参与 `frame_stamp()`，导出库和前端纳入 `liveVersion`；不能仅把新 JS 拷入旧素材库就认为已升级。

原有官方地图图集和整组模板保留。缺少组件或尚未支持的组合仍走原有模板／简绘回退。没有穷举所有底座与炮塔组合，也没有加入浏览器体素渲染器。

## 验证

向独立开发站点生成补充对象库（`toy_live_objects.build(site/live/objects, cache)`），不运行会生成 ZIP 的发布构建步骤。然后运行：

```powershell
.\run-python.cmd -B verify-toy-components.py --output output/toy-components-20261104
node verify-toy-components.cjs output/toy-components-20261104 output/toy-components-20261104/site
.\run-python.cmd -B verify-toy-live-objects.py --root output/toy-components-20261104/site --output output/toy-components-20261104/stock-regression
.\run-python.cmd -B verify-toy-lighting-build.py
```

Node 像素测试需要 `@napi-rs/canvas`；浏览器验收需要 Playwright 和 Edge。像素对照由完整版 `ObjectPainter` 生成期望，校验 Toy 零件的像素、尺寸、锚点、阴影、方向与调色结果；另外覆盖异名同外观的默认炮管缓存冲突、未烘焙角度回退和真实地图声明解析。

2026-11-04 最终 ZIP 为 49,369,265 字节，通过 50,000,000 字节门禁；保留官方地图、精确概率数据和无损素材。素材库增量不能直接当成最终压缩包增量。

2026-11-04 验证记录位于 `output/toy-components-20261104/`：

- `parity.json`：12,372 个组合状态、33,951 个部件的像素／锚点／阴影对照通过；原有 33,138 个模板的可见部件保持一致；27 个未支持状态正确回退。
- `browser.json`：Edge 实际导入 18 个地图内声明对象，零简绘回退；19 个状态直接校验浏览器解码像素；3D、图片／JSON 导出和两种布局缓存均通过。浏览器测试入口为 `verify-toy-components-ui.cjs`，使用 `TOY_BASE`、`TOY_QA_OUT` 指向开发站点和上述记录目录。
- `scene-parity.json`：组合对象所在场景区域的 583,200 像素与完整版一致，包含底座动画及地面阴影。
- 原有 248 个素材状态逐像素回归通过；组件库命中构建缓存后输出逐字节一致；源码清单、模块边界及光照／组件缓存失效测试通过。

## 盟军机枪碉堡方向与围墙交汇帧

原版 `GAPILL` 没有独立炮塔，建筑记录的方向不选择另一张底座图。已发布 v0.6.0 的补充库已包含它；Python `object_key` 和浏览器解析器都会把无炮塔建筑的素材方向归零。`verify-toy-walls.py` 覆盖 RA2/YR 的 9 个版本／气候范围、3 种健康状态、全部 256 个方向，共 6,912 个状态；`verify-toy-walls.cjs` 另验证真实地图记录的方向归一化。地图自定义建筑仍须检查其注册、Image 和实际规则，不能仅凭中文名称认定是 GAPILL。

随后用用户实际的 `sov01umd.map` 复现：地图 `[GAPILL]` 声明 `Turret=yes`，但没有 `TurretAnim`。其中 14 个 GAPILL 的方向全为 0。旧 Toy 因完整外观签名的 Turret 字段变化而把这 14 个对象全部显示为简绘，并非方向缺素材；新版组件路径保留固定底座，14 个全部恢复。回归新增另外 6,912 个 `Turret=yes`、无 `TurretAnim` 的跨气候／健康／方向状态，以及 256 个实际地图记录的组件一致性检查。实图证据位于 `output/toy-sov01-gapill-20261104/`，源地图未修改；新包验收证据位于 `output/toy-release-20261104/`。

围墙三岔／十字交汇缺图的原因是共享素材原先只采集官方地图中出现过的状态，未穷举 SHP 帧。例如沙袋、黑／白栅栏缺少 `7、11、13、14、15` 等交汇帧；有些墙体在部分气候下完全没有采集记录。

`toy_live_walls.py` 现在按固定原版资源读取所有 `Wall=yes` 的覆盖物，排除经像素验证的配对阴影半区，将缺失的连接／损坏帧补到 `live/materials.json.gz` 和共享 `art/walls-*.png`。只追加素材 ID，保留原有对象与地形引用；不修改地图的 OverlayData、连接状态或通行计算。构建时根据源码和资源指纹重建，旧补充项可移除后重建，避免重复追加。`build-toy-live.py` 在生成共享素材后调用补齐步骤，缓存版本仍由完整产物内容决定。

2026-11-04 静态核验覆盖 2,768 个墙体帧，新增 2,438 个原先缺失的状态，去重为 635 张图片。新增 PNG 合计 1,197,743 字节，已包含在上述本地 Toy 包中。原有素材 ID 不变，重复构建和源码失效重建可复现。验证入口：

```powershell
.\run-python.cmd -B verify-toy-walls.py --output output/toy-walls-20261104
node verify-toy-walls.cjs
```

设定 `TOY_BASE` 可运行浏览器部分；`TOY_QA_OUT` 指定证据与独立开发站点目录。浏览器夹具包含 8 类墙体的全部 16 种连接形态和 8 个不同方向的 GAPILL，覆盖导入、3D、导出与清空资源后的布局。

## 2026-11-04 本地包验收

`output/CrateAtlas-Toy-20261104.zip` 实测为 **49,369,265 字节**，低于 50,000,000 字节；SHA-256 为 `a884eb719e33ae914261ce57de1c4ad5062acbd731d2978693706de2b9080b45`。本次未上传 GitHub Release。

`output/toy-release-20261104/package-verification.json` 记录 131 个菜单项、294 份布局报告、1,598 个文件校验通过，格子概率与搜索结果保持一致。从 ZIP 重新解压后，使用仅含 Windows 系统目录的 PATH 运行包内 `Start Toy.cmd`，确认无需 Python 或 Node；组件像素对照、浏览器导入、围墙连接、3D、导出和实际 `sov01umd.map` 的 14 个 GAPILL 均通过。解压文件在测试后保持原哈希，记录见该目录的 `browser-verification.json`。

`output/latest-release.json` 的 Toy 入口已切换到 `CrateAtlas-Toy-20261104`，工作区与源码目录的统一启动脚本均读取此指针；原活动安装的 `Start Toy.cmd` 改为 `.cmd.txt` 归档。完整版指针保持不变。切换记录见 `output/toy-release-20261104/activation.json`。
