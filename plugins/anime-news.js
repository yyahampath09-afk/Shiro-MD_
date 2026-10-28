// plugins/anime-news.js — Auto Anime News Broadcaster (Full Scrape + Anti-Ban)
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const parser = new Parser({ timeout: 20000 });
const sentGuids = new Set();

// 👇 සම්පූර්ණ news එක Scrape කරන ෆන්ක්ෂන් එක 👇
async function getFullArticleText(url) {
    try {
        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });
        const $ = cheerio.load(data);
        
        // Anime Corner එකේ ප්‍රධාන ටෙක්ස්ට් එක තියෙන තැන
        let text = $('.entry-content').text() || $('.article-content').text() || $('article').text();
        text = text.replace(/\s+/g, ' ').trim(); // අමතර හිස් තැන් අයින් කිරීම
        
        return text;
    } catch (e) {
        console.error('Scrape error:', e.message);
        return null;
    }
}
// 👆 -------------------------------------------------- 👆

async function sendToJid(sock, jid, text) {
    try {
        if (!jid.endsWith('@newsletter')) {
            await sock.sendPresenceUpdate('composing', jid);
            const typingTime = Math.min(4000, text.length * 20 + 1000);
            await new Promise(r => setTimeout(r, typingTime));
            await sock.sendPresenceUpdate('paused', jid);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        } else {
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

        for (const item of newItems.slice(0, 2)) {
            const title = item.title || 'No title';
            const link = item.link || '';
            
            let content = item.contentSnippet || item.content || '';
            
            // 👇 Feed එකේ කෙටි වෙලා තියෙනවා නම්, ලින්ක් එකට ගිහින් සම්පූර්ණ ටෙක්ස්ට් එක ගන්නවා 👇
            if (content.includes('&hellip;') || content.includes('[...]') || content.length < 100) {
                console.log(`🔗 Scraping full article: ${link}`);
                const fullText = await getFullArticleText(link);
                if (fullText && fullText.length > content.length) {
                    content = fullText;
                }
            }

            // HTML tags සහ අමතර හිස් තැන් අයින් කරනවා
            let cleanContent = content.replace(/<[^>]*>?/gm, '');
            cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
            
            // WhatsApp limit එකට ගැලපෙන්න අකුරු 4000කට කපනවා
            const snippet = cleanContent.slice(0, 4000);
            const hasMore = cleanContent.length > 4000;

            // 👇 Syntax error එක එන්නේ නැති වෙන්න String.fromCharCode පාවිච්චි කළා 👇
            const backtick = String.fromCharCode(96); // මේකෙන් ` ලකුණ හැදෙනවා
            const footer = `${backtick}ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ADMIN_TEAM${backtick}`;

            const message = 

*${title}*

${snippet}${hasMore ? '...' : ''}


${footer}`;

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