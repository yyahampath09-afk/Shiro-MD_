// plugins/anime-calendar.js — Daily Anime Release Calendar (AniList API)
const axios = require('axios');
const cron = require('node-cron');
const config = require('../config');
const { cmd } = require('../command');

const CALENDAR_IMAGE_URL = 'https://files.catbox.moe/s39kdz.jpeg';

async function sendWithAntiBan(sock, jid, text, imageUrl = null, quoted = null) {
    try {
        if (!jid.endsWith('@newsletter')) {
            await sock.sendPresenceUpdate('composing', jid);
            const typingTime = Math.min(5000, text.length * 20 + 1000);
            await new Promise(r => setTimeout(r, typingTime));
            await sock.sendPresenceUpdate('paused', jid);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        } else {
            await new Promise(r => setTimeout(r, 1500));
        }

        const messageContent = imageUrl 
            ? { image: { url: imageUrl }, caption: text } 
            : { text };

        const options = quoted ? { quoted } : {};
        await sock.sendMessage(jid, messageContent, options);
        console.log(`✅ Calendar sent → ${jid} ${imageUrl ? '(with image)' : ''}`);
    } catch (e) {
        console.error(`❌ Failed to send calendar to ${jid}:`, e.message);
        if (imageUrl) {
            console.log('⚠️ Retrying without image...');
            try {
                await sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
            } catch (err) {
                console.error(`❌ Failed to send text only:`, err.message);
            }
        }
    }
}

async function getDailyAnimeText() {
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }); 
    
    // අද දවසේ පටන් ගන්නා සහ ඉවර වන වෙලාව (ශ්‍රී ලංකා වේලාවෙන්)
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    const startTs = Math.floor(startOfDay.getTime() / 1000);
    const endTs = Math.floor(endOfDay.getTime() / 1000);

    // 👇 AniList GraphQL Query 👇
    const query = `
    query ($start: Int, $end: Int) {
      Page(page: 1, perPage: 50) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          airingAt
          media {
            title {
              romaji
              english
            }
          }
        }
      }
    }
    `;

    try {
        console.log(`📡 Fetching AniList API...`); // 👈 ලොග් එකේ මේක පේන්න ඕනේ
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,
            variables: { start: startTs, end: endTs }
        }, { 
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        
        // ඩේටා ආවද නැද්ද කියලා ලොග් එකේ පෙන්නන්න
        console.log(`✅ AniList API Responded. Found ${response.data?.data?.Page?.airingSchedules?.length || 0} anime.`);

        const schedules = response.data.data.Page.airingSchedules;

        if (!schedules || schedules.length === 0) {
            return `❌ අද දිනයට (${dayName}) කිසිම anime එකක් හම්බුනේ නෑ.`;
        }

        let message = `╭━━━〔 📺 TODAY ANIME 〕━━━╮\n`;
        message += `┃ 📅 Day: ${dayName}\n`;
        message += `┃ 🎬 Total: ${schedules.length}\n`;
        message += `╰━━━━━━━━━━━━━━━━━━━━╯\n\n`;

        schedules.forEach((schedule, index) => {
            const title = schedule.media.title.english || schedule.media.title.romaji;
            
            // වෙලාව ශ්‍රී ලංකා වේලාවට (Asia/Colombo) හරවනවා
            const time = new Date(schedule.airingAt * 1000).toLocaleTimeString('en-US', { 
                timeZone: 'Asia/Colombo', 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: true 
            });

            message += `${index + 1}. ${title}\n`;
            message += `🕐 ${time}\n\n`;
        });

        message += `> ⚠️ මෙහි ඇති වේලාවන් සුළු වශයෙන් වෙනස් විය හැකිය. ⚠️\n`;
        message += `> ⚡ᴾᵒʷᵉʳᵉᵈ ᵇʸ ᴷⁱⁿᵍᴾᵒᵈᵈᵃᴹᵒᵈᶻ 𝙓 ᴵⁿᵒˢᵘᵏᵉ`;
        
        return message;

    } catch (error) {
        console.error('❌ AniList API Error:', error.message);
        return `❌ API එකෙන් දත්ත ගන්න බැරි වුණා. කරුණාකර පසුව උත්සාහ කරන්න.`;
    }
}

// 👇 COMMAND එක 👇
cmd({
    pattern: "todayanime",
    alias: ["animetoday", "calendar"],
    desc: "Get today's anime release schedule.",
    category: "anime",
    react: "📺",
    filename: __filename
},
async (conn, mek, m, { from, reply }) => {
    try {
        await reply("⏳ පොඩ්ඩක් ඉන්න, අද එන anime ලිස්ට් එක හොයාගන්නම්...");
        const text = await getDailyAnimeText();
        await conn.sendMessage(from, { 
            image: { url: CALENDAR_IMAGE_URL }, 
            caption: text 
        }, { quoted: mek });
    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// 👇 AUTO (හැම දවසකම රෑ 12:00 ට) 👇
async function sendDailyAnimeCalendarAuto() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) return;
    
    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) return;
    const sock = sockets[0];

    try {
        console.log(`📅 Fetching auto anime releases for today...`);
        const text = await getDailyAnimeText();

        for (const jid of config.ANIME_NEWS.TARGET_JIDS) {
            await sendWithAntiBan(sock, jid, text, CALENDAR_IMAGE_URL);
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000)); 
        }
        console.log(`✅ Auto Calendar sent successfully.`);
    } catch (e) {
        console.error('❌ Anime Calendar Auto Error:', e.message);
    }
}

cron.schedule('0 0 * * *', () => {
    console.log('⏰ Running daily anime calendar task...');
    sendDailyAnimeCalendarAuto();
}, {
    timezone: "Asia/Colombo"
});

console.log('📅 Anime Calendar Loaded (AniList API | Command: .todayanime | Auto: 00:00 AM).');