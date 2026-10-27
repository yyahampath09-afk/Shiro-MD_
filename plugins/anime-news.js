// plugins/anime-news.js — Auto Anime News Broadcaster
const Parser = require('rss-parser');
const config = require('../config');

const parser = new Parser({
    timeout: 20000,
});

// කලින් යවපු articles මතක තියාගන්න set එකක්
const sentGuids = new Set();

// ─── Helper: JID එකට message එක යවන්න ───
async function sendToJid(sock, jid, text) {
    try {
        await sock.sendMessage(jid, { text });
        console.log(`✅ Anime news sent → ${jid}`);
    } catch (e) {
        console.error(`❌ Failed to send anime news → ${jid}:`, e.message);
    }
}

// ─── Main function: news check + broadcast ───
async function checkAnimeNews() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    if (!config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) return;

    // Active socket එකක් තියෙනවද බලන්න
    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) {
        console.log('⏳ Anime news: No active socket yet, skipping.');
        return;
    }

    const sock = sockets[0]; // පළවෙනි active session එක පාවිච්චි කරනවා

    try {
        console.log('🔍 Anime news: checking feed...');
        const feed = await parser.parseURL(config.ANIME_NEWS.RSS_URL);

        // අලුත් articles විතරක් filter කරන්න
        const newItems = feed.items.filter(item => {
            const guid = item.guid || item.link || item.title;
            return guid && !sentGuids.has(guid);
        });

        if (newItems.length === 0) {
            console.log('📭 Anime news: no new articles.');
            return;
        }

        console.log(`📰 Anime news: ${newItems.length} new article(s) found.`);

        // හැම article එකක්ම හැම target එකකටම යවන්න
        for (const item of newItems.slice(0, 3)) { // එකපාරට max 3ක් (spam නොවෙන්න)
            const title = item.title || 'No title';
            const link = item.link || '';
            const pubDate = item.pubDate ? new Date(item.pubDate).toLocaleString('en-US', { timeZone: 'Asia/Colombo' }) : '';
            const snippet = (item.contentSnippet || item.content || '').slice(0, 250);

            const message =
`📰 *Anime News Update*

*${title}*

${snippet}${snippet.length >= 250 ? '...' : ''}

🔗 ${link}
🕒 ${pubDate}`;

            for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
                await sendToJid(sock, jid, message);
                await new Promise(r => setTimeout(r, 1500)); // rate-limit එකට delay එකක්
            }

            sentGuids.add(item.guid || item.link || item.title);
        }
    } catch (e) {
        console.error('❌ Anime news check error:', e.message);
    }
}

// ─── Interval එක පටන් ගන්න ───
if (config.ANIME_NEWS && config.ANIME_NEWS.ENABLED) {
    const intervalMs = (config.ANIME_NEWS.INTERVAL_MINUTES || 30) * 60 * 1000;

    // Bot start වුණාට පස්සේ first check එකට ටිකක් ඉන්න
    setTimeout(() => {
        checkAnimeNews();
        setInterval(checkAnimeNews, intervalMs);
    }, 15000); // 15 seconds

    console.log('📰 Anime News Auto-Poster loaded. Interval:', config.ANIME_NEWS.INTERVAL_MINUTES, 'min');
}