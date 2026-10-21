[English](third-party-notices.md) | **简体中文**

# 随包第三方组件与素材

便携包保留 Python 的 `LICENSE.txt`、各 Python 包 `*.dist-info` 下的许可证，并包含应用和 C 扫描器源码。原版游戏档案来自本机原版安装，复制到 `assets/original` 前按固定 SHA-256 校验。

| 组件 | 许可与来源 |
| --- | --- |
| Python 3.12 | Python Software Foundation 许可；https://www.python.org/ |
| Pillow 12.3.0 | 许可位于 `pillow-12.3.0.dist-info`；https://python-pillow.org/ |
| NumPy 2.3.5 及数值库 | 许可位于 `numpy-2.3.5.dist-info` 和 `numpy`；https://numpy.org/ |
| ra2mix 1.0.4 | GPLv3，包含完整源码和 LICENSE；https://github.com/endless-creation/ra2mix |
| blowfish 0.6.1 | 包含源码及发行许可；https://pypi.org/project/blowfish/ |
| lzokay 2.1.0 | 包含发行许可；https://pypi.org/project/lzokay/ |
| Node.js 24.19.0 | 对应版本完整许可位于 `runtime/node/LICENSE`；https://nodejs.org/ |
| @napi-rs/canvas 及 Windows x64 原生模块 | 保留包内许可；https://github.com/Brooooooklyn/canvas |
| Three.js 0.160.0 | MIT，离线文件 `lib/three-r160.min.js`，完整许可 `lib/three-LICENSE.txt`；https://github.com/mrdoob/three.js/tree/r160 |
| FFmpeg | 本地安装的 GPLv3 构建；完整许可 `runtime/ffmpeg/COPYING.GPLv3`，版本及配置 `runtime/ffmpeg/build-version.txt`；https://ffmpeg.org/ 和 https://www.gyan.dev/ffmpeg/builds/ |

原版美术、示例地图和游戏数据保留各权利人的权利。本工具包不转让这些权利。`examples/cliff-demo.json` 包含一小块原版尤复雪地和贴图，用于离线高差演示；记录原地图哈希，不含 Mod 素材或配置。

`official-maps` 保留原版 `MULTI.MIX` 和 `multimd.mix` 中的 248 份官方多人地图，原始字节不改写。目录名称和模式登记来自官方 PKT、CSF；繁体中文名称转换为简体显示，英文界面名称为展示译名。`official-maps/catalog.json` 记录档案、登记表、字符串表、各地图的 SHA-256 及未收录登记项。

`resource_context/ra2map.py` 和 `resource_context/ra2mod.py` 源自本机 ra2yr-map v0.9 的只读解析工具，保留原文件头。对象绘制参考 FA2SPHE 的帧和锚点惯例，不内嵌编辑器可执行程序。`runtime/voxel` 包含现有 `CncVxlRenderText.dll` 及 x86 Microsoft Visual C++ 运行库依赖，因此渲染无需安装编辑器。组件哈希和本地来源记录位于 `runtime/voxel/provenance.json`。该目录保留上游 FA2SPHE README 和许可证作为项目说明，不将其许可归属于独立的 Microsoft 或游戏组件。

Mod 美术只读取用户选择的可选游戏目录，不随代码或发布包提供。
