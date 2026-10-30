[English](README.md) | **简体中文**

# Crate Atlas · 红警 2 / 尤里的复仇工具箱概率工具

真实地图概率计算与交互式机制演示，支持 Windows 10 / 11 64 位。本项目在本机运行，无需启动游戏。

## 界面语言

首次通过启动器运行时，按 Windows 显示语言选择简体中文或英语（非中文系统使用英语）；页面顶部可随时切换，首次自动选择也会保存，后续启动使用上次选择。设置保存在 `data/ui-language.json`，不随源码或发布包分发。直接以文件方式打开演示时使用浏览器语言并保存在浏览器中。自定义地图名、区域名、文件名和路径不翻译；两种语言界面下，官方地图均可用中英文名、拼音全拼和首字母搜索，例如 `bingtianxuedi`、`btxd`、`Heck Freezes Over` 均可找到冰天雪地。

区域编辑的「当前区域」可选择「空」：画笔、框选和填充命中的格子会从所有区域移除，包括重叠归属，不受选择／取消选择或 Shift 影响。取色及 Ctrl + 左键可拾取未划分格并恢复上次工具。空作为编辑状态自动保存，不增加统计区域，支持撤销／重做。

## 直接使用

**v0.5.0 Windows 64 位完整版：[ZIP 包](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.5.0/CrateAtlas-v0.5.0-Windows-x64.zip) · [7z 包（下载更小）](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.5.0/CrateAtlas-v0.5.0-Windows-x64.7z)**。两种包内容完全相同；7z 需要支持该格式的解压工具。完整解压后双击 **启动工具.cmd**（英文文件名 **Start Crate Atlas.cmd** 也可），默认进入真实地图概率计算。无需安装 Python、Node.js 或游戏；自带运行环境、官方地图和经过哈希校验的原版资源。游戏目录为可选项，用于读取其他安装或 Mod；发布包不携带任何具体 Mod 配置或美术素材。

