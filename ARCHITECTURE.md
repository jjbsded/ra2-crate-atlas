# 工程结构与维护边界

这是本地 Python HTTP 服务与原生 JavaScript 页面组成的工具，无前端构建步骤。启动入口、现有结果 URL、区域划分存储键保持稳定；按职责分模块，不按文件长度机械拆分。

## 分析与结果

| 模块 | 职责 |
| --- | --- |
| `server.py` | HTTP 请求、参数与来源检查、静态文件、资源设置及视频导出入口 |
| `map_jobs.py` | 地图任务提交、串行执行、进度快照、矿石布局复用；不依赖 HTTP 或 3D 渲染 |
| `map_results.py` | 结果路径、原地图哈希、共享报告缓存、规则与美术资源一致性检查 |
| `realmap.py` | 分析流程与 CLI：串联解析、近似模型、原生搜索、概率计算、绘制与报告输出 |
| `realmap_format.py` | INI、数值语法、LCW/LZO 压缩区块解码；不依赖模型或渲染 |
| `realmap_resources.py` / `realmap_mod.py` | 原版 MIX、rules/art、气候与调色盘；可选目录的资源发现与适配 |
| `realmap_parser.py` | 地图记录、对象记录、规则覆盖与静态格子属性；不启动外部程序或绘图 |
| `realmap_exact.py` / `realmap-search.c` | 精确概率与原生顺序搜索 |
| `realmap_sprites.py` | TMP / SHP 解码、调色盘、覆盖物资源定位与原始阴影帧，供 2D / 3D / 对象绘制共用 |
| `realmap_approx.py` / `realmap_bridges.py` | 未知内容假设与桥梁分层规则 |
| `realmap_render.py` / `realmap_objects.py` / `realmap_voxel.py` | 地面、建筑与单位绘制；不决定最终概率 |
| `realmap_3d.py` / `terrain_depth.py` | 从已分析结果与原始贴图构造局部 3D 场景 |
| `realmap_refresh.py` | 旧报告的显式重绘与预览升级；保留原报告的矿石状态 |
| `original_resources.py` / `resource_context/` | 内置原版校验、目录资源底层读取与来源记录 |

`map_results.py`、`map_jobs.py` 导入时只加载标准库和轻量资源入口。矿石切换、报告读取、2D 重绘均不应为了访问通用函数而导入整个 3D 渲染模块。

依赖从分析入口指向解析、资源和格式层。原生工具的检查与编译只在进入概率计算时进行，`parse_map()` 可在没有编译器的环境独立使用，也不加载 Pillow、NumPy 或概率求解器。原版与目录资源共用同一套格子解析和贴图解码。`realmap.py` 保留旧函数导入名，`realmap_objects.records` 和 `realmap_mod.preview` 保留兼容入口；新代码应导入实际负责该功能的模块。

对象绘制与 3D 不再反向导入 `realmap_render` 取共享贴图函数。报告升级编排位于 `realmap_refresh`；旧的 `realmap_render.refresh_result` 仅作延迟转发。依赖图检查包含函数体内导入，仅排除这两个明确的兼容转发入口（`realmap_mod.preview`、`realmap_render.refresh_result`）；主业务模块依赖必须无环。

任务管理器最多保留 64 条轮询记录；运行中和排队中的任务不会被清理。完成记录移出内存不删除磁盘结果。最多一个分析实际运行，前台请求可等待一个已开始的后台预加载；其他冲突请求返回忙碌提示。同一布局的进行中请求复用任务，任务状态通过锁保护的快照返回。

报告缓存按路径、文件大小和纳秒修改时间失效，最多保留两份报告及其坐标索引。消费者只读共享报告。矿石双向链接保存在结果目录的 `mineral-variants.json`；复用前检查地图、规则、资源指纹与渲染版本，链接失效不阻止重新计算。可选 Mod 路径保存在 `data/game-directory.json`，具体 Mod 配置及资源不进入发布包。

目录规则上下文另有加锁的两项 LRU 缓存。每次请求仍验证源地图、资源包指纹、规则、美术和气候哈希，并检查散装配置、嵌套 include 及尚未找到的可选文件。目录列表只在一次校验中复用；散装配置按内容哈希检查，保持原大小和修改时间的修改也能检出。返回的资源读取缓存和有效规则独立于缓存模板，贴图读取不会把不同请求的可变字典混在一起，也不会持续堆积在规则缓存中。

3D 透明边缘补齐按每条扫描线寻找左右最近的不透明像素，再比较行间距离；保留原逐像素穷举的距离计算和同距优先顺序，避免对每个采样点遍历整张贴图的所有不透明像素。随机像素与实际地图补丁均检查优化前后的输出一致。

体素辅助进程由 `VoxelRenderer` 管理；启动失败和正常结束均回收子进程、读取线程与管道，`close()` 可重复调用。

Python 与体素辅助进程的双向文本管道统一为 UTF-8，不依赖 Windows 控制台代码页；读取错误立即传回主线程，不等待超时。预编译体素程序使用规范化换行后的源码 SHA-256 校验，Git 克隆或 ZIP 解压改变文件时间不会触发无意义的重新编译。

## 浏览器端

