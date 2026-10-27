// plugins/anime-news.js — Anime News Commands
const { cmd } = require('../command');
const animeNews = require('../lib/anime-news');

cmd({
    pattern: "animenews",
    alias: ["anews", "anime"],
    desc: "Anime news fetcher + auto-sender",
    category: "anime",
    react: "📰",
    filename: __filename,
},
async (conn, mek, m, { from, reply, args, isOwner }) => {
    try {
        const settings = animeNews.getSettings();
        const sub = (args[0] || '').toLowerCase();

        // ═══ Manual fetch: `.animenews` or `.animenews 5` ═══
        if (!sub || /^\d+$/.test(sub)) {
            const count = sub ? parseInt(sub) : 3;
            if (count < 1 || count > 10) {
                return reply('❌ Count 1-10 only');
            }
            await reply(`🔍 Fetching ${count} latest anime news...`);

            try {
                const articles = await animeNews.fetchNews(count);
                if (!articles.length) return reply('❌ No news found');
                await animeNews.sendArticles(conn, from, articles, mek);
            } catch (e) {
                return reply(`❌ Fetch failed: ${e.message}`);
            }
            return;
        }

        // ═══ Settings — owner only ═══
        if (!isOwner) {
            return reply(
                `📰 *Anime News*\n\n` +
                `\`.animenews\` — fetch 3 latest\n` +
                `\`.animenews 5\` — fetch 5 latest\n\n` +
                `_Settings commands are owner-only_`
            );
        }

        switch (sub) {
            case 'on': {
                const latest = await animeNews.fetchNews(20).catch(() => []);
                await animeNews.updateSettings({
                    enabled: true,
                    lastSeenGuids: latest.map(a => a.guid),
                    lastCheck: new Date().toISOString(),
                });
                animeNews.stopScheduler();
                animeNews.startScheduler();
                return reply(
                    `✅ *Auto anime news ON*\n\n` +
                    `Interval: *${settings.intervalHours}h*\n` +
                    `Targets: *${settings.targets.length}*\n\n` +
                    `_Add this chat: \`.animenews target\`_`
                );
            }

            case 'off':
                await animeNews.updateSettings({ enabled: false });
                animeNews.stopScheduler();
                return reply('❌ *Auto anime news OFF*');

            case 'status': {
                const s = animeNews.getSettings();
                const lines = [
                    `📰 *Anime News Status*`,
                    ``,
                    `Auto: ${s.enabled ? '✅ ON' : '❌ OFF'}`,
                    `Scheduler: ${animeNews.isSchedulerRunning() ? '🟢 Running' : '⚪ Stopped'}`,
                    `Interval: *${s.intervalHours}h*`,
                    `Targets: *${s.targets.length}*`,
                    `Last check: ${s.lastCheck ? new Date(s.lastCheck).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }) : 'never'}`,
                    `Seen articles: *${s.lastSeenGuids.length}*`,
                    ``,
                    `*Targets:*`,
                    ...(s.targets.length ? s.targets.map((t, i) => `${i + 1}. ${t}`) : ['_(none)_']),
                ];
                return reply(lines.join('\n'));
            }

            case 'target': {
                if (settings.targets.includes(from)) {
                    return reply('ℹ️ This chat is already a target');
                }
                const next = [...settings.targets, from];
                await animeNews.updateSettings({ targets: next });
                return reply(`✅ Added to targets\n\nTotal: *${next.length}*`);
            }

            case 'untarget': {
                if (!settings.targets.includes(from)) {
                    return reply('ℹ️ This chat is not a target');
                }
                const next = settings.targets.filter(t => t !== from);
                await animeNews.updateSettings({ targets: next });
                if (next.length === 0) {
                    animeNews.stopScheduler();
                }
                return reply(`✅ Removed\n\nTotal: *${next.length}*`);
            }

            case 'targets': {
                const s = animeNews.getSettings();
                if (s.targets.length === 0) {
                    return reply('📭 No targets set\n\n`.animenews target` to add this chat');
                }
                return reply(
                    `📋 *Targets (${s.targets.length})*\n\n` +
                    s.targets.map((t, i) => `${i + 1}. ${t}`).join('\n')
                );
            }

            case 'interval': {
                const hours = parseFloat(args[1]);
                if (!hours || hours < 0.5 || hours > 48) {
                    return reply('❌ Interval 0.5-48 hours\n\nExample: `.animenews interval 6`');
                }
                await animeNews.updateSettings({ intervalHours: hours });
                if (animeNews.isSchedulerRunning()) {
                    animeNews.stopScheduler();
                    animeNews.startScheduler();
                }
                return reply(`✅ Interval set: *${hours}h*`);
            }

            case 'test': {
                await reply('🧪 Running auto-send cycle (test)...');
                try {
                    await animeNews.autoSend();
                    return reply('✅ Test cycle complete — check logs');
                } catch (e) {
                    return reply(`❌ ${e.message}`);
                }
            }

            default:
                return reply(
                    `📰 *Anime News Commands*\n\n` +
                    `*Fetch:*\n` +
                    `\`.animenews\` — 3 latest\n` +
                    `\`.animenews 5\` — 5 latest\n\n` +
                    `*Settings:*\n` +
                    `\`.animenews on\` — enable auto\n` +
                    `\`.animenews off\` — disable auto\n` +
                    `\`.animenews status\` — full status\n` +
                    `\`.animenews target\` — add this chat\n` +
                    `\`.animenews untarget\` — remove this chat\n` +
                    `\`.animenews targets\` — list targets\n` +
                    `\`.animenews interval 6\` — set 6h\n` +
                    `\`.animenews test\` — run cycle now`
                );
        }
    } catch (e) {
        console.error('[animenews cmd] error:', e);
        await reply(`❌ ${e.message}`);
    }
});
