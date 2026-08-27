// worker.js — Cloudflare Worker
// 部署路由（deploy.mjs 自动配置）：KeyCheck.hhxx.eu.org/*
//   GET  /                       -> 返回静态页面（HTML 由 deploy.mjs 注入到 ./site.js）
//   GET  /health                 -> 200 "ok"（供本工具探活）
//   任意请求 + ?url=<目标>         -> 反向代理到目标，并附带 CORS 头
//
// 设计要点（对齐本地 proxy.js v3）：
//   - 缓冲请求体并显式设置 Content-Length，避免 chunked（部分网关如微信会拒绝 chunked）。
//   - 剥离浏览器特征头（sec-fetch-*）与 accept-encoding、CF-* 头，避免被识别/拦截。
//   - 统一回写 Access-Control-Allow-*，使跨域调用可用。
import { SITE_HTML } from './site.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, PATCH, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function withCors(extra) {
  return Object.assign({}, CORS, extra || {});
}

const SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept-encoding',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-request-id',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) 探活
    if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
      return new Response('ok', { status: 200, headers: withCors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
    }

    // 2) 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors() });
    }

    // 3) 反向代理目标
    const target = url.searchParams.get('url');
    if (!target) {
      // 无 ?url= ：当作站点首页，返回 HTML
      return new Response(SITE_HTML, {
        status: 200,
        headers: withCors({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }),
      });
    }

    let tUrl;
    try { tUrl = new URL(target); }
    catch (e) { return new Response('invalid url: ' + target, { status: 400, headers: withCors({ 'Content-Type': 'text/plain; charset=utf-8' }) }); }
    if (tUrl.protocol !== 'http:' && tUrl.protocol !== 'https:') {
      return new Response('only http/https allowed', { status: 400, headers: withCors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
    }

    // 4) 转发头（去掉 hop-by-hop / 浏览器特征 / CF 头）
    const fwd = {};
    for (const [k, v] of request.headers.entries()) {
      if (SKIP_HEADERS.has(k.toLowerCase())) continue;
      if (k.toLowerCase().startsWith('cf-')) continue;
      fwd[k] = v;
    }

    const init = { method: request.method, headers: fwd, redirect: 'follow' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // 缓冲 body → 显式 Content-Length（规避微信等拒绝 chunked）
      const buf = await request.arrayBuffer();
      init.body = buf;
      fwd['Content-Length'] = String(buf.byteLength);
    }

    let resp;
    try {
      resp = await fetch(tUrl.toString(), init);
    } catch (e) {
      return new Response('proxy error: ' + e.message, { status: 502, headers: withCors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
    }

    // 5) 回写响应（覆盖原 CORS 头，统一由本 Worker 控制）
    const out = new Headers(resp.headers);
    for (const k of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers']) out.delete(k);
    return new Response(resp.body, { status: resp.status, headers: withCors(Object.fromEntries(out.entries())) });
  },
};
