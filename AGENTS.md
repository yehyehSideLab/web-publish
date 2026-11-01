# 统一公开网站发布仓库

- 本仓库只保存明确获准公开的站点产物、公共构建工具、网站登记与说明；原始资料和私有项目源码在各项目维护。
- 用户已授权在 yehyehSideLab/web-publish 创建统一公开发布仓库。首站 Since 只公开两个示例与展示所需标签。
- 每个网站目录为 sites/<id>/，公开地址为 /web-publish/<id>/。根入口由 portal/ 提供，sites.json 保存登记，releases/<id>.json 保存公开产物清单。
- sites.json 契约：{ "version": 1, "sites": [{ "id": "since", "title": "判断力", "description": "主题、脉络与来源", "path": "since/" }] }。path 固定等于 id + '/'，不得填写远端或上级路径；id 为小写英文字母/数字/连字符，首字符字母，1–48 字符。
- 页面资产使用相对路径。普通静态HTTP、根入口与站点子路径均须可用，不运行后端或把凭据放浏览器。
- 主控负责范围、共享登记契约、GitHub配置、评审合并与最终上线。各角色独立分支提交，不直接修改 main。
- 本轮后端分支负责 tools/**、tests/unit/**，实现导入单站和组装整站，不改 portal/ 或 workflow。
- 前端分支负责 portal/**，按 sites.json 渲染简洁网站入口，不改站点内容或登记契约。
- QA 分支负责 tests/integration/**、docs/qa/**，独立验收局部更新不丢其他站点、子路径和真实上线访问。
- 根 README、AGENTS、.gitignore、.github/workflows/ 以及部署目标配置由主控维护。跨范围依赖先沟通。
- 不读取或复制浏览器凭据；Git认证留给已有 gh/git 环境。跨仓库更新目前由已认证的调用方提交，不宣称 GITHUB_TOKEN 可自动写另一仓库。
- 后续新站点须先确认公开内容，按单独目录导入；更新某站时保留其他站点。删除/下线通过明确登记及代码评审执行，不隐式覆盖整仓库。
