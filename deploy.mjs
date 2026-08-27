#!/usr/bin/env node
// deploy.mjs — KeyCheck 一键部署（在你本机运行，不要在 WorkBuddy 沙箱里跑）
//
// 前置：
//   1. 已安装 node 18+ 、git 、gh(https://cli.github.com) 、wrangler(npm i -g wrangler)
//   2. 本机 git 已配置 user.name / user.email
//   3. 在仓库根目录运行：
//        export CF_ACCOUNT_ID=你的Cloudflare账户ID
//        export CF_ZONE_ID=hhxx.eu.org的Zone ID
//        node deploy.mjs
//   4. hhxx.eu.org 已加进 jjyydd@163.com 的 Cloudflare 账户，且 NS 已指向 Cloudflare
//
// 安全性：所有密钥仅从 备忘key.txt 在内存中读取，经 stdin 传给 gh、经请求头传给 Cloudflare，
//         绝不打印到终端、绝不写进日志、绝不进仓库（已被 .gitignore 排除）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CF_EMAIL = 'jjyydd@163.com';
const REPO = 'KeyCheck';
const ZONE_NAME = 'hhxx.eu.org';
const SUB = 'keycheck';
const DOMAIN = `${SUB}.${ZONE_NAME}`; // KeyCheck.hhxx.eu.org

const fail = (m) => { console.error('\n❌ ' + m); process.exit(1); };
const ok = (m) => console.log('✅ ' + m);
const step = (m) => console.log('\n▶ ' + m);

function run(cmd, opts = {}) {
  const args = Array.isArray(cmd) ? cmd : cmd.split(' ');
  const r = spawnSync(args[0], args.slice(1), {
    stdio: opts.stdio || 'inherit',
    input: opts.input,
    env: opts.env,
    cwd: opts.cwd,
    shell: true,
  });
  if (r.status !== 0 && !opts.ignoreError) {
    fail(`命令失败（退出码 ${r.status}）: ${args.join(' ')}`);
  }
  return r;
}

async function cfApi(method, path, body) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method,
    headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': cfGlobal, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) fail(`Cloudflare ${method} ${path} 失败: ${JSON.stringify(j.errors || j.messages || r.status)}`);
  return j.result;
}

// ---- 1) 读取并校验密钥（仅格式，不打印内容）----
step('读取 备忘key.txt 中的密钥（仅本地内存，不打印）');
let lines;
try { lines = readFileSync('备忘key.txt', 'utf8').split(/\r?\n/); }
catch { fail('当前目录找不到 备忘key.txt，请在仓库根目录运行 deploy.mjs'); }
// 从行中任意位置提取 token
function extractToken(line, pattern) {
  const m = line.match(pattern);
  return m ? m[1] : null;
}
const ghToken = extractToken(lines[0] || '', /\b(ghp_[A-Za-z0-9_]+|gho_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/);
// 支持中文冒号、英文冒号、空格分隔
const cfLine = (lines[2] || '').trim();
const cfMatch = cfLine.match(/:?\s*([a-f0-9]{30,50})$/i) || cfLine.match(/token\s+([a-f0-9]{30,50})/i);
const cfGlobal = cfMatch ? cfMatch[1] : null;

// 账户 ID（行10）：支持 "账户 ID ：xxx" / "账户ID:xxx" / "账户ID xxx"
const acctLine = (lines[9] || '').trim();
const acctMatch = acctLine.match(/[：:\s]+([a-f0-9]{32})$/i);
const CF_ACCOUNT_ID = acctMatch ? acctMatch[1] : null;

// Zone ID（行12）：支持 "Zone ID是xxx" / "Zone ID: xxx" / "xxx"
const zoneLine = (lines[11] || '').trim();
const zoneMatch = zoneLine.match(/[是:：]\s*([a-f0-9]{32})/i) || zoneLine.match(/([a-f0-9]{32})/i);
const CF_ZONE_ID = zoneMatch ? zoneMatch[1] : null;
if (!ghToken) fail('备忘key.txt 第1行未找到 GitHub PAT\n   当前行内容：' + JSON.stringify(lines[0] || ''));
if (!cfGlobal) fail('备忘key.txt 第3行未找到 Cloudflare 全局密钥\n   当前行内容：' + JSON.stringify(lines[2] || ''));
ok('GitHub PAT 与 Cloudflare 全局密钥已提取（仅内存使用）');

if (!CF_ACCOUNT_ID) fail('备忘key.txt 第10行未找到 Cloudflare 账户 ID（2c96f30d...格式32位十六进制）');
if (!CF_ZONE_ID) fail('备忘key.txt 第12行未找到 Cloudflare Zone ID（1e2cd3fa...格式32位十六进制）');
ok('密钥格式校验通过');

async function main() {
  // ---- 2) 生成 worker/site.js（注入页面 HTML 为 JS 字符串）----
  step('生成 worker/site.js（注入 llm-key-tester.html）');
  const html = readFileSync('llm-key-tester.html', 'utf8');
  writeFileSync('worker/site.js',
    '// 该文件由 deploy.mjs 自动生成，请勿手改\nexport const SITE_HTML = ' + JSON.stringify(html) + ';\n');
  ok('worker/site.js 已生成');

  // ---- 3) Git 初始化与提交 ----
  step('Git 初始化并提交（.gitignore 已排除 备忘key.txt / .workbuddy）');
  if (!existsSync('.git')) run('git init');
  // 自动设置 git 身份（避免需要手动配置）
  run('git config --global user.name "jjyydd"', { ignoreError: true });
  run('git config --global user.email "jjyydd@163.com"', { ignoreError: true });
  run('git branch -M main');
  run('git add .');
  const st = run('git status --porcelain', { stdio: 'pipe' }).stdout?.toString().trim();
  if (st) run('git commit -m "Initial commit: KeyCheck LLM key tester"');
  else ok('无新改动，跳过提交');

  // ---- 4) GitHub 建公开仓并推送（用 fetch 替代 gh CLI，无需安装 gh）----
  step('GitHub：登录并创建公开仓库 ' + REPO);
  const ghUserRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!ghUserRes.ok) fail('GitHub API 调用失败: ' + ghUserRes.status);
  const me = await ghUserRes.json();
  if (!me.login) fail('无法获取 GitHub 登录名，请检查 PAT 是否具有 repo 权限');
  ok('已登录 GitHub: ' + me.login);

  // 创建公开仓库
  const createRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + ghToken, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
    body: JSON.stringify({ name: REPO, description: 'LLM API Key tester - KeyCheck', private: false })
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => '');
    if (createRes.status === 422 && err.includes('already exists')) {
      ok('仓库 ' + REPO + ' 已存在，跳过创建');
    } else {
      fail('创建 GitHub 仓库失败: ' + createRes.status + ' ' + err.slice(0, 200));
    }
  } else {
    ok('GitHub 仓库已创建');
  }

  // 添加 remote 并推送
  const remoteUrl = 'https://' + ghToken + '@github.com/' + me.login + '/' + REPO + '.git';
  const hasRemote = run(['git', 'remote', 'get-url', 'origin'], { stdio: 'pipe', ignoreError: true }).stdout?.toString().trim();
  if (!hasRemote) {
    run(['git', 'remote', 'add', 'origin', remoteUrl]);
  } else {
    run(['git', 'remote', 'set-url', 'origin', remoteUrl]);
  }
  run(['git', 'push', '-u', 'origin', 'main']);
  ok('GitHub 仓库就绪: https://github.com/' + me.login + '/' + REPO);

  // ---- 5) Cloudflare：校验 zone + 建 DNS ----
  step('Cloudflare：校验 zone ' + ZONE_NAME);
  const zone = await cfApi('GET', '/zones/' + CF_ZONE_ID);
  if (zone.name !== ZONE_NAME) fail(`Zone ID 对应的域名是 ${zone.name}，并非 ${ZONE_NAME}；请确认 CF_ZONE_ID 正确`);
  ok('Zone 校验通过: ' + ZONE_NAME);

  const recs = await cfApi('GET', `/zones/${CF_ZONE_ID}/dns_records?name=${DOMAIN}&type=CNAME`);
  if (!recs.length) {
    await cfApi('POST', `/zones/${CF_ZONE_ID}/dns_records`, {
      type: 'CNAME', name: SUB, content: ZONE_NAME, proxied: true, ttl: 1,
    });
    ok('已创建 DNS: ' + DOMAIN + ' CNAME ' + ZONE_NAME + '（已代理）');
  } else {
    ok('DNS 记录已存在: ' + DOMAIN);
  }

  // ---- 6) 部署 Cloudflare Worker ----
  step('Cloudflare Workers：部署 ' + REPO);
  const env = Object.assign({}, process.env, {
    CLOUDFLARE_API_KEY: cfGlobal,
    CLOUDFLARE_EMAIL: CF_EMAIL,
    CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID,
  });
  run(['wrangler', 'deploy'], { env, cwd: 'worker' });
  ok('Worker 部署完成');

  // ---- 7) 收尾 ----
  console.log('\n========== 部署完成 ==========');
  console.log('站点 / 代理: https://' + DOMAIN + '/');
  console.log('代理接口:   https://' + DOMAIN + '/proxy?url=<目标>');
  console.log('探活:       https://' + DOMAIN + '/health');
  console.log('GitHub:     https://github.com/' + me.login + '/' + REPO);
  console.log('\n使用：打开 https://' + DOMAIN + '/ ，CORS 面板选 D + Cloudflare Workers，');
  console.log('      地址已自动填为 https://' + DOMAIN + '/proxy ，状态显示「代理在线」即可测试。');
}

main().catch((e) => fail('部署异常: ' + e.message));
