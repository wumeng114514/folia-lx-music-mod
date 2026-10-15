// client.mjs — LX Music 自定义源 Folia Provider (渲染进程)

export default async function activate(folium) {
    const log = folium.log;
    log.info('LX Music Provider 初始化中...');

    // -------- 注册设置 --------
    const section = folium.registries.settingsSections.register({
        id: 'lx-music-settings',
        label: { 'zh-CN': 'LX Music 音源', en: 'LX Music Source' },
        description: { 'zh-CN': '填入洛雪音乐自定义源脚本 URL 后保存，重启生效', en: 'Enter LX Music source script URL' },
        settings: [
            {
                key: 'script-url',
                type: 'text',
                label: { 'zh-CN': '脚本 URL', en: 'Script URL' },
                default: '',
            },
            {
                key: 'quality',
                type: 'select',
                label: { 'zh-CN': '音质', en: 'Quality' },
                options: [
                    { value: '128k', label: '128k' },
                    { value: '320k', label: '320k' },
                    { value: 'flac', label: 'FLAC' },
                    { value: 'flac24bit', label: 'Hi-Res' },
                ],
                default: '320k',
            },
        ],
    });

    // 监听设置变化同步到主进程
    if (section.params) {
        try {
            const syncSettings = async () => {
                const url = section.params.get('script-url') ?? '';
                const quality = section.params.get('quality') ?? '320k';
                await folium.rpc.call('setConfig', { scriptUrl: url, quality });
                if (url) {
                    const result = await folium.rpc.call('loadScript', url);
                    log.info(result.success ? '脚本加载成功' : '脚本加载失败: ' + result.error);
                }
            };
            if (typeof section.params.subscribe === 'function') {
                section.params.subscribe(syncSettings);
            }
        } catch (e) {
            log.warn('设置监听: ' + e.message);
        }
    }

    // -------- 注册为 omni.providers --------
    try {
        const omniProviders = folium.experimental['omni.providers'];
        omniProviders.register({
            id: 'lx-music',
            displayName: 'LX Music',
            shortName: 'LX',

            // 搜索歌曲
            async search(query, { limit, offset }) {
                const result = await folium.rpc.call('search', { keyword: query, limit, offset });
                if (!result.success) {
                    log.warn('搜索失败: ' + result.error);
                    return { items: [], hasMore: false };
                }
                const items = (result.items || []).map(s => ({
                    id: `${s.source}:${s.id}`,
                    title: s.title || '',
                    artists: s.artists || [],
                    album: s.album || '',
                    coverUrl: s.coverUrl || '',
                    durationMs: s.durationMs || 0,
                }));
                return { items, hasMore: items.length >= limit };
            },

            // 获取音频 URL
            async getAudioUrl(song, quality) {
                const mediaId = song.id;
                // mediaId 格式: "source:songId"
                const parts = mediaId.split(':');
                const source = parts.length > 1 ? parts[0] : 'wy';
                const songId = parts.length > 1 ? parts.slice(1).join(':') : mediaId;

                // 映射 Folia quality 到 LX quality
                const q = quality || '320k';

                const result = await folium.rpc.call('getAudioUrl', {
                    source,
                    songId,
                    quality: q,
                    musicInfo: {
                        songmid: songId,
                        id: songId,
                        name: song.title || '',
                        singer: (song.artists || []).join(' '),
                    },
                });

                if (result?.success && result.url) {
                    return { url: result.url };
                }

                // 尝试降级音质
                const fallbacks = ['flac', '320k', '128k'];
                for (const fq of fallbacks) {
                    if (fq === q) continue;
                    try {
                        const r2 = await folium.rpc.call('getAudioUrl', {
                            source, songId, quality: fq,
                            musicInfo: { songmid: songId, id: songId, name: song.title || '', singer: (song.artists || []).join(' ') },
                        });
                        if (r2?.success && r2.url) return { url: r2.url };
                    } catch (_) {}
                }

                throw new Error(result?.error || '无法获取播放链接');
            },
        });
        log.info('已注册为 omni.providers: LX Music');
    } catch (e) {
        log.error('omni.providers 注册失败: ' + e.message);
    }

    log.info('LX Music Provider 初始化完成');
}
