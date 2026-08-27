# KeyCheck · LLM Key 可用性测试台

一个**纯前端、零后端依赖**的网页工具，用于批量测试各大 LLM 厂商 API Key 的可用性与模型列表，并把晦涩的错误码翻译成人话。支持自动探测厂商、批量解析多组凭据、模型下拉选择、连续对话，以及可选的 Cloudflare 代理来绕过浏览器跨域（CORS）限制。

> 本项目**不含任何密钥**。所有 Key 均由你在页面里自行粘贴，本地测试时仅在浏览器内存中处理。

---

## 功能

- **批量解析**：一段文本里粘贴多组「接口地址 / Key / 模型ID」，自动分块解析，URL 可继承、Key 与模型自动配对。
- **自动厂商探测**：调用 `/v1/models` 看返回结构判断是 OpenAI 兼容还是 Anthropic 原生，**不靠域名猜测**。
- **人话结果**：成功/失败/限流一律翻成中文说明，不暴露原始 JSON、状态码或链接；延迟只显示「快 / 正常 / 慢」。
- **模型下拉**：测试拉到模型列表后，模型框自动变成可下拉选择；点「对话」弹窗默认沿用所选模型。
- **连续对话**：每行「对话」按钮打开独立对话框，携带完整历史。
- **免费模型探测**（freetokenfaucet.com）：自动抓首页今日免费模型 → `/v1/models` 全量 → 逐个 `max_tokens:1` 探活并读剩余额度，无需登录。
- **暗/亮色**：默认暗色，记忆到 localStorage。
- **CORS 方案四选一（可折叠）**：A 浏览器扩展 / B 带参启动 / C 公共代理 / D 本地或云端代理（Cloudflare Workers）。

---

## 本地使用

1. 双击打开 `llm-key-tester.html`（建议用本机浏览器，而非在线预览，否则 CORS 代理类功能受限）。
2. 粘贴你的「接口地址 + Key + 模型ID」，点「解析」。
3. 点「测试全部」，看结果。
4. 若浏览器报跨域（CORS），展开底部 CORS 面板：
   - **方案 D（本地，推荐）**：在本目录命令行运行 `node proxy.js`，保持窗口开启，面板选 D + 本地即可。
   - **方案 D（云端）**：参照下方「部署到 Cloudflare」部署后，面板选 D + Cloudflare Workers，地址已自动填好。

---

## 部署到 Cloudflare（域名 KeyCheck.hhxx.eu.org + 代理 Worker）

本仓库附带一个 **Cloudflare Worker**（`worker/worker.js`），同一域名下：
- `/` 返回本工具页面
- `/proxy?url=<目标>` 作为 CORS 反向代理
- `/health` 供工具探活

### 一键部署（推荐）

在本机（非沙箱）仓库根目录执行：

```bash
# 1) 安装前置
npm install -g wrangler
git config --global user.name  "你的名字"
git config --global user.email "你的邮箱"

# 2) 设置 Cloudflare 环境变量（从 Cloudflare 控制台获取）
export CF_ACCOUNT_ID=你的账户ID
export CF_ZONE_ID=hhxx.eu.org的ZoneID

# 3) 运行部署脚本（会读取 备忘key.txt 里的 Cloudflare 全局密钥，不打印、不入库）
node deploy.mjs
```

前置条件：
- 本机已装 `node 18+`、`git`、`gh`(GitHub CLI)、`wrangler`。
- 你的 `备忘key.txt` 放在仓库根目录，格式：第 1 行 GitHub PAT（`ghp_…`），第 3 行 Cloudflare 全局密钥（40 位 hex），第 6 行 DNS 编辑令牌。**该文件已被 `.gitignore` 排除，不会推送到 GitHub。**
- `hhxx.eu.org` 已加进对应 Cloudflare 账户，且 NS 已指向 Cloudflare。

部署脚本会自动：初始化 Git → 建公开仓库 `KeyCheck` 并推送 → 在 Cloudflare 建 `KeyCheck.hhxx.eu.org` 的 DNS 记录 → 部署 Worker。

### 手动部署

1. **GitHub**：`git init && git add . && git commit -m init && gh repo create KeyCheck --public --source . --remote origin --push`
2. **Worker**：`cd worker && wrangler deploy`（需 `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` 或 `wrangler login`）。
3. **DNS**：在 Cloudflare 给 `hhxx.eu.org` 添加 CNAME 记录 `keycheck`，开启代理（橙色云），并加 Worker 路由 `keycheck.hhxx.eu.org/*`。

---

## 目录结构

```
KeyCheck/
├── llm-key-tester.html   # 主工具（单文件，双击即用）
├── proxy.js              # 本地 Node 代理（方案 D 本地）
├── worker/
│   ├── worker.js         # Cloudflare Worker 版代理（同域反代 + 返回页面）
│   ├── wrangler.toml     # Worker 配置
│   └── site.js           # 由 deploy.mjs 自动生成（注入页面 HTML）
├── deploy.mjs            # 一键部署脚本（GitHub + Cloudflare）
├── package.json
├── README.md / README_EN.md
└── .gitignore            # 已排除 备忘key.txt 等私密文件
```

---

## 安全与隐私

- 本项目**不收集、不存储任何 Key**。本地测试时 Key 仅在浏览器内存中用于请求；云端代理模式下，请求会经 Cloudflare 及你的 Worker 中转（平台可见），请使用**自己的账号**自建，且**不要公开分享代理地址**。
- 仓库中**不含任何真实密钥**，`备忘key.txt`、`.workbuddy/` 等均被 `.gitignore` 排除。
- 公开仓库仅含工具代码与文档，请务必在推送前确认没有把个人密钥误提交。

## 免责声明

本工具仅供个人测试自己拥有合法授权的 API Key 使用。请遵守各厂商服务条款，勿用于任何违规用途。
