// plugins/anime-news.js — Auto Anime News Broadcaster (Anime Corner Source + Anti-Ban)
const Parser = require('rss-parser');
const config = require('../config');

const parser = new Parser({
    timeout: 20000,
});

const sentGuids = new Set();

// 👇 Anti-Ban System for Anime News 👇
async function sendToJid(sock, jid, text) {
    try {
        // 1. Typing Simulation
        await sock.sendPresenceUpdate('composing', jid);
        
        // ටෙක්ස්ට් එකේ දිග අනුව ටයිප් කරන වෙලාව තීරණය කරනවා (උපරිම තත්පර 4)
        const typingTime = Math.min(4000, text.length * 30 + 1000);
        await new Promise(r => setTimeout(r, typingTime));
        
        // Typing නවත්තනවා
        await sock.sendPresenceUpdate('paused', jid);
        
        // යවන්න කලින් තව ටිකක් ඉන්නවා
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

        // 2. Send Message
        await sock.sendMessage(jid, { text });
        console.log(`✅ Anime news sent → ${jid}`);
    } catch (e) {
        console.error(`❌ Failed to send anime news → ${jid}:`, e.message);
    }
}
// 👆 --------------------------------- 👆

async function checkAnimeNews() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    if (!config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) return;

    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) {
        console.log('⏳ Anime news: No active socket yet, skipping.');
        return;
    }

    const sock = sockets[0];

    try {
        console.log('🔍 Anime news: checking Anime Corner feed...');
        // Anime Corner RSS Feed URL
        const feed = await parser.parseURL('https://animecorner.me/feed/');

        const newItems = feed.items.filter(item => {
            const guid = item.guid || item.link || item.title;
            return guid && !sentGuids.has(guid);
        });

        if (newItems.length === 0) {
            console.log('📭 Anime news: no new articles.');
            return;
        }

        console.log(`📰 Anime news: ${newItems.length} new article(s) found.`);

        // එකවර උපරිම ප්‍රවෘත්ති 2ක් යවමු (දිග වැඩි නිසා)
        for (const item of newItems.slice(0, 2)) {
            const title = item.title || 'No title';
            const link = item.link || '';
            
            // වැඩිපුර විස්තර ලබා ගැනීම සහ HTML ඉවත් කිරීම
            let rawContent = item['content:encoded'] || item.content || item.contentSnippet || '';
            let cleanContent = rawContent.replace(/<[^>]*>?/gm, '');
            cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
            
            // විස්තරයේ අක්ෂර 800ක් දක්වා ලබා ගැනීම
            const snippet = cleanContent.slice(0, 800);
            const hasMore = cleanContent.length > 800;

            // 👇 Footer එක එකතු කිරීම 👇
            const message =
`📰 *Anime News Update*

*${title}*

${snippet}${hasMore ? '...' : ''}

🔗 ${link}

ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ADMIN_TEAM`;
            // 👆 -------------------- 👆

            for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
                await sendToJid(sock, jid, message);
                
                // එක news එකකට අනික යද්දී තත්පර 2-5ක් අතර අහඹු විරාමයක් (Anti-Spam)
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