# 统一发布仓库独立验收计划

QA 在独立 clone 的 `qa-publishing` 分支工作，仅维护 `tests/integration/` 和 `docs/qa/`。当前仅完成脚本准备及 Python/Node 语法检查；后端、前端最终代码合并并重新构建后才正式运行。

```bash
python3 tests/integration/verify_publishing.py \
  --built-artifact /主控交付的最终整站产物 \
  --output /tmp/web-publish-qa-results
```

默认使用本机 Chrome 和只读引用的 `/tmp/ganzhili-reference-tools/node_modules/playwright`，可以通过 `--chrome`、`--playwright-path` 覆盖。脚本不需要 GitHub 凭据，不复制原始资料、archive 或私有项目源码到公共仓库。

## 多站工具

脚本只把公共工具和 portal 复制到临时目录，生成两个无真实资料的 HTML/CSS 测试站，调用真实 `tools/import_site.py`、`tools/build_site.py` CLI。

- 导入 alpha、beta，再更新 beta；比较 alpha 全部文件原字节、旧 release manifest 和登记元数据，检查其他文件均未变化。
- 检查 registry 两项完整且 path 固定；beta 新发布保留前一 release ID。
- 篡改 manifest 哈希、重复 JSON 键、逃逸路径；增加未登记文件、改变实际字节；均应拒绝且不产生发布目录。
- 导入带 archive 原文或符号链接的非法产物；应拒绝，完整临时仓库保持原样。
- 正式组装应同时保留两个站及根 portal/registry，仅包含公开静态文件，不混入 tools、tests、docs、releases 或历史。

## 最终产物与浏览器

- 对主控交付的实际整站产物生成路径/字节数/SHA-256 清单，排除 archive、Git、源代码、存储历史、写入回执、凭据及环境文件。
- Since 完整投影和摘要仅含两个明确 `is_demo:true` 示例，原稿哈希匹配；不新增真实私人主题。
- 用普通 HTTP 将产物挂载 `/web-publish/`，没有后端或 SPA 兜底。检查根 portal 所有登记链接、实际点击进入 `/web-publish/since/`、两条主题 hash 直接打开及刷新。
- 逐节点切换并比较来源原句和固定归档链接，完整原稿覆盖全部六条来源卡。
- 1440×1000、390×844 检查入口、主题卡、标签弹层、分支局部横滚、原稿引用；实际等待字体和图标解码成功。
- 记录全部请求和响应。只允许指定发布根内请求，禁止 API、私仓/外网请求、Authorization/Cookie；持续观察超过旧轮询周期。

## 线上复验

主控启用 Pages 后，同一命令增加 `--public-url https://yehyehSideLab.github.io/web-publish/`，浏览器针对真实 HTTPS 站点另存 `online-*` 截图及请求日志。QA 另外读取真实站点页面确认上线地址与响应，不能只凭本地通过或 CI 绿色宣布上线。

若 Pages 尚未启用、返回错误或传播未完成，必须明确写“尚未上线/线上待验”，不能用本地截图替代。此脚本不启用 Pages、不推送 main、不改变仓库可见性。原有 8765 预览服务不会被修改或停止。
