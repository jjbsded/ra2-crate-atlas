# 地图中的部署外观（render 19）

与纹理、光照、阴影一起移植时请使用 [统一渲染移植说明](rendering-porting-guide.md)，包括存档实际部署标志与地图任务的区分。

完整版与唯一 Toy 版按导入地图的对象任务字段自动显示部署后的静态美术，不需要手动开关。

| 对象 | 地图类型 / 美术 | `Unload` 使用的外观 |
| --- | --- | --- |
| 美国大兵 | E1 / GI | GISequence.Deployed：292,1,1 |
| 重装大兵 | GGI | GuardianGISequence.Deployed：315,1,1 |
| 辐射工兵 | DESO | DesoSequence.Deployed：298,1,0；所有朝向均为第 298 帧 |
| 武装直升机 | SCHP | UnloadingClass=SCHD：schd.vxl 主体与 schdtur.vxl 炮塔 |

`[Infantry]` 和 `[Units]` 对象的第 7 个逗号字段（从 1 开始）是任务。大小写和首尾空白不影响 `Unload` 识别；其他任务保持普通外观。步兵按地图方向选择 Deployed 序列帧，武装直升机保留地图方向，使用 SCHD 自身的美术设置，包括默认 ShadowIndex=0；普通 SCHP 仍使用 ShadowIndex=2。两种直升机外观均保留原有 ConsideredAircraft 阴影缩放，以及 render 18 的原生 VPL 光照和地图调色板光照。

地图保存的是任务命令，并非游戏运行时部署标志。本工具把上述对象的 `Unload` 作为“显示完成部署姿态”的静态约定，不执行着陆、旋转至 DeployDir、过渡动画、开火、辐射或后续脚本。保存为其他任务而只在游戏运行后部署的对象，无法从初始地图记录推断其后续状态。

## 供其他工具接入

- `realmap_objects.py` 的 `deployed_voxel_type` / `deployment_mission` 负责识别，`ObjectPainter.parts` 选择步兵序列或替换直升机显示模型。保留原始对象的类型、阵营、位置、健康值和朝向；不要把 SCHP 改写为 SCHD 再做占用或概率计算。
- `UnloadingClass` 还用于运输单位和 SCHD 的反向状态，因此不要将所有带此字段的对象一律替换。本次限制为 `[Units]`、`Image=SCHP`（包括同美术别名）、`IsSimpleDeployer=yes`。非原版 Mod 美术仍需外部资源支持。
- `toy_live_materials.py` 和 `toy-live/parser.js` 的对象签名必须保留该直升机的 `UNLOAD` 状态，并包括 `ISSIMPLEDEPLOYER` / `UNLOADINGCLASS`，防止普通与部署模型共用错误缓存。`toy_live_objects.py` 导出两个状态的全朝向素材；像素、调色板和阴影继续去重，无需在 Toy 中打包体素运行库。
- 完整版渲染版本升至 19，让已有导入地图重新绘制。Toy 发布时更新对象库、签名、脚本版本和素材指纹。当前 147 个内置地图版本没有 `Unload` 对象，经过源码变化和地图记录核验后复用原无损图集；新导入地图使用新的部署素材。

验证入口：`verify-deployed-art.py` 检查原版各气候、朝向、模型和阴影；`verify-toy-live-objects.py --root <Toy目录>` 比较完整版与 Toy 的像素、阵营色、锚点和阴影。部署展示不改变地图文件、占用计算或箱子概率。

游戏模型选择的参考：[原引擎简单部署路径研究](https://github.com/YuriPlanet/vera20k/blob/main/tools/spatial_oracle/unit_simple_deploy.md)。帧序列和资源名称取自本机已校验的原版 rules/art/MIX。
