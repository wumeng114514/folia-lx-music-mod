// main.cjs — Folia 在线音源适配器 (Electron 主进程)
// 所有播放逻辑内置，不下载/执行任何远程代码
'use strict';

const https = require('https');

// -------- 域名白名单 --------
const ALLOWED_HOSTS = new Set([
    'music.163.com',          // WY 搜索/详情/歌词
    'c.y.qq.com',             // QQ 搜索/歌词
    'y.qq.com',               // QQ 封面
    'search.kuwo.cn',         // KW 搜索
    'img1.kuwo.cn',           // KW 封面
    'oiapi.net',              // 播放URL获取
    'p1.music.126.net',       // WY 封面CDN
    'p2.music.126.net',       // WY 封面CDN
]);

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const REQUEST_TIMEOUT_MS = 10000;

let abortControllers = [];

module.exports = function activate(api) {
    const log = api.log;
    log.info('在线音源适配器正在初始化...');

    // -------- 安全 HTTPS 请求 --------
    function safeRequest(url, options = {}, redirectCount = 0) {
        return new Promise((resolve, reject) => {
            let parsed;
            try { parsed = new URL(url); } catch (e) { return reject(new Error('无效URL: ' + url)); }

            if (parsed.protocol !== 'https:') {
                return reject(new Error('仅允许 HTTPS: ' + url));
            }
            if (!ALLOWED_HOSTS.has(parsed.hostname)) {
                return reject(new Error('域名不在白名单: ' + parsed.hostname));
            }

            const reqOptions = {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...(options.headers || {}),
                },
                timeout: REQUEST_TIMEOUT_MS,
            };

            let settled = false;
            let cancelRequest = () => { try { req.destroy(); } catch (_) {} };
            const cleanup = () => {
                const index = abortControllers.indexOf(cancelRequest);
                if (index >= 0) abortControllers.splice(index, 1);
            };
            const fail = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };
            const succeed = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const req = https.request(url, reqOptions, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    if (redirectCount >= MAX_REDIRECTS) return fail(new Error('超过最大重定向次数'));
                    try {
                        const nextUrl = new URL(res.headers.location, url).toString();
                        return safeRequest(nextUrl, { method: 'GET' }, redirectCount + 1).then(succeed, fail);
                    } catch (error) {
                        return fail(error);
                    }
                }

                const chunks = [];
                let totalBytes = 0;
                res.on('data', (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_RESPONSE_BYTES) {
                        res.destroy();
                        fail(new Error('响应超过 5MB 限制'));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => succeed({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
                res.on('error', fail);
            });
            cancelRequest = () => { try { req.destroy(); } catch (_) {} };
            abortControllers.push(cancelRequest);
            req.on('error', fail);
            req.on('timeout', () => { req.destroy(); fail(new Error('请求超时')); });
            if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            req.end();
        });
    }

    async function fetchJson(url, options = {}) {
        const res = await safeRequest(url, options);
        try { return JSON.parse(res.body); } catch (_) { return res.body; }
    }

    function normalizeCoverUrl(value) {
        if (typeof value !== 'string') return '';
        let url = value.trim();
        if (!url) return '';
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('https://')) return url;
        if (url.startsWith('http://')) return url.replace('http://', 'https://');
        return '';
    }

    // ======== 搜索 ========

    // WY 搜索（含封面批量获取）
    async function searchNetease(keyword, limit, offset) {
        const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=${offset}`;
        const searchData = await fetchJson(searchUrl, {
            headers: { 'Referer': 'https://music.163.com/', 'Cookie': 'appver=2.7.1' },
        });
        if (!searchData?.result?.songs?.length) return [];
        const songs = searchData.result.songs;

        // 批量获取封面
        let coverMap = {};
        try {
            const ids = songs.map(s => s.id);
            const detailUrl = `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(ids))}`;
            const detailData = await fetchJson(detailUrl, {
                headers: { 'Referer': 'https://music.163.com/', 'Cookie': 'appver=2.7.1' },
            });
            if (detailData?.songs) {
                for (const s of detailData.songs) {
                    coverMap[s.id] = s.album?.picUrl || '';
                }
            }
        } catch (e) { log.warn('WY 封面获取失败: ' + e.message); }

        return songs.map(s => ({
            id: String(s.id),
            title: s.name || '',
            artists: (s.artists || []).map(a => a.name || ''),
            album: s.album?.name || '',
            coverUrl: normalizeCoverUrl(coverMap[s.id] || ''),
            durationMs: s.duration || 0,
            source: 'wy',
        }));
    }

    // KW 搜索
    async function searchKuwo(keyword, limit, offset) {
        const page = Math.floor(offset / limit);
        const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}&vipver=1&ft=music&encoding=utf8&rformat=json&moession=1&show_copyright_off=1&searchapi=6`;
        const res = await safeRequest(url, { headers: { 'Referer': 'https://search.kuwo.cn/' } });
        let data;
        try { data = JSON.parse(res.body); } catch (_) {
            try { data = JSON.parse(res.body.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/'/g, '"')); } catch (_) { return []; }
        }
        if (!data?.abslist) return [];
        return data.abslist.map(s => ({
            id: s.DC_TARGETID || s.MUSICRID?.replace('MUSIC_', '') || '',
            title: (s.SONGNAME || '').replace(/<[^>]+>/g, ''),
            artists: [(s.ARTIST || '').replace(/<[^>]+>/g, '')],
            album: (s.ALBUM || '').replace(/<[^>]+>/g, ''),
            coverUrl: s.web_albumpic_short
                ? normalizeCoverUrl('https://img1.kuwo.cn/star/albumcover/' + s.web_albumpic_short)
                : '',
            durationMs: parseInt(s.DURATION || '0') * 1000,
            source: 'kw',
        }));
    }

    // QQ 搜索
    async function searchQQ(keyword, limit, offset) {
        const page = Math.floor(offset / limit) + 1;
        const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&p=${page}&n=${limit}&format=json`;
        const data = await fetchJson(url, { headers: { 'Referer': 'https://y.qq.com/' } });
        if (!data?.data?.song?.list) return [];
        return data.data.song.list.map(s => ({
            id: s.songmid || String(s.songid || ''),
            title: s.songname || '',
            artists: (s.singer || []).map(a => a.name || ''),
            album: s.albumname || '',
            coverUrl: s.albummid
                ? 'https://y.qq.com/music/photo_new/T002R300x300M000' + s.albummid + '.jpg'
                : '',
            durationMs: (s.interval || 0) * 1000,
            source: 'tx',
        }));
    }

    // ======== 歌词 ========

    // WY 歌词
    async function getLyricsNetease(songId) {
        const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&tv=1`;
        const data = await fetchJson(url, {
            headers: { 'Referer': 'https://music.163.com/', 'Cookie': 'appver=2.7.1' },
        });
        return data?.lrc?.lyric || null;
    }

    // QQ 歌词
    async function getLyricsQQ(songmid) {
        const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json&nobase64=1`;
        const data = await fetchJson(url, { headers: { 'Referer': 'https://y.qq.com/' } });
        return data?.lyric || null;
    }

    // KW 歌词 — oiapi 返回的 message 里有时包含歌词信息，但没有独立歌词 API
    // 暂不支持

    // ======== 播放URL获取 ========
    const QUALITY_TO_BR = { '128k': 7, '320k': 5, 'flac': 4, 'flac24bit': 3 };

    async function getAudioUrl(source, songId, quality, musicInfo) {
        const name = musicInfo?.name || '';
        const singer = musicInfo?.singer || '';
        const br = QUALITY_TO_BR[quality] || 7;
        let url;

        switch (source) {
            case 'wy':
                url = `https://oiapi.net/api/Music_163?id=${encodeURIComponent(songId)}`;
                break;
            case 'kw':
                url = `https://oiapi.net/api/Kuwo?msg=${encodeURIComponent(name + ' ' + singer)}&n=1&br=${br}`;
                break;
            case 'tx':
                const oiapiKey = typeof musicInfo?.oiapiKey === 'string' ? musicInfo.oiapiKey.trim() : '';
                if (!oiapiKey) throw new Error('请先在模组设置中填写你自己申请的 OIAPI 密钥');
                url = `https://oiapi.net/api/QQ_Music?key=${encodeURIComponent(oiapiKey)}&type=json&br=${br}&n=1&mid=${encodeURIComponent(songId)}`;
                break;
            default:
                throw new Error('不支持的平台: ' + source);
        }

        const data = await fetchJson(url);

        // WY
        if (source === 'wy' && data?.code === 0 && data?.data?.[0]?.url) {
            return data.data[0].url;
        }
        // KW — 从 message 提取
        if (source === 'kw' && data?.code === 1 && data?.message) {
            const match = data.message.match(/音乐链接：(https?:\/\/[^\s]+)/);
            if (match) return match[1];
        }
        // QQ
        if (source === 'tx' && data?.code === 0 && data?.data?.url) {
            return data.data.url;
        }

        throw new Error('无法获取播放链接');
    }

    // ======== RPC 接口 ========

    api.rpc.handle('searchPlatform', async (source, keyword, limit, offset) => {
        try {
            limit = limit || 30;
            offset = offset || 0;
            let items;
            switch (source) {
                case 'wy': items = await searchNetease(keyword, limit, offset); break;
                case 'kw': items = await searchKuwo(keyword, limit, offset); break;
                case 'tx': items = await searchQQ(keyword, limit, offset); break;
                default: return { success: false, error: '不支持的平台', items: [] };
            }
            log.info(source + ' 搜索 "' + keyword + '" 返回 ' + items.length + ' 条');
            return { success: true, items };
        } catch (e) {
            log.error(source + ' 搜索失败: ' + e.message);
            return { success: false, error: e.message, items: [] };
        }
    });

    api.rpc.handle('getAudioUrl', async (source, songId, quality, musicInfo) => {
        try {
            log.info('[getAudioUrl] source=' + source + ' id=' + songId + ' quality=' + quality);
            const url = await getAudioUrl(source, songId, quality, musicInfo);
            if (typeof url === 'string' && url.startsWith('http')) {
                log.info('[getAudioUrl] 成功: ' + url.substring(0, 80));
                return { success: true, url: url.trim() };
            }
            return { success: false, error: '无效的播放URL' };
        } catch (err) {
            log.error('获取音频URL失败: ' + err.message);
            return { success: false, error: err.message };
        }
    });

    api.rpc.handle('getLyrics', async (source, songId) => {
        try {
            let lyrics = null;
            switch (source) {
                case 'wy': lyrics = await getLyricsNetease(songId); break;
                case 'tx': lyrics = await getLyricsQQ(songId); break;
                default: break;
            }
            if (lyrics) return { success: true, lyrics };
            return { success: false, error: '暂不支持该平台歌词' };
        } catch (e) {
            log.warn('歌词获取失败: ' + e.message);
            return { success: false, error: e.message };
        }
    });

    // -------- 停用清理 --------
    api.lifecycle.onDeactivate(() => {
        log.info('在线音源适配器正在清理...');
        for (const abort of abortControllers) {
            try { abort(); } catch (_) {}
        }
        abortControllers = [];
        log.info('在线音源适配器已清理');
    });

    log.info('在线音源适配器初始化完成');
};
