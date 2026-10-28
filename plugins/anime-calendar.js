// plugins/anime-calendar.js — Daily Anime Release Calendar (Command + Auto + Image)
const axios = require('axios');
const cron = require('node-cron');
const config = require('../config');
const { cmd } = require('../command');

// යැවිය යුතු පින්තූරයේ URL එක
const CALENDAR_IMAGE_URL = 'https://files.catbox.moe/s39kdz.jpeg';

// Anti-Ban සහිතව මැසේජ් යවන ශ්‍රිතය (පින්තූරය සමඟ)
async function sendWithAntiBan(sock, jid, text, imageUrl = null, quoted = null) {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        const typingTime = Math.min(5000, text.length * 20 + 1000);
        await new Promise(r => setTimeout(r, typingTime));
        await sock.sendPresenceUpdate('paused', jid);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        
        const messageContent = imageUrl 
            ? { image: { url: imageUrl }, caption: text } 
            : { text };

        const options = quoted ? { quoted } : {};
        await sock.sendMessage(jid, messageContent, options);
        console.log(`✅ Calendar sent → ${jid} ${imageUrl ? '(with image)' : ''}`);
    } catch (e) {
        console.error(`❌ Failed to send calendar to ${jid}:`, e.message);
        
        // පින්තූරය සමඟ ගැටලුවක් ඇත්නම්, පෙළ පමණක් යැවීමට උත්සාහ කරන්න
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

// දිනපතා anime ලැයිස්තුව ලබාගෙන පෙළ සකස් කරන ශ්‍රිතය
async function getDailyAnimeText() {
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase(); 
    const displayDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    
    const response = await axios.get(`https://api.jikan.moe/v4/schedules?filter=${dayName}&sfw=true`);
    const animeList = response.data.data;

    if (!animeList || animeList.length === 0) {
        return `❌ අද දිනයට (${displayDay}) කිසිම anime එකක් හම්බුනේ නෑ.`;
    }

    const maxAnime = 30;
    const displayedList = animeList.slice(0, maxAnime);

    let message = `╭━━━〔 📺 TODAY ANIME 〕━━━╮\n`;
    message += `┃ 📅 Day: ${displayDay}\n`;
    message += `┃ 🎬 Total: ${displayedList.length}\n`;
    message += `╰━━━━━━━━━━━━━━━━━━━━╯\n\n`;

    displayedList.forEach((anime, index) => {
        const title = anime.title;
        let time = anime.broadcast?.string || 'TBA';
        if (anime.broadcast && anime.broadcast.time) {
            time = anime.broadcast.time;
        } else if (time.includes('at ')) {
            time = time.split('at ')[1].replace(' (JST)', '');
        }

        if (time.match(/^\d{2}:\d{2}$/)) {
            let [hours, minutes] = time.split(':');
            hours = parseInt(hours);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            time = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
        }

        message += `${index + 1}. ${title}\n`;
        message += `🕐 ${time}\n\n`;
    });

    if (animeList.length > maxAnime) {
        message += `_...සහ තවත් ${animeList.length - maxAnime}ක් තියෙනවා._\n\n`;
    }

    message += `> ⚠️ මෙහි ඇති වේලාවන් සුළු වශයෙන් වෙනස් විය හැකිය. ⚠️\n`;
    message += `> ⚡ᴾᵒʷᵉʳᵉᵈ ᵇʸ ᴷⁱⁿᵍᴾᵒᵈᵈᵃᴹᵒᵈᶻ 𝙓 ᴵⁿᵒˢᵘᵏᵉ`;
    
    return message;
}

// 👇 COMMAND එක (ඕන වෙලාවක ගහලා බලන්න) 👇
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
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.TARGET_JIDS || config.ANIME_NEWS.TARGET_JIDS.length === 0) {
        return;
    }
    
    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) {
        console.log('⏳ No active socket yet, skipping calendar.');
        return;
    }
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

console.log('📅 Anime Calendar Loaded (Command: .todayanime | Auto: 00:00 AM | Image: Enabled).');