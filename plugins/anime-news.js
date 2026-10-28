// plugins/anime-news.js — Auto Anime News Broadcaster (Anime Corner Source + Anti-Ban)
const Parser = require('rss-parser');
const config = require('../config');

const parser = new Parser({ timeout: 20000 });
const sentGuids = new Set();

async function sendToJid(sock, jid, text) {
    try {
        // 👇 Fix: Newsletter වලට typing (Presence) යවන්නේ නෑ. එහෙම කළොත් bot හිරවෙනවා. 👇
        if (!jid.endsWith('@newsletter')) {
            await sock.sendPresenceUpdate('composing', jid);
            const typingTime = Math.min(4000, text.length * 20 + 1000);
            await new Promise(r => setTimeout(r, typingTime));
            await sock.sendPresenceUpdate('paused', jid);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        } else {
            // Newsletter එකකට යද්දී පොඩි විරාමයක් දීලා යවනවා
            await new Promise(r => setTimeout(r, 1500));
        }

        await sock.sendMessage(jid, { text });
        console.log(`✅ Anime news sent → ${jid}`);
    } catch (e) {
        console.error(`❌ Failed to send anime news → ${jid}:`, e.message);
    }
}

async function checkAnimeNews() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    if (!config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) return;

    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) return;

    const sock = sockets[0];

    try {
        console.log('🔍 Anime news: checking Anime Corner feed...');
        const feed = await parser.parseURL('https://animecorner.me/feed/');

        const newItems = feed.items.filter(item => {
            const guid = item.guid || item.link || item.title;
            return guid && !sentGuids.has(guid);
        });

        if (newItems.length === 0) return;

        console.log(`📰 Anime news: ${newItems.length} new article(s) found.`);

        // Process top 2 articles to avoid spamming
        for (const item of newItems.slice(0, 2)) {
            const title = item.title || 'No title';
            const link = item.link || '';
            
            // Extract and clean content
            let rawContent = item['content:encoded'] || item.content || item.contentSnippet || '';
            let cleanContent = rawContent.replace(/<[^>]*>?/gm, '');
            cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
            
            // 👇 Fix: සම්පූර්ණ news එකම ගන්න (අකුරු 4000ක් දක්වා) 👇
            const snippet = cleanContent.slice(0, 4000);
            const hasMore = cleanContent.length > 4000;

            // 👇 Fix: Footer එක inline code block එකක් ඇතුළේ 👇
            const message =
`📰 *Anime News Update*

*${title}*

${snippet}${hasMore ? '...' : ''}

🔗 ${link}

\`ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ADMIN_TEAM\``;

            for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
                await sendToJid(sock, jid, message);
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            }

            sentGuids.add(item.guid || item.link || item.title);
        }
    } catch (e) {
        console.error('❌ Anime news check error:', e.message);
    }
}

if (config.ANIME_NEWS && config.ANIME_NEWS.ENABLED) {
    const intervalMs = (config.ANIME_NEWS.INTERVAL_MINUTES || 30) * 60 * 1000;
    setTimeout(() => {
        checkAnimeNews();
        setInterval(checkAnimeNews, intervalMs);
    }, 15000);
    console.log('📰 Anime News Auto-Poster loaded. Interval:', config.ANIME_NEWS.INTERVAL_MINUTES, 'min');
}