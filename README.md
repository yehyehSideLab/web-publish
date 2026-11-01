# Web Publish

公开网站的统一发布仓库。每个网站有自己的目录和地址；源码和原始数据在各自项目维护，这里接收已确认可公开的静态产物。

网站入口：<https://yehyehsidelab.github.io/web-publish/>

Since / 判断力：<https://yehyehsidelab.github.io/web-publish/since/>

首次上线以 [Publish Websites 工作流](https://github.com/yehyehSideLab/web-publish/actions/workflows/pages.yml) 的实际部署结果为准。

## 目录

| 位置 | 用途 |
| --- | --- |
| `portal/` | 统一网站入口，读取登记后生成卡片 |
| `sites.json` | 网站 ID、名称、简介和路径 |
| `sites/<id>/` | 各网站可直接托管的静态文件 |
| `releases/<id>.json` | 文件清单、大小、SHA-256 和当前/上一产物版本 |
| `tools/` | 单站导入及整站构建 |
| `tests/`、`docs/qa/` | 工具测试和独立验收证据 |
| `.github/workflows/pages.yml` | 校验、构建和 Pages 发布 |

首站 Since 仅含两个示例和展示所需标签。后续网站从各自项目构建，明确公开范围后再导入。本仓库适用于静态网页及前端应用，服务端程序另行部署。

## 新增或更新网站

Python 3.9+，仅使用标准库。先取得最新主线，在原项目构建一个新产物目录；以下用 `your-site` 表示要发布的网站 ID：

```bash
python3 tools/import_site.py \
  --repo-root . \
  --site-id your-site \
  --artifact /绝对路径/已构建的静态网站 \
  --title 网站名称 \
  --description 网站简介
```

导入仅更新这个网站、对应登记项及发布清单，保留其他网站。产物目录必须在发布仓库之外，入口为 `index.html`，资源使用相对路径；ID 为小写字母开头的 1–48 位小写字母、数字或连字符。相同内容保留同一产物版本。

先检查变更和本地构建，再提交：

```bash
python3 -m unittest discover -s tests/unit
python3 tools/build_site.py --repo-root . --output /tmp/web-publish-preview
python3 -m http.server 8080 --directory /tmp/web-publish-preview
```

构建输出必须是新目录，不覆盖已有预览。页面入口和各站点均应在子路径下可用。确认后只提交本次站点相关内容：

```bash
git diff --stat
git add sites/your-site releases/your-site.json sites.json
git commit -m "Publish your-site"
git push origin main
```

推送 main 会自动校验所有登记站点的文件哈希、组装并发布。网站地址为 `https://yehyehsidelab.github.io/web-publish/<id>/`。发布状态以 Actions 成功及实际网页读回为准；文件导入成功不等于网页已更新。若推送遇到新提交，先更新主线并保留其他站点，不强推覆盖。

跨私有源码仓库的产物传输由已认证的维护者或 Agent 完成，发布工具不保存凭据，也不自动读取其他私有仓库。原项目提交后仍需构建、导入并提交本仓库；本仓库提交后的 Pages 部署已经自动化。

## 单站回退与下线

回退时从历史提交恢复指定 `sites/<id>/` 与 `releases/<id>.json`，登记变化只调整该站点一项，避免回退整份 `sites.json` 而覆盖别的网站。构建通过后提交发布。下线需明确移除该站目录、发布清单和登记项，再重新构建；不会因为更新其他站点而隐式下线。

发布清单用于检查产物完整性；它不是身份签名，也不能代替对公开内容的确认。
