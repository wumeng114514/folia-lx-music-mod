// main.cjs — LX Music 自定义源适配器 (Electron 主进程)
// 注册为 Folia omni.providers，提供搜索和播放能力
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');

const DEFAULT_QUALITY = '320k';
const DEFAULT_SCRIPT_URL = 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js';

module.exports = function activate(api) {
    const log = api.log;
    log.info('LX Music 自定义源适配器正在初始化...');

    // -------- 脚本运行时状态 --------
    let scriptSources = null;
    let requestHandler = null;
    let scriptLoaded = false;
    let scriptError = null;

    // -------- 持久化配置 --------
    const getConfig = async () => {
        const scriptUrl = (await api.storage.data.get('scriptUrl')) || DEFAULT_SCRIPT_URL;
        const quality = (await api.storage.data.get('quality')) || DEFAULT_QUALITY;
        return { scriptUrl, quality };
    };

    // -------- HTTP 请求 (给 lx 脚本用) --------
    function lxRequest(url, options, callback) {
        const transport = (url || '').startsWith('https') ? https : http;
        const headers = {
            ...(options?.headers || {}),
            'User-Agent': options?.headers?.['User-Agent'] ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        const method = (options?.method || 'GET').toUpperCase();
        const req = transport.request(url, { method, headers, timeout: options?.timeout || 15000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                lxRequest(res.headers.location, options, callback);
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const rawBody = Buffer.concat(chunks);
                let body = rawBody.toString('utf-8');
                try { body = JSON.parse(body); } catch (_) {}
                callback(null, { statusCode: res.statusCode, headers: res.headers, body, rawBody }, body);
            });
        });
        req.on('error', err => callback(err));
        req.on('timeout', () => { req.destroy(); callback(new Error('Request timeout')); });
        if (options?.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        if (options?.form) {
            const d = new URLSearchParams(options.form).toString();
            try { if (!req.headersSent) req.setHeader('Content-Type', 'application/x-www-form-urlencoded'); } catch (_) {}
            req.write(d);
        }
        req.end();
        return () => req.destroy();
    }

    // -------- 通用 HTTP GET/POST (给搜索用) --------
    function httpJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            const transport = (url || '').startsWith('https') ? https : http;
            const method = (options.method || 'GET').toUpperCase();
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...(options.headers || {}),
            };
            const req = transport.request(url, { method, headers, timeout: 15000 }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    httpJson(res.headers.location, options).then(resolve, reject);
                    return;
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    try {
                        resolve(JSON.parse(raw));
                    } catch (_) {
                        // 酷我旧搜索接口返回 JavaScript 对象格式而非严格 JSON。
                        try {
                            const normalized = raw
                                .replace(/&nbsp;/g, ' ')
                                .replace(/&amp;/g, '&')
                                .replace(/&quot;/g, '\"')
                                .replace(/([{,])\s*([A-Za-z0-9_]+)\s*:/g, '$1\"$2\":')
                                .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) => JSON.stringify(value));
                            resolve(JSON.parse(normalized));
                        } catch (_) {
                            resolve(raw);
                        }
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            req.end();
        });
    }

    // -------- 搜索 API（多平台聚合）--------
    async function searchSongs(keyword, limit = 30, offset = 0) {
        const results = [];
        const errors = [];

        // 并行搜索多个平台
        const searches = [];

        // 1. 网易云
        searches.push(searchNetease(keyword, limit, offset).catch(e => { errors.push('wy:' + e.message); return []; }));
        // 2. 酷我
        searches.push(searchKuwo(keyword, limit, offset).catch(e => { errors.push('kw:' + e.message); return []; }));

        const allResults = await Promise.all(searches);
        for (const r of allResults) results.push(...r);

        if (errors.length > 0) log.warn('搜索部分失败: ' + errors.join(', '));
        return results;
    }

    // 网易云音乐搜索
    async function searchNetease(keyword, limit, offset) {
        const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=${offset}`;
        const data = await httpJson(url, {
            headers: { 'Referer': 'https://music.163.com/', 'Cookie': 'appver=2.7.1' },
        });
        if (!data?.result?.songs) return [];
        return data.result.songs.map(s => ({
            id: String(s.id),
            title: s.name || '',
            artists: (s.artists || []).map(a => a.name || ''),
            album: s.album?.name || '',
            coverUrl: s.album?.picUrl || '',
            durationMs: s.duration || 0,
            source: 'wy',
        }));
    }

    // 酷我音乐搜索
    async function searchKuwo(keyword, limit, offset) {
        const page = Math.floor(offset / limit) + 1;
        const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&vipver=1&ft=music&encoding=utf8&rformat=json&moession=1&show_copyright_off=1&searchapi=6`;
        const data = await httpJson(url, {
            headers: { 'Referer': 'https://www.kuwo.cn/', 'Secret': '' },
        });
        if (!data?.abslist) return [];
        return data.abslist.map(s => ({
            id: s.DC_TARGETID || s.MUSICRID?.replace('MUSIC_', '') || '',
            title: (s.SONGNAME || '').replace(/<[^>]+>/g, ''),
            artists: [(s.ARTIST || '').replace(/<[^>]+>/g, '')],
            album: (s.ALBUM || '').replace(/<[^>]+>/g, ''),
            coverUrl: s.web_albumpic_short ? `https://img1.kuwo.cn/star/albumcover/${s.web_albumpic_short}` : '',
            durationMs: parseInt(s.DURATION || '0') * 1000,
            source: 'kw',
        }));
    }

    // -------- 解析脚本头部注释 --------
    function parseScriptMeta(content) {
        const match = content.match(/\/\*!?\s*\n([\s\S]*?)\*\//);
        if (!match) return {};
        const meta = {};
        const re = /@(\w+)\s+(.+)/g;
        let m;
        while ((m = re.exec(match[1])) !== null) {
            meta[m[1]] = m[2].trim();
        }
        return meta;
    }

    // -------- 加载 LX 脚本 --------
    async function loadScript(scriptUrl) {
        log.info(`正在下载脚本: ${scriptUrl}`);
        scriptLoaded = false;
        scriptError = null;
        scriptSources = null;
        requestHandler = null;

        let scriptContent;
        try {
            scriptContent = await downloadText(scriptUrl);
        } catch (err) {
            scriptError = `下载脚本失败: ${err.message}`;
            log.error(scriptError);
            return { success: false, error: scriptError };
        }
        log.info(`脚本下载完成, 大小: ${scriptContent.length} 字节`);

        const meta = parseScriptMeta(scriptContent);
        log.info(`脚本: ${meta.name || '未知'} v${meta.version || '?'} by ${meta.author || '?'}`);

        // 构造 lx API
        const lxApi = {
            version: '2.10.0',
            currentScriptInfo: {
                name: meta.name || '自定义源',
                version: meta.version || '1.0.0',
                description: meta.description || '',
                author: meta.author || '',
                homepage: meta.homepage || '',
                rawScript: scriptContent,
            },
            env: 'desktop',
            EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
            on(name, handler) {
                log.info(`[LX] on('${name}')`);
                if (name === 'request') {
                    requestHandler = handler;
                    log.info('[LX] request handler 已注册');
                }
            },
            send(name, data) {
                log.info(`[LX] send('${name}')`);
                if (name === 'inited') {
                    if (data?.status !== false) {
                        scriptLoaded = true;
                        scriptSources = data?.sources || {};
                        log.info(`[LX] 初始化成功! 源: ${Object.keys(scriptSources).join(', ')}`);
                    } else {
                        scriptError = '脚本初始化返回失败';
                        log.error(scriptError);
                    }
                }
            },
            request: lxRequest,
            utils: {
                buffer: {
                    from: (data, encoding) => Buffer.from(data, encoding),
                    bufToString: (buf, encoding) => Buffer.isBuffer(buf) ? buf.toString(encoding) : String(buf),
                },
                crypto: {
                    aesEncrypt(buffer, mode, key, iv) {
                        try {
                            const cipher = crypto.createCipheriv(mode, key, iv);
                            return Buffer.concat([cipher.update(buffer), cipher.final()]);
                        } catch (e) { return buffer; }
                    },
                    md5(str) { return crypto.createHash('md5').update(typeof str === 'string' ? str : String(str)).digest('hex'); },
                    randomBytes(size) { return crypto.randomBytes(size).toString('hex'); },
                    rsaEncrypt(buffer, key) { try { return crypto.publicEncrypt(key, buffer); } catch (e) { return buffer; } },
                },
                zlib: {
                    inflate: (buf) => new Promise((r, j) => zlib.inflate(buf, (e, v) => e ? j(e) : r(v))),
                    deflate: (buf) => new Promise((r, j) => zlib.deflate(buf, (e, v) => e ? j(e) : r(v))),
                },
            },
        };

        // 直接在全局环境中挂载 lx API 并执行脚本
        const prevLx = globalThis.lx;
        globalThis.lx = lxApi;

        try {
            (0, eval)(scriptContent);
            log.info('[LX] 脚本执行完成');
        } catch (e) {
            scriptError = e.message;
            log.error(`[LX] 执行出错: ${e.message}`);
            globalThis.lx = prevLx;
            return { success: false, error: scriptError };
        }

        // 等待异步初始化
        await new Promise((resolve) => {
            if (scriptLoaded) { resolve(); return; }
            let waited = 0;
            const timer = setInterval(() => {
                waited += 200;
                if (scriptLoaded || scriptError || waited > 20000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });

        if (scriptLoaded) {
            return { success: true, sources: scriptSources };
        } else {
            if (!scriptError) scriptError = '脚本初始化超时';
            return { success: false, error: scriptError };
        }
    }

    // -------- 通过 LX 脚本获取音频 URL --------
    async function getAudioUrlFromLx(source, songId, quality, musicInfo) {
        if (!scriptLoaded || !requestHandler) {
            throw new Error('脚本未加载');
        }
        const qualityMap = {
            standard: '128k',
            high: '320k',
            lossless: 'flac',
            hires: 'flac24bit',
        };
        const q = qualityMap[quality] || quality || DEFAULT_QUALITY;
        log.info(`[LX] 请求播放 source=${source} id=${songId} quality=${q}`);
        // musicInfo 必须包含 source 字段，否则聚合 API 会返回 "source not match"
        const info = {
            source,
            songmid: songId,
            id: songId,
            ...(musicInfo || {}),
        };
        // 确保 source 字段存在
        if (!info.source) info.source = source;
        const result = await requestHandler({
            source,
            action: 'musicUrl',
            info: {
                type: q,
                musicInfo: info,
            },
        });
        // 部分 LX 源会在 URL 后附加换行符或引号，必须在交给播放器前清理。
        if (typeof result === 'string') return result.trim().replace(/^['\"]|['\"]$/g, '');
        if (result && typeof result.url === 'string') {
            return { ...result, url: result.url.trim().replace(/^['\"]|['\"]$/g, '') };
        }
        return result;
    }

    // -------- RPC 接口 --------
    api.rpc.handle('getConfig', async () => {
        const config = await getConfig();
        return { ...config, loaded: scriptLoaded, error: scriptError, sources: scriptSources };
    });

    api.rpc.handle('setConfig', async (config) => {
        if (config.scriptUrl !== undefined) await api.storage.data.set('scriptUrl', String(config.scriptUrl));
        if (config.quality !== undefined) await api.storage.data.set('quality', String(config.quality));
        log.info('配置已更新');
        return await getConfig();
    });

    api.rpc.handle('loadScript', async (arg) => {
        const url = typeof arg === 'string' ? arg : arg?.url;
        if (!url) return { success: false, error: '请输入脚本 URL' };
        await api.storage.data.set('scriptUrl', url);
        return await loadScript(url);
    });

    api.rpc.handle('getStatus', async () => ({
        loaded: scriptLoaded,
        error: scriptError,
        sources: scriptSources,
    }));

    // 搜索 RPC
    api.rpc.handle('search', async ({ keyword, limit, offset }) => {
        try {
            const items = await searchSongs(keyword, limit || 30, offset || 0);
            return { success: true, items };
        } catch (e) {
            return { success: false, error: e.message, items: [] };
        }
    });

    // 获取音频 URL RPC
    api.rpc.handle('getAudioUrl', async ({ source, songId, quality, musicInfo }) => {
        try {
            const config = await getConfig();
            const q = quality || config.quality;
            log.info(`[getAudioUrl] source=${source} songId=${songId} quality=${q} name=${musicInfo?.name || '?'}`);
            const url = await getAudioUrlFromLx(source, songId, q, musicInfo);
            log.info(`[getAudioUrl] 成功: ${typeof url === 'string' ? url.substring(0, 100) : JSON.stringify(url)?.substring(0, 100)}`);
            if (typeof url === 'string') {
                return { success: true, url };
            } else if (url && typeof url === 'object' && url.url) {
                return { success: true, url: url.url };
            } else {
                return { success: false, error: '返回的 URL 格式无效' };
            }
        } catch (err) {
            log.error(`获取音频 URL 失败: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    // -------- 自动加载已保存的脚本 --------
    getConfig().then(config => {
        log.info('自动加载 LX Music 脚本...');
        loadScript(config.scriptUrl || DEFAULT_SCRIPT_URL).catch(err => {
            log.error(`自动加载失败: ${err.message || err}`);
        });
    });

    log.info('LX Music 自定义源适配器初始化完成');
};

// -------- 下载文本 --------
function downloadText(url) {
    return new Promise((resolve, reject) => {
        const transport = (url || '').startsWith('https') ? require('https') : require('http');
        const req = transport.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Folia-LxMod/1.0)' },
            timeout: 30000,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(downloadText(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}
