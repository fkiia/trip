'use strict';

const https = require('node:https');

const MAX_HTML = 1024 * 1024;
const MAX_IMAGE = 2 * 1024 * 1024;
const noteHosts = new Set(['xhslink.cn', 'xhslink.com', 'xiaohongshu.com', 'www.xiaohongshu.com']);

function allowed(url, image = false) {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (image
    ? (host === 'xhscdn.com' || host.endsWith('.xhscdn.com') || (host === 'ci.xiaohongshu.com' && /^\/https?:\/\/[^/]+\.xhscdn\.com\//.test(url.pathname)))
    : noteHosts.has(host));
}

function request(url, image = false, redirects = 5) {
  if (!allowed(url, image)) return Promise.reject(new Error('不支持此链接'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        'Accept': image ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml',
        'Referer': 'https://www.xiaohongshu.com/'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (!redirects) { reject(new Error('跳转次数过多')); return; }
        let next;
        try { next = new URL(response.headers.location, url); }
        catch (_) { reject(new Error('无效的跳转链接')); return; }
        request(next, image, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`页面或图片暂时无法读取（${response.statusCode}）`)); return;
      }
      const limit = image ? MAX_IMAGE : MAX_HTML;
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) { req.destroy(new Error('图片或页面过大')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({body: Buffer.concat(chunks), type: response.headers['content-type'] || ''}));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('读取超时')));
    req.on('error', reject);
  });
}

function decode(value) {
  return value.replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function firstPhoto(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\b(?:property|name)=["']og:image(?::url)?["']/i.test(tag)) continue;
    const match = tag.match(/\bcontent=["']([^"']+)["']/i);
    if (!match) continue;
    try {
      let url = new URL(decode(match[1]).replace(/^http:/i, 'https:'));
      if (url.hostname === 'ci.xiaohongshu.com') {
        url = new URL(url.pathname.slice(1).replace(/^http:/i, 'https:'));
      }
      if (allowed(url, true)) return url;
    } catch (_) { /* Ignore malformed metadata. */ }
  }
  return null;
}

exports.main = async event => {
  try {
    if (typeof event?.url !== 'string' || event.url.length > 1500) throw new Error('请提供小红书链接');
    const source = new URL(event.url);
    if (!allowed(source)) throw new Error('仅支持小红书链接');
    const page = await request(source);
    const photo = firstPhoto(page.body.toString('utf8'));
    if (!photo) throw new Error('没有找到可读取的首图');
    const image = await request(photo, true);
    const mime = /^image\/(jpeg|png|webp)/i.exec(image.type)?.[0]?.toLowerCase();
    if (!mime || image.body.length < 1000) throw new Error('图片格式不受支持');
    return {ok: true, mime, imageBase64: image.body.toString('base64')};
  } catch (error) {
    return {ok: false, message: error.message || '首图读取失败'};
  }
};