[发布说明与附件](https://github.com/jjbsded/ra2-crate-atlas/releases/tag/v0.5.0) · SHA-256 校验文件：[ZIP](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.5.0/CrateAtlas-v0.5.0-Windows-x64.zip.sha256) / [7z](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.5.0/CrateAtlas-v0.5.0-Windows-x64.7z.sha256)。升级时请先关闭旧版启动窗口，并解压到新目录；区域划分迁移见 [使用与迁移](PORTABLE.md)。

另提供 [v0.4.0 Toy 网页 ZIP](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.4.0/CrateAtlas-v0.4.0-Toy-Web.zip)（[SHA-256](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.4.0/CrateAtlas-v0.4.0-Toy-Web.zip.sha256)）。这是**低清简化版，非完整版**，可直接上传 Toy，或解压后使用 HTTP 静态服务预览；收录全部 131 项官方作战／小队联盟地图，ZIP 小于 50 MB。此包不含 Windows 启动器和自定义地图分析服务，使用方式见 [网页版说明](TOY.md)。

v0.5.0 新增经过校验的官方地图预计算、可复用的地图绘制缓存、报告与图像无损压缩，以及更小的 7z 完整包。概率精度、原版素材分辨率、3D 与导出功能保持不变。本次更新 Windows 完整版；已发布的 Toy 下载仍为 v0.4.0。

“Code → Download ZIP”仅提供源码和小型组件，直接使用请选择上面的便携包。源码运行方式见下文；index.html 的概率演示可直接打开。

## 功能

- 内置两版官方多人地图菜单：248 份原始地图文件，按模式整理为 256 个选项，支持名称／文件名搜索，以及版本、模式、最大人数、气候类型筛选。同名地图只比较与箱子有关的静态内容；相同的两版合并显示，仍分别保留原文件并允许选择分析规则。
- 解码原始地形、高度、覆盖物和地图初始建筑／单位，占用判定独立于图像。
- 按原版静态模型计算下一次放箱的精确概率，最终概率显示两位有效数字，普通格以 1× 为基准。
- 完整版与 Toy 版均支持区域自动划分，玩家可设为 A–D 小队、中立（默认，各自独立）或空。同队共享区域且互不阻挡；统计模式用区域色方块、队伍字母及空位红叉标记玩家。中心标签显示名称与总概率，名字字号为概率的 70%、垂直居中，统一外白内黑双层描边；设置自动保存，支持撤销／重做与同步导出。
- “矿石/树木:开／关”与概率按钮并排：关闭后移除地图预置的矿石、宝石和树木，重算地面属性、附近搜索、重抽概率及禁行标记。主图、小地图、区域统计、3D、图片和数据导出同步使用当前布局；保留缩放、选中格、区域划分及撤销记录。重新开启恢复原始布局。矿石钻井、其他对象不移除，不模拟后续矿石生长；目录资源同步更新近似概率，并标注不保证准确。
- 标记当前放箱后禁行格，以及完全移除建筑、矿物、树木和单位后可能新增的禁行格。
- 选中格子可查看附近搜索转入的来源（含地形投影优先规则），青蓝标识贴合地形，按固定起点的一次搜索转入概率显示深浅与百分比（不计失败后重抽）；再次点击取消并恢复原有图层，拖动不取消。直接重抽不计入来源。
- 显示建筑、步兵、车辆和飞机，支持阵营色与静态朝向；概率倍数保持在图像上方。
- 选中格子后点击“3D查看”，围绕该格旋转、缩放和平移附近地形，查看相关高格与高差判定范围；默认 21×21，可切换为 9×9、13×13、17×17 或 31×31，支持双向选格与放箱前后比较。“概率:关”默认关闭，开启后显示与主图一致的概率着色和倍率，放大可查看标签。复用当前气候的实际 TMP 子块、坡面高度、悬崖扩展图以及树木／矿物静态素材，全部依赖随工具离线加载。
- 可拖动、最小化和关闭的地图导航面板，含小地图和八方向选格按钮；方向键支持短暂延迟组合斜移与长按连移，选中格显示从格子边缘向内延伸的中空十字；导出当前画面 PNG 和完整地图高清 JPEG。
- 大尺寸金色／青蓝色按钮切换真实地图计算与概率演示，演示支持逐步播放和 MP4 导出。
- 两个页面顶部均有「高差演示」入口，在新标签页打开；默认展示孤立单高格，也可切换到冰天雪地原图局部。支持旋转、选格和放箱前后地面属性比较，无需导入地图或选择游戏目录。
- 游戏目录为可选项，自动发现目录中的规则、美术和扩展 MIX；目录资源使用近似概率，未知物体按放箱失败重抽处理，并明确显示准确性告警。

概率针对地图初始静态状态，不模拟正在运行的游戏、脚本执行或所有 Mod 扩展。具体范围见 [真实地图说明](REAL-MAPS.md)。

官方地图收录作战、巨富、抢地盘、生死斗、海战、小队联盟与合作地图，不包含战役、发行包中未列入官方菜单的文件或仅在目录中登记但未发行的地图。巨富等模式使用各自实际地图文件。当前内置的 **248 份官方地图均可按静态模型分析**，包括普通斜坡矿石、巴黎边界桥梁、桥面／桥下预置对象、初始关闭的闸门及合作地图中的空基础建筑记录。模式标签不代表模拟该模式的开局单位、触发或后续对局。机制和验证边界见 [桥梁研究](docs/bridge-crates.md) 与 [官方地图加载](docs/stock-map-loading.md)。

版本合并比较地形通行属性、高度、坡面、覆盖物、初始占用、可移除对象清空后的状态，以及箱子相关规则；预览、光照、AI 和编辑器信息不影响合并。尚不能完整解析的地图保留版本标签，避免误合并。

## 源码与开发

Toy 网页版是 **低清简化版，非完整版**，包含全部官方作战／小队联盟地图，支持区域自动划分、连通填充与总概率标签；默认逐格拼接简化地表和对象符号，配合无损概率数据，适配 50MB ZIP 上限。本地构建、触控操作与验证见 [网页版说明](TOY.md)。已构建时可双击 **启动Toy网页版.cmd**，使用独立的纯静态预览服务器。

Git 保存核心源码、示例地图、机制文档、纯逻辑验证脚本和必要的小型本地组件。大型资源与完整运行环境不进入 Git；分析结果、截图、视频、缓存、旧版导入 MIX、本机 Mod 目录均不提交。

```powershell
gh repo clone jjbsded/ra2-crate-atlas
cd ra2-crate-atlas
```

开发时使用 Python 3.11+ 并安装 requirements.txt；将自己安装的原版 ra2.mix 和 ra2md.mix 放入 assets/original（程序会校验哈希），或使用已准备好的本地依赖。以下为配置了内嵌 Python 的启动示例：

源码目录可双击「启动工具.cmd」测试完整版地图分析，「启动演示.cmd」只进入概率演示，「启动Toy网页版.cmd」测试已构建的 Toy 网页。三个入口共用 `run-python.cmd`，优先使用本目录内嵌 Python，也支持 `CRATE_ATLAS_PYTHON`、项目 `.venv`、工作区相对路径下已有的便携运行时和 PATH 中的有效 Python；跳过 Windows 商店的占位快捷方式。运行时只复用解释器，加载的仍是当前工程代码。

```powershell
.\runtime\python\python.exe -B server.py --open
```

默认端口为 8767；可追加 `--port 8777`。用 `--page demo` 直接进入演示。手动配置开发环境可用 Python 3.11+ 及 `requirements.txt`；视频导出另外需要 Node.js、`@napi-rs/canvas` 和 FFmpeg。

启动后可直接访问 [高差演示](http://127.0.0.1:8767/cliff-demo.html)。场景和原版雪地贴图随项目内置，复用地图分析的 3D 绘制模块；孤立高格示例只说明地面属性变化，不计算随机箱子概率或完整可达路线。开发时可用 `python -B build-cliff-demo.py` 从原版冰天雪地重建演示数据。

不依赖地图分析输出的逻辑检查：

```powershell
.\runtime\node\node.exe verify-exact.cjs
.\runtime\node\node.exe verify-random-frame.cjs
.\runtime\node\node.exe verify-timing.cjs
.\runtime\node\node.exe verify-ui-enhancements.cjs
.\runtime\node\node.exe verify-transfer-origins.cjs
.\runtime\node\node.exe verify-selection-keyboard.cjs
.\runtime\node\node.exe verify-resource-ui.cjs
.\runtime\node\node.exe verify-terrain3d.cjs
.\runtime\node\node.exe verify-official-maps.cjs
.\runtime\python\python.exe verify-official-maps.py
.\runtime\python\python.exe verify-realmap-3d.py
.\runtime\python\python.exe verify-cliff-demo.py
.\runtime\python\python.exe verify-minerals.py
.\runtime\python\python.exe verify-portable.py
.\runtime\python\python.exe verify-source-package.py
```

重新构建完整便携包：

```powershell
.\runtime\python\python.exe -B build-portable.py --output ..\CrateAtlas-v0.5.0-Windows-x64 --node .\runtime\node\node.exe --node-license .\runtime\node\LICENSE --ffmpeg .\runtime\ffmpeg\ffmpeg.exe --version v0.5.0 --archive-format both
```

构建前校验内置原版资源；输出目录及所选格式的压缩包必须不存在。构建两种格式需要安装 7-Zip；只生成 ZIP 可用 `--archive-format zip`。新包的 Mod 目录默认为空。本机选择保存在被 Git 忽略的 `data/game-directory.json`。

构建通过 `--version v0.5.0` 记录版本；同时生成包内 `release-files.json` 和每个压缩包的 `.sha256` 校验文件。前端依赖、预计算数据、原生程序源码散列、Node Canvas 和 FFmpeg 均在创建输出目录前检查。发布前应在新目录解压，再运行 `python -B verify-portable-install.py --root <解压后的工具目录>`：测试只用包内运行环境，临时生成的分析／视频结果留在这个验收目录，不进入待发布包。

重建官方目录（仅开发时需要 Windows 及原版游戏安装，日常使用无需游戏目录）：

```powershell
.\runtime\python\python.exe -B build-map-catalog.py --game "D:\Games\Red Alert II"
```

构建脚本从 `MULTI.MIX`、`multimd.mix`、官方 PKT 与语言包 CSF 生成 `official-maps`；地图原始字节不改写，目录记录来源哈希、合并依据和未收录项。

## 区域统计

分析地图后点击工具栏的「区域统计」。默认提供 12 个空区域，默认工具为宽高 2:1 的椭圆笔刷，贴合游戏投影比例。进入时关闭概率图层和倍率，右侧「概率:开／关／混合」按钮可同时控制两项，原复选框同步；混合状态点击会同时开启。可修改区域名称、颜色，也可新增、清空或删除区域。新增区域按感知色差选择与已有颜色尽量不同的颜色；旧列表首次升级时保留原有划分并补齐空区域，之后手动删除不会在刷新时被补回。

- 矩形框选按屏幕方向；平行四边形框选沿游戏 X / Y 坐标。左键拖动预览，松手确认，按格子中心选取。
- 矩形、平行四边形、圆形和椭圆笔刷支持调整大小；「取消选择」仅擦除当前区域。右键或 Alt + 左键拖动平移，滚轮缩放，Esc 取消当前笔画。
- 「取色」工具或 Ctrl + 左键点击格子，可切换到其所属区域，成功后恢复最近使用的非取色工具；未划分格会选中「空」，拖动不触发取色。重叠时优先保留当前区域，否则取最上层区域。按住 Shift 临时反转「选择／取消选择」，松开恢复，笔刷预览和工具栏会提示实际操作；支持笔画途中按下或松开。
- 「允许区域重叠」默认关闭。关闭时涂入新区域会移除原归属；从重叠切回不重叠时，优先保留当前区域，其余按创建顺序。撤销支持最近 20 步及 Ctrl+Z，重做支持 Ctrl+Y / Ctrl+Shift+Z；新编辑会清除重做分支。
- 区域色块默认透明度 50%，可在工具栏调节并随划分保存；0% 不透明，100% 全透明，轮廓保留。只允许加入运行时可用边界内且至少部分位于镜头可视范围内的格子，上方禁区和镜头范围外不可选；恢复已有划分或备份时也排除这些格子。普通零概率格仍可选。
- 列表分别显示陆地箱子、海洋箱子与综合的总倍率、面积平均倍率，可按任一指标升降序排序。平均值包含所选零概率格，分母分别为本类格数；无该类格子显示 `—`。所有统计沿用本图的统一 1× 基准，不受概率显示筛选影响；选中的普通零概率格计入面积，地图外虚空及不可选择的禁区不计。
- 每行包含选区最小投影包围范围内的地形裁图与全图位置标记，可点击定位。区域着色贴合可见地形，概率数字保持在上层；开启区域模式导出地图时也包含区域着色。
- 「玩家位置」默认开启，以圆形数字标记地图出生点 1–8（路径点 0–7）。主地图、小地图、区域裁图／位置缩略图和地图导出同步开关；编号不表示实际玩家阵营或当前单位位置。已知单人地图不把这些路径点画成出生点。

划分按原地图文件 SHA-256 自动保存到当前浏览器的网站存储，同图重新分析或切换资源版本后沿用划分，统计随分析结果更新。不同地图不会串用。更换浏览器、地址 / 端口或清除网站数据前，可「导出划分」并在同一地图「恢复备份」。损坏记录及跨标签页冲突会显示提示，不静默覆盖。目录资源和未知物体地图可用近似概率进行区域统计，结果明确标注不保证准确；旧的仅预览报告需先点击“按重抽假设计算概率”。

开发验证：`node verify-regions.cjs output/<分析目录>/result.json`，覆盖形状选取、快速连续笔刷、重叠归属、持久化校验、零概率格平均、精确排序与实际地图概率守恒。

## 文件说明

| 路径 | 用途 |
| --- | --- |
| `maps.html`、`realmap-ui.js`、`map-renderer.js` | 真实地图界面与概率叠加 |
| `map-details.js`、`map-exports.js` | 地图详情、告警和下载 |
| `realmap_format.py`、`realmap_resources.py`、`realmap_parser.py`、`realmap_sprites.py` | 地图格式、资源、静态格子与贴图解码 |
| `region-statistics.js`、`region-statistics-ui.js`、`region-statistics.css` | 区域选择、精确统计、缩略图与自动保存 |
| `realmap*.py`、`original_resources.py` | 解码、精确计算、素材加载与对象渲染 |
| `index.html`、`model.js`、`probability.js`、`scene.js` | 概率机制演示 |
| `cliff-demo.html`、`cliff-demo.js`、`examples/cliff-demo.json` | 高差机制演示，复用 `terrain3d.js` |
| `server.py` | 仅监听本机的服务与导出接口 |
| `output/realmap-tools` | 必需的预编译搜索／体素桥接程序，包含对应源码；不是分析结果 |
| `runtime/voxel` | 体素渲染组件、来源记录及上游说明 |
| `resource_context`、`realmap_mod.py` | 通用目录资源发现和只读规则解析 |
| `examples` | 两种原版版本的冰天雪地示例 |
| `official-maps`、`official_maps.py`、`official-maps-ui.js` | 内置官方原图、目录、版本合并与搜索选择界面 |
| `docs/random-crate-generation.md` | 机制研究依据 |

更多资料：[使用与迁移](PORTABLE.md) · [真实地图范围](REAL-MAPS.md) · [绘图实现](RENDERING.md) · [第三方组件与素材说明](third-party-notices.zh-CN.md)。原版与 Mod 素材、第三方组件保留各自权利和许可证。

工程模块边界、缓存与任务生命周期见 [工程结构](ARCHITECTURE.md)。

## 官方地图预计算与无损存储

完整版新增作战／小队联盟的内置预计算：131 个菜单条目，含矿石／树木开关共 294 套选择，按原文件与版本去重后为 278 份。地图内容、游戏版本、规则／art／地形和计算模型一致时复用精确概率、转移来源顺序和禁行标记；高清绘制和精细 3D 仍使用当前本地资源。数据缺失、损坏或不兼容时自动现场计算，Mod 目录分析仍走现场计算。

已完成的官方地图画面另有经过校验的本地磁盘缓存，反复选图时可直接复用。点击「重新计算」可绕过两层缓存，使用当前资源计算，并保留视角和已保存区域。状态栏会区分「官方预计算」与「本地缓存」。这些功能已包含在 v0.5.0 中。

重建命令：`run-python.cmd -B build-official-precomputed.py --output official-precomputed-new --jobs 3`。验证：`run-python.cmd -B verify-official-precomputed.py --data official-precomputed-new --render`。验证后停服替换数据目录；构建器不会覆盖已有目录。便携包只收录清单中校验通过的原版计算数据，不打包个人区域、生成画面或 Mod 数据。

当前构建使用 XZ 无损压缩内置概率、gzip 保存新生成的分析结果，并以逐像素无损 WebP 保存底图；相同图层共用图片，空闲时进一步压缩。现有结果链接和旧 PNG／JSON 报告保持兼容，概率精度及素材分辨率不变。便携构建默认生成 ZIP 和更小的 7z 两种完整包，详见[存储与打包说明](PORTABLE.md)。
