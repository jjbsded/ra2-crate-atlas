[English](TOY.en.md) | **简体中文**

# Toy

Toy 只维护一个版本：官方地图预计算查看与自定义地图浏览器本地计算合在同一个包中。原“普通版”停止维护；原“现场计算版／实验版”统一称为 Toy。`toy-live/`、`build-toy-live.py` 和清单中的 `liveAnalysisExperiment` 是兼容现有代码／数据格式的内部名称，不代表另一个产品。

## 使用

[下载 v0.6.0 Toy ZIP](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.6.0/CrateAtlas-v0.6.0-Toy-Web.zip) · [发布说明与校验文件](https://github.com/jjbsded/ra2-crate-atlas/releases/tag/v0.6.0)。

工作区双击 `D:/Ra2/Work/启动箱子Toy.cmd`；源码目录的 `启动Toy网页版.cmd` 指向同一个最新包。解压发布 ZIP 后双击 `Start Toy.cmd`，使用 Windows 自带 PowerShell/.NET 启动本地静态服务，不依赖 Python、Node.js 或游戏安装。保留整个解压目录；也可以把 ZIP 部署到 Toy 或普通 HTTPS 静态站点。不要直接双击 HTML。

最新包由 `output/latest-release.json` 的 `toy` 字段指定。旧包仅作历史存档，不再提供独立启动入口或更新。

- 官方作战／小队联盟地图共 131 个菜单项、147 个版本变体、294 份矿石／树木布局报告，保留精确概率数据。
- 自定义 `.map`／`.yrm`／`.mpr` 最大 16 MB，选择正确的 RA2/YR 版本。浏览器后台计算，不上传文件，支持取消；切换矿石／树木布局后缓存结果。
- 主图、小地图、区域、来源、3D 和导出共用当前布局；区域按地图内容保存在浏览器中。刷新后重新选择自定义地图恢复区域。
- 官方地图使用原生分辨率无损图集。自定义地图优先复用包内素材，缺失的地形、朝向、损伤状态采用简绘，并报告缺失项。保留 VPL 法线照明、最终亮度与所属色修复。
- 默认关闭格线和占用体积；“放箱后禁行格”同时控制清空后的潜在禁行格。“显示 1× 图层”独立于标签，受概率图层总开关控制。
- 浏览器按 CSS 尺寸与 DPR 绘制；跨 DPI 屏幕时自动重建画布，放大采用最近邻，缩小总览需采样。原图无有损压缩，不承诺缩小总览逐像素对应游戏。

仅支持原版资源及简单地图内规则覆盖，不运行触发、脚本、动态单位、矿石生长或 Mod DLL。未知对象等会给出近似结果告警；近似结果不验证放箱后的禁行风险。照明是静态近似，不模拟所有局部灯光、天气或动态部件。需要 Worker、BigInt、Web Crypto、gzip 解压；3D 需要 WebGL。

## 构建与检查

最终发布只运行第三阶段；前两阶段是共享的数据／贴图构建步骤，不生成发布 ZIP 或 `.cmd` 启动入口。修改概率或绘图源码后必须重建对应缓存，禁止修改指纹冒充已重建。

```powershell
.\run-python.cmd -B build-toy.py --output output/toy-build/base --mode standard --mode teamgame --jobs 3
.\run-python.cmd -B build-toy-original.py --source output/toy-build/base --output output/toy-build/artwork --jobs 3
.\run-python.cmd -B build-toy-live.py --source output/toy-build/artwork --output output/toy
.\run-python.cmd -B verify-toy.py output/toy --mode standard --mode teamgame
```

构建器检查 ZIP 不超过 **50,000,000 字节**。构建在新目录完成、验证后才更新最新入口。只改前端时可对内部贴图目录使用 `build-toy.py --refresh-ui --output ...`，然后重新生成最终 Toy；不得直接刷新最终包以丢失本地分析适配。

机制依据见 [研究文档](docs/random-crate-generation.md)，纹理、光照、阴影及部署状态复用见 [统一接入文档](docs/rendering-porting-guide.md)，逐项复查见 [七项要求验收](docs/review-seven-requirements-20261103.md)。
