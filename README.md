# Crate Atlas · 红警 2 / 尤里的复仇工具箱概率工具

真实地图概率计算与交互式机制演示，支持 Windows 10 / 11 64 位。本项目在本机运行，无需启动游戏。

## 直接使用

目前没有可下载的便携发布包。v0.1.0 因包含固定 Mod 资源配置已撤回；后续发布包只允许内置经过校验的原版资源，不携带任何具体 Mod 配置或美术素材。

“Code → Download ZIP”仅提供源码和小型组件。可按下方说明配置本地依赖后运行，或直接打开 index.html 使用概率演示。

## 功能

- 解码原始地形、高度、覆盖物和地图初始建筑／单位，占用判定独立于图像。
- 按原版静态模型计算下一次放箱的精确概率，最终概率显示两位有效数字，普通格以 1× 为基准。
- 标记当前放箱后禁行格，以及完全移除建筑、矿物、树木和单位后可能新增的禁行格。
- 显示建筑、步兵、车辆和飞机，支持阵营色与静态朝向；概率倍数保持在图像上方。
- 可拖动、最小化和关闭的小地图；导出当前画面 PNG 和完整地图高清 JPEG。
- 大尺寸金色／青蓝色按钮切换真实地图计算与概率演示，演示支持逐步播放和 MP4 导出。
- 游戏目录为可选项，目前可加载目录资源 的外观；Mod 概率模型尚未启用。

概率针对地图初始静态状态，不模拟正在运行的游戏、脚本执行或所有 Mod 扩展。具体范围见 [真实地图说明](REAL-MAPS.md)。

## 源码与开发

Git 保存核心源码、示例地图、机制文档、纯逻辑验证脚本和必要的小型本地组件。大型资源与完整运行环境不进入 Git；分析结果、截图、视频、缓存、旧版导入 MIX、本机 Mod 目录均不提交。

```powershell
gh repo clone jjbsded/ra2-crate-atlas
cd ra2-crate-atlas
```

开发时使用 Python 3.11+ 并安装 requirements.txt；将自己安装的原版 ra2.mix 和 ra2md.mix 放入 assets/original（程序会校验哈希），或使用自己已准备好的本地运行环境。以下为配置了内嵌 Python 的启动示例：

```powershell
.\runtime\python\python.exe -B server.py --open
```

默认端口为 8767；可追加 `--port 8777`。用 `--page demo` 直接进入演示。手动配置开发环境可用 Python 3.11+ 及 `requirements.txt`；视频导出另外需要 Node.js、`@napi-rs/canvas` 和 FFmpeg。

不依赖地图分析输出的逻辑检查：

```powershell
.\runtime\node\node.exe verify-exact.cjs
.\runtime\node\node.exe verify-random-frame.cjs
.\runtime\node\node.exe verify-timing.cjs
.\runtime\node\node.exe verify-ui-enhancements.cjs
```

重新构建完整便携包：

```powershell
.\runtime\python\python.exe -B build-portable.py --output ..\CrateAtlas-Windows-x64 --node .\runtime\node\node.exe --node-license .\runtime\node\LICENSE --ffmpeg .\runtime\ffmpeg\ffmpeg.exe
```

构建前校验内置原版资源；输出目录必须不存在。新包的 Mod 目录默认为空。本机选择保存在被 Git 忽略的 `data/game-directory.json`。

## 文件说明

| 路径 | 用途 |
| --- | --- |
| `maps.html`、`realmap-ui.js`、`map-renderer.js` | 真实地图界面与概率叠加 |
| `realmap*.py`、`original_resources.py` | 解码、精确计算、素材加载与对象渲染 |
| `index.html`、`model.js`、`probability.js`、`scene.js` | 概率机制演示 |
| `server.py` | 仅监听本机的服务与导出接口 |
| `output/realmap-tools` | 必需的预编译搜索／体素桥接程序，包含对应源码；不是分析结果 |
| `runtime/voxel` | 体素渲染组件、来源记录及上游说明 |
| `resource_context`、`realmap_mod.py` | 通用目录资源发现与只读预览；不附带任何 Mod 配置或素材 |
| `examples` | 两种原版版本的冰天雪地示例 |
| `docs/random-crate-generation.md` | 机制研究依据 |

更多资料：[使用与迁移](PORTABLE.md) · [真实地图范围](REAL-MAPS.md) · [绘图实现](RENDERING.md) · [第三方组件与素材说明](third-party-notices.md)。原版与 Mod 素材、第三方组件保留各自权利和许可证。

## 发布包资源清理

v0.1.0 已撤回：包含一份固定 Mod 资源配置。清理后的代码不附带具体 Mod 的配置或美术资源。Git 历史已重新建立；旧克隆请以清理后的 main 为准，避免重新合入旧历史。便携包后续另行发布。
