# 统一发布仓库验收（2026-11-01）

离线结论：**通过，当前范围无阻断问题**。27 项集成断言 + 52 项浏览器断言，共 79 项全部通过。31 个发布文件，106 次浏览器请求全部 HTTP 200，零 API/外网/凭据请求、网络失败或脚本错误。真实 Pages 线上复验待发布完成后另行记录，不能以本报告的本地结果宣称已经上线。

## 验收版本与范围

- 实现/部署源码：`cc874a49e9ca4194266255b600a54d49f9aa197f`，前端 `01171c7`、后端 `61254b4`。
- 主控交付整站产物：`/tmp/web-publish-first-release-20261101`，31 个文件。
- 已批准 Since 静态参考包：`/tmp/since-public-release-20261101`，26 个文件；正式断言逐文件原字节相同，包括两个示例与展示标签。
- Since release ID：`8a87625e41148a8d8a3aa3a7d036f02f3c1a97c56357f70096dbc8d8fb14eafb`。
- QA 独立 clone、`qa-publishing` 分支；执行版本 `ad92cac`。Chrome `156.0.8078.74`，桌面 1440×1000、小屏 390×844。

测试只在隔离临时仓库中调用真实 CLI，不更改实际网站、登记或 manifest；只复制公共 tools/portal，测试站仅含临时 HTML/CSS，没有原始资料。浏览器通过普通 HTTP `/web-publish/` 访问，无后端或 SPA 路由兜底；结束清理所有 QA 临时服务，未触碰 8765。

## 已独立验证

1. 依次导入 alpha、beta，再更新 beta。alpha 所有文件原字节、旧发布清单、登记元数据保持不变；其他路径无变化；登记保留两站，beta 指向前一 release ID。
2. 错误哈希、重复 JSON 键、逃逸路径的 manifest，以及未登记文件/实际文件漂移均拒绝构建，不留下发布目录。带 archive 原文或符号链接的导入均拒绝，完整临时仓库保持原样。
3. 整站组装保留旧站和更新站及根入口；产物排除 tools、tests、docs、releases、Git、archive、项目源码、环境文件、私有修订历史和写入回执。实际公共仓库只登记静态站点与通用发布路径。
4. Since 完整投影和摘要恰好两个 `is_demo:true` 示例；原稿 SHA-256 正确，整个目录与批准参考包一致。
5. 根入口所有登记链接正确，实际点击进入 `/web-publish/since/`；两个主题 hash 各自直接打开并刷新。逐节点切换来源原句和固定版本链接，完整原稿核对全部六条来源卡。
6. 实际等待字体加载和图片解码；桌面/390 根入口、主题卡、标签弹层、原稿引用正常，局部横滚能到达其他分支，无文档级横向溢出。
7. 全请求日志共 106 次请求，全部 200，未访问 API、私仓或外部资源；未发送 Authorization/Cookie，超过旧轮询周期持续观察后仍无错误。

## 证据

| 内容 | 文件 |
| --- | --- |
| 27 项集成断言、31 文件大小与 SHA-256 | [publishing-results.json](evidence/publishing-offline/publishing-results.json) |
| 52 项浏览器断言、106 请求/响应 | [local-browser-results.json](evidence/publishing-offline/local-browser-results.json) |
| 入口 | [桌面](evidence/publishing-offline/local-portal-desktop.png) · [390](evidence/publishing-offline/local-portal-mobile.png) |
| Since 关注 | [桌面](evidence/publishing-offline/local-since-desktop.png) · [390](evidence/publishing-offline/local-since-mobile.png) |
| 两主题与来源 | [智能体](evidence/publishing-offline/local-example-agent-work.png) · [信息流](evidence/publishing-offline/local-example-information-feed.png) |
| 小屏原稿/来源 | [截图](evidence/publishing-offline/local-since-detail-mobile.png) |

命令与工具边界见 [计划](publishing-plan.md)。当前没有超出本轮范围的实现承诺：浏览器为静态只读，标签仍是筛选；跨仓库导入由已认证调用方完成，不是浏览器自动同步。小屏脉络局部横滚提示仍较弱，但已验证可操作。
