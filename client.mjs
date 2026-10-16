// client.mjs — Folia 在线音源适配器 (渲染进程)
// WY / KW / QQ 三个平台独立注册

export default async function activate(folium) {
    const log = folium.log;
    log.info('在线音源 Provider 初始化中...');

    // -------- 注册设置 --------
    const settingsSection = folium.registries.settingsSections.register({
        id: 'lx-music-settings',
        label: { 'zh-CN': '在线音源设置', en: 'Online Source Settings' },
        description: { 'zh-CN': '在线音源播放质量设置', en: 'Online source playback quality settings' },
        settings: [
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
                defaultValue: '320k',
            },
            {
                key: 'oiapi-key',
                type: 'text',
                label: { 'zh-CN': 'OIAPI 密钥', en: 'OIAPI key' },
                description: { 'zh-CN': '用于获取 QQ 播放链接；请填写你自己申请的密钥。', en: 'Use your own OIAPI key for QQ playback.' },
                defaultValue: '',
            },
        ],
    });

    // -------- 平台定义 --------
    const platforms = [
        { id: 'lx-wy', source: 'wy', displayName: 'WY', shortName: 'WY' },
        { id: 'lx-kw', source: 'kw', displayName: 'KW', shortName: 'KW' },
        { id: 'lx-tx', source: 'tx', displayName: 'QQ', shortName: 'QQ' },
    ];

    // Folia quality → 内部 quality
    const qualityMap = {
        standard: '128k',
        high: '320k',
        lossless: 'flac',
        hires: 'flac24bit',
    };

    const omniProviders = folium.experimental['omni.providers'];

    for (const platform of platforms) {
        try {
            omniProviders.register({
                id: platform.id,
                displayName: platform.displayName,
                shortName: platform.shortName,

                // 搜索
                async search(query, { limit, offset }) {
                    const result = await folium.rpc.call(
                        'searchPlatform', platform.source, query, limit, offset
                    );
                    if (!result.success) {
                        log.warn(platform.displayName + ' 搜索失败: ' + result.error);
                        return { items: [], hasMore: false };
                    }
                    const items = (result.items || []).map(s => ({
                        id: String(s.id),
                        title: s.title || '',
                        artists: s.artists || [],
                        album: s.album || '',
                        coverUrl: s.coverUrl || '',
                        durationMs: s.durationMs || 0,
                    }));
                    return { items, hasMore: items.length >= limit };
                },

                // 播放
                async getAudioUrl(song, quality) {
                    const songId = String(song?.id ?? '');
                    if (!songId) throw new Error('歌曲 ID 为空');
                    const q = qualityMap[quality] || quality || '320k';
                    const settings = settingsSection.params.get();
                    const oiapiKey = typeof settings?.['oiapi-key'] === 'string'
                        ? settings['oiapi-key'].trim()
                        : '';
                    const musicInfo = {
                        source: platform.source,
                        id: songId,
                        name: song.title || '',
                        singer: (song.artists || []).join(' '),
                    };

                    const result = await folium.rpc.call(
                        'getAudioUrl', platform.source, songId, q, { ...musicInfo, oiapiKey }
                    );
                    if (result?.success && result.url) return { url: result.url };

                    // 降级音质
                    for (const fq of ['flac', '320k', '128k']) {
                        if (fq === q) continue;
                        try {
                            const r2 = await folium.rpc.call(
                                'getAudioUrl', platform.source, songId, fq, { ...musicInfo, oiapiKey }
                            );
                            if (r2?.success && r2.url) return { url: r2.url };
                        } catch (_) {}
                    }
                    throw new Error(result?.error || '无法获取播放链接');
                },

                // 歌词
                async getLyrics(song) {
                    const songId = String(song?.id || '');
                    if (!songId) return null;
                    try {
                        const result = await folium.rpc.call(
                            'getLyrics', platform.source, songId
                        );
                        return result?.success ? result.lyrics : null;
                    } catch (_) { return null; }
                },
            });
            log.info('已注册音源: ' + platform.displayName);
        } catch (e) {
            log.error(platform.displayName + ' 注册失败: ' + e.message);
        }
    }

    log.info('在线音源 Provider 初始化完成');
}