| 模块 | 职责 |
| --- | --- |
| `realmap-ui.js` | 页面装配、视图状态、选择与控件联动 |
| `map-details.js` | 格子详情、来源说明、告警、统计摘要、风险列表与结果质量对应的控件状态 |
| `map-exports.js` | JSON / CSV / 分数序列化、下载与图片导出按钮；通过快照读取当前结果 |
| `local-api.js` | 服务错误说明、可取消的统一地图任务轮询 |
| `map-results.js` | 读取报告、并行解码图片、每个布局的来源索引；拒绝已被替代的加载结果 |
| `mineral-layouts.js` | 当前地图的双布局缓存、后台与前台请求合并 |
| `probability-display.js` | 精确分数到显示倍率、阈值与标签的唯一转换入口 |
| `map-renderer.js` / `minimap.js` / `map-image-export.js` | 主图、导航、导出共用的绘制规则 |
| `region-statistics.js` / `region-statistics-ui.js` | 区域数据与统计、编辑交互与自动保存 |
| `terrain3d.js` | 3D 生命周期、相机、交互和标记 |
| `cliff-demo.html` / `.js` / `.css` | 高差教学入口与场景切换；通过数据加载接口复用 `terrain3d.js` 的内嵌视图 |

页面先准备完整结果，再更新当前视图。新的前台加载会取消旧请求，并用版本标记拒绝晚到结果；失败保留已经显示的地图。后台准备另一布局不提交视图。切换时复用已解码图片、精确概率显示缓存和来源索引；换地图后旧缓存随引用释放。显示层直接读取 `probability-display.js` 已算好的精确分子，避免逐格重复生成大整数。

详情模块通过参数接收报告、概率显示器和定位回调，不操作主图相机或发起分析。导出序列化函数可脱离 DOM 使用，不修改原始报告；画布像素坐标和临时大整数不会写入 JSON。主控制器负责选中格、加载顺序和视图恢复。

完整地图图片在开始导出时固定数据、索引、图层设置和区域几何／颜色／透明度／裁剪范围。区域快照复用不会原地修改的 `Path2D`，与实时绘制共用同一绘制函数；之后继续编辑、换图或关闭区域模式不影响已开始的导出。

高差演示位于 `cliff-demo.html`，地图工具与概率演示页顶部均有入口，以新标签页打开。它直接读取随包分发的 `examples/cliff-demo.json`，无需分析任务、游戏目录或外部网络。数据由 `build-cliff-demo.py` 从内置尤复 `xmp32s8.map` 生成；单高格布局共用后端 `relation_data`、`land_after`，概率留空，仅说明地面属性。共享 3D 查看器默认仍请求当前地图 API，演示页注入静态数据加载器并以内嵌形式展示；选格、旋转、贴图、资源释放和放箱预览共用同一实现。

## 发布与验证

`build-portable.py` 的 `APPLICATION_MODULES` 是 Python 运行模块清单。构建开始前扫描这些文件的本地导入关系，发现未列入的依赖立即失败；拆分模块时同步维护清单。JavaScript / HTML / CSS 保持现有直接加载方式，新页面依赖须更新脚本引用与缓存版本。内置美术仍通过独立的原版资源白名单复制。

发布数据由 `DATA_FILES` 明确列出，不递归复制本机样例／配置目录。构建前还检查 HTML 引用、两种原生辅助程序的源码散列、体素 DLL 来源、Node Canvas 及 FFmpeg。包内记录版本和逐文件校验清单，ZIP 另附 SHA-256。便携 Python 不加载开发目录里的备用依赖；重新启动时通过安装目录和代码指纹核对已有服务，避免新包误打开旧版本。

`verify-source-package.py` 检查 Git 将发布的文件是否覆盖应用及测试依赖；`map_test_fixtures.py` 是可独立生成的合成地图，不依赖本机旧研究输出。`verify-portable-install.py` 面向新解压目录，清理开发环境变量后检查包内依赖、两版本地图、无矿布局、3D、四类对象和视频导出；验收会生成结果，不能把验收目录再次打包发布。

本轮结构回归入口：

- `verify-map-jobs.py`：串行任务、忙碌状态、快照隔离、失败恢复和有界历史。
- `verify-map-results.py`：报告缓存、目录上下文上限与隔离、各类来源校验、嵌套 include 修改／缺失文件补齐后的失效、导入边界。
- `verify-map-results.cjs`：并行图片解码、来源复用、旧请求失效、统一轮询与取消。
- `verify-mineral-cache.py` / `.cjs`：HTTP 缓存协议、背景任务合并、重新加载及错误恢复。
- `verify-minerals.py`：两版本与独立无矿地图的概率、2D / 3D 结果对照。
- `verify-portable.py` / `verify-release-resources.py`：模块清单完整性、现有构建保护及 Mod 资源隔离。
- `verify-voxel-lifecycle.py`：辅助进程退出、管道关闭、读取线程回收和重复关闭。
- `verify-module-boundaries.py`：含延迟导入的依赖环检查、前端模块重复定义和加载顺序、独立解析不触发编译或渲染依赖、3D / 2D 分层、旧导入兼容性。
- `verify-map-presentation.cjs`：精确／近似／预览结果切换、详情与告警、风险定位、JSON / CSV / 分数和报告不变性。
- `verify-region-workspace.cjs`：实际编辑控件及 Canvas 绘制，包括区域导出快照在继续编辑／换图之后的像素一致性。
- `verify-realmap-3d.py`：最近贴图像素与穷举算法对照、地形几何、可选真实地图和桥梁回归。
- `verify-cliff-demo.py`：孤立高格的六个非对称判定位置、Rough 变化、样例来源、贴图完整性与页面入口。

本轮已完成原计划中的解析、资源、详情与导出拆分。保持现有启动方式、结果格式和区域保存键；未迁移目录、重写概率内核或引入前端构建框架。
