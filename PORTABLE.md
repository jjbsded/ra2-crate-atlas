# 跨电脑使用

便携包适用于 Windows 10 / 11 64 位。完整解压到有写入权限的文件夹，双击 `启动工具.cmd`，默认进入真实地图概率计算，选择地图版本并读入地图，或直接点击“分析冰天雪地”。页面顶部的醒目大按钮可随时切换到概率演示。

红警 2 1.006 和尤里的复仇 1.001 的规则、地形、建筑和单位资源已内置，不需要安装游戏、选择 MIX、配置游戏目录或联网下载。包内含 Python、解码依赖、搜索程序、体素渲染组件、Node.js、Canvas 和 FFmpeg。

“游戏目录（可选）”用于读取已安装游戏或 Mod 的本地资源。目录输入并保存后自动切到目录预览；不保存具体 Mod 的配置或素材。清除目录不影响内置原版与尤复资源。当前发布代码的目录模式仅外观预览，未验证扩展放箱规则。

新构建包的 Mod 目录默认为空，不携带构建电脑的绝对路径；已有安装保存过的目录会保留。

保存位置：

- `assets/original`：内置原版资源，按固定 SHA-256 校验。移动工具时须一起保留。
- 游戏目录设置只保存 data/game-directory.json 中的路径，不提交或打包。规则、art、散装资源、数字扩展和标准嵌套 MIX 均从所选目录实时发现；同名文件取首份，显式 include 单独展开，无法确认的加载行为保留告警。
- `output`：分析结果、底图和导出文件；已有结果可直接查看。
- `runtime`：随包运行环境与体素组件，不要单独移走。

旧版 `data/resources` 中手动导入的 MIX 不再参与默认加载。命令行仍可用 `--ra2-mix`、`--yr-mix` 显式指定研究用资源。

保持启动窗口打开。端口被占用时可运行 `启动工具.cmd --port 8777`。不要在 ZIP 内直接运行，先完整解压。工具不写注册表，也不修改游戏文件。

## 源码方式

需要 Python 3.11+，执行 `python -m pip install -r requirements.txt`，并保留内置资源目录。完整包带有 `output/realmap-tools/map-search.exe` 和源码散列；修改搜索源码后可通过 `CRATE_CC` 指定 GCC 重编译。

车辆、飞机与体素炮塔通过 `voxel-worker.cs` / `output/realmap-tools/voxel-worker.exe` 在隐藏的 x86 进程里调用 `runtime/voxel/CncVxlRenderText.dll`，不需要安装或运行地图编辑器。首次源码运行可由 Windows .NET Framework 编译桥接程序；便携包已有预编译版本。自定义组件路径可用 `CRATE_VOXEL_DLL` 覆盖。

视频导出可用 `CODEX_NODE_MODULES`、`FFMPEG_PATH` 指定依赖；默认优先用随包 runtime。第三方组件说明见 `runtime/THIRD-PARTY-NOTICES.md`。

直接访问本地服务根地址也进入真实地图页。需要直接打开概率演示时，访问 `index.html` 或启动时使用 `--page demo`。
