// 本地代理：绕开浏览器 CORS 限制，使网页可直接测试未开放跨域的 API。
// 用法：node proxy.js   然后打开 llm-key-tester.html，选择「CORS 方案 D」。
// 仅转发请求，不保存任何 key / 数据。
//
// v3 关键修复：
//  1. 缓冲完整请求体后显式设置 Content-Length 定长转发（不再用 chunked），
//     因为微信 chatapi.weixin.qq.com 等网关不接受 Transfer-Encoding: chunked 的请求体，会返回 412。
//  2. 剥离浏览器特有的 sec-fetch-* 头，部分网关用它们识别并拦截浏览器跨域请求。
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 8787;

// 剥离 hop-by-hop 头、浏览器特征头（sec-fetch-*）、以及目标端不该看到的本机信息
const STRIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'origin', 'referer',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'transfer-encoding', 'accept-encoding' // accept-encoding 剥掉，让目标返回未压缩体，代理直接透传更稳
]);

http.createServer((req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  const targetRaw = u.searchParams.get('url');
  if (!targetRaw) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing url param' }));
  }
  let target;
  try { target = new URL(targetRaw); } catch (e) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid url' }));
  }
  console.log('[proxy] =>', req.method, targetRaw);

  // 透传请求头（去掉 strip 列表里的）
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  const lib = target.protocol === 'https:' ? https : http;
  const options = {
    method: req.method,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    headers
  };

  // 缓冲完整请求体 → 显式设 Content-Length → 定长转发（非 chunked）
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('error', () => { /* 客户端断开，忽略 */ });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length > 0) {
      headers['content-length'] = String(body.length);
    }

    const preq = lib.request(options, pres => {
      const out = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': pres.headers['content-type'] || 'application/json'
      };
      // 不透传 content-encoding：因为请求已要求未压缩响应（剥了 accept-encoding）
      console.log('[proxy] <-', pres.statusCode, target.hostname, target.pathname);
      if (!res.headersSent) {
        res.writeHead(pres.statusCode, out);
        pres.pipe(res);
      }
      pres.on('error', () => { try { res.destroy(); } catch (e) {} });
    });

    preq.on('error', e => {
      console.log('[proxy] ERROR 转发失败:', e.message, target.hostname);
      if (!res.headersSent) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    preq.setTimeout(25000, () => { try { preq.destroy(); } catch (e) {} });

    // 用缓冲好的完整 body 定长发送
    preq.end(body);
  });
}).listen(PORT, () => {
  console.log('LLM 测试代理已启动: http://localhost:' + PORT);
  console.log('在 llm-key-tester.html 中选择「CORS 方案 D」即可测试未开放跨域的 API。');
  console.log('(v3: 定长转发请求体，兼容不接受 chunked 的网关如微信)');
});
