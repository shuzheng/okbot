# 连接器：美团跑腿（Meituan Paotui）

- **类型**：Skill / ClawHub（首版无公开 MCP endpoint）
- **包名**：`@meituan-tech/mt-paotui-for-client`
- **ClawHub**：https://clawhub.ai/meituan-tech/skills/mt-paotui-for-client

助手 `meituan-errand` 通过本连接器声明渠道依赖；实际 skill 安装 / 鉴权由宿主技能系统完成。

若美团后续开放 MCP，在本目录 `manifest.json` 升级 `type` 与 `endpointTemplate` 即可，无需改助手 id。
