'use strict';

const https = require('node:https');
const noteHosts = new Set(['xhslink.cn', 'xhslink.com', 'xiaohongshu.com', 'www.xiaohongshu.com']);
const MAX_HTML = 1024 * 1024;
const MAX_IMAGE = 2 * 1024 * 1024;

function allowed(url, image = false) {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (image
    ? host === 'xhscdn.com' || host.endsWith('.xhscdn.com')
    : noteHosts.has(host));
}

function read(url, image = false, redirects = 5) {
  if (!allowed(url, image)) return Promise.reject(new Error('仅支持小红书链接'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        Accept: image ? 'image/jpeg,image/png,image/webp,*/*;q=0.5' : 'text/html,application/xhtml+xml',
        Referer: 'https://www.xiaohongshu.com/',
        'Cache-Control': 'no-cache'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (!redirects) return reject(new Error('跳转过多'));
        let next;
        try { next = new URL(response.headers.location, url); }
        catch (_) { return reject(new Error('无效跳转')); }
        read(next, image, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`来源暂不可读取（${response.statusCode}）`)); return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > (image ? MAX_IMAGE : MAX_HTML)) return req.destroy(new Error('内容过大'));
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ body: Buffer.concat(chunks), type: response.headers['content-type'] || '' }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('读取超时')));
    req.on('error', reject);
  });
}

function decode(value) {
  return value.replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function firstImage(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:property|name)=["']og:image(?::url)?["']/i.test(tag)) continue;
    const match = tag.match(/\bcontent=["']([^"']+)["']/i);
    if (!match) continue;
    try {
      let url = new URL(decode(match[1]).replace(/^http:/i, 'https:'));
      if (url.hostname === 'ci.xiaohongshu.com') url = new URL(url.pathname.slice(1).replace(/^http:/i, 'https:'));
      if (allowed(url, true)) return url;
    } catch (_) { /* Skip malformed metadata. */ }
  }
  return null;
}

async function cover(urlText) {
  if (typeof urlText !== 'string' || urlText.length > 1500) throw new Error('链接无效');
  const url = new URL(urlText);
  if (!allowed(url)) throw new Error('仅支持小红书链接');
  const page = await read(url);
  const photo = firstImage(page.body.toString('utf8'));
  if (!photo) throw new Error('未找到首图');
  const image = await read(photo, true);
  const mime = /^image\/(jpeg|png|webp)/i.exec(image.type)?.[0]?.toLowerCase();
  if (!mime || image.body.length < 1000) throw new Error('图片格式不受支持');
  return { ok: true, mime, imageBase64: image.body.toString('base64') };
}

exports.main = async event => {
  const http = typeof event?.httpMethod === 'string';
  if (http && event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ ok: false, message: 'Method Not Allowed' }) };
  try {
    const input = http ? JSON.parse(event.body || '{}') : event;
    const result = await cover(input?.url);
    return http ? { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) } : result;
  } catch (error) {
    const result = { ok: false, message: error.message || '首图读取失败' };
    return http ? { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) } : result;
  }
};
