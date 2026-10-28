// plugins/anime-news.js — Auto Anime News Broadcaster (Full Scrape + Image + Anti-Ban)
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const parser = new Parser({ timeout: 20000 });
const sentGuids = new Set();

// 👇 සම්පූර්ණ news එක සහ පින්තූරය Scrape කරන ෆන්ක්ෂන් එක 👇
async function getFullArticleData(url) {
    try {
        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });
        const $ = cheerio.load(data);
        
        // 1. ටෙක්ස්ට් එක ගන්නවා
        let text = $('.entry-content').text() || $('.article-content').text() || $('article').text();
        text = text.replace(/\s+/g, ' ').trim();
        
        // 2. ප්‍රධාන පින්තූරය ගන්නවා
        let image = $('meta[property="og:image"]').attr('content') || 
                    $('.entry-content img').first().attr('src') || 
                    null;
        
        return { text, image };
    } catch (e) {
        console.error('Scrape error:', e.message);
        return { text: null, image: null };
    }
}
// 👆 -------------------------------------------------- 👆

async function sendToJid(sock, jid, text, imageUrl) {
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

        // පින්තූරයක් තියෙනවා නම් ඒකත් එක්ක යවනවා, නැත්නම් ටෙක්ස්ට් එක විතරක් යවනවා
        if (imageUrl) {
            await sock.sendMessage(jid, { image: { url: imageUrl }, caption: text });
        } else {
            await sock.sendMessage(jid, { text: text });
        }
        
        console.log(`✅ Anime news sent → ${jid} ${imageUrl ? '(with image)' : ''}`);
    } catch (e) {
        console.error(`❌ Failed to send anime news → ${jid}:`, e.message);
        // පින්තූරය යැව්වට පස්සේ අවුලක් ආවොත් ආයේ ටෙක්ස්ට් විතරක් යවන්න try කරනවා
        if (imageUrl) {
            try { await sock.sendMessage(jid, { text: text }); } catch (err) {}
        }
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
            let imageUrl = null;

            // RSS එකේ තියෙන පින්තූරය (Enclosure) එක ගන්න try කරනවා
            if (item.enclosure && item.enclosure.url) {
                imageUrl = item.enclosure.url;
            }

            // කෙටි වෙලා තියෙනවා නම්, ලින්ක් එකට ගිහින් සම්පූර්ණ ටෙක්ස්ට් එක සහ පින්තූරය ගන්නවා
            if (content.includes('&hellip;') || content.includes('[...]') || content.length < 100 || !imageUrl) {
                console.log(`🔗 Scraping full article: ${link}`);
                const scrapedData = await getFullArticleData(link);
                
                if (scrapedData.text && scrapedData.text.length > content.length) {
                    content = scrapedData.text;
                }
                if (!imageUrl && scrapedData.image) {
                    imageUrl = scrapedData.image;
                }
            }

            // HTML tags සහ අමතර හිස් තැන් අයින් කරනවා
            let cleanContent = content.replace(/<[^>]*>?/gm, '');
            cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
            
            // WhatsApp limit එකට ගැලපෙන්න අකුරු 4000කට කපනවා
            const snippet = cleanContent.slice(0, 4000);
            const hasMore = cleanContent.length > 4000;

            // 👇 ඔයා ඉල්ලපු අලුත් Format එක 👇
            const backtick = String.fromCharCode(96);
            const footer = backtick + "ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ADMIN_TEAM" + backtick;

            let message = `✦ *${title}* ✦\n\n`;
            message += `📺 *Anime:* ${title}\n\n`;
            message += snippet + (hasMore ? '...' : '') + "\n\n";
            message += footer;
            // 👆 -------------------------------------------------- 👆

            for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
                await sendToJid(sock, jid, message, imageUrl);
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