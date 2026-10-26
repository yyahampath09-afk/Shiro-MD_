const config = require('../config')
const { cmd } = require('../command')
const { runtime } = require('../lib/functions')

function fancy(text) {
    const small = {
        'A': 'ᴀ', 'B': 'ʙ', 'C': 'ᴄ', 'D': 'ᴅ', 'E': 'ᴇ', 'F': 'ғ', 'G': 'ɢ', 'H': 'ʜ', 'I': 'ɪ', 'J': 'ᴊ', 'K': 'ᴋ', 'L': 'ʟ', 'M': 'ᴍ', 'N': 'ɴ', 'O': 'ᴏ', 'P': 'ᴘ', 'Q': 'ǫ', 'R': 'ʀ', 'S': 's', 'T': 'ᴛ', 'U': 'ᴜ', 'V': 'ᴠ', 'W': 'ᴡ', 'X': 'x', 'Y': 'ʏ', 'Z': 'ᴢ',
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
    };
    const bold = {
        'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
        'a': '𝐀', 'b': '𝐁', 'c': '𝐂', 'd': '𝐃', 'e': '𝐄', 'f': '𝐅', 'g': '𝐆', 'h': '𝐇', 'i': '𝐈', 'j': '𝐉', 'k': '𝐊', 'l': '𝐋', 'm': '𝐌', 'n': '𝐍', 'o': '𝐎', 'p': '𝐏', 'q': '𝐐', 'r': '𝐑', 's': '𝐒', 't': '𝐓', 'u': '𝐔', 'v': '𝐕', 'w': '𝐖', 'x': '𝐗', 'y': '𝐘', 'z': '𝐙'
    };

    return text.split(' ').map(word => {
        if (word.length === 0) return '';
        let first = bold[word[0].toUpperCase()] || word[0];
        let rest = word.slice(1).split('').map(c => small[c] || c).join('');
        return first + rest;
    }).join(' ');
}

cmd({
    pattern: "menu2",
    alias: ["allmenu", "fullmenu", "menu"],
    use: '.menu2',
    desc: "Show all bot commands",
    category: "menu",
    react: "😻",
    filename: __filename
},
async (conn, mek, m, { from, pushname, reply }) => {
    try {
        let dec = `
╭──〔 🚀 ${config.BOT_NAME} 〕──╮
┃
┃ 👑 ${fancy('Owner')} : ${config.OWNER_NAME}
┃ 🤖 ${fancy('Bot Name')} : ${config.BOT_NAME}
┃ ⚙️ ${fancy('Prefix')} : [${config.PREFIX}]
┃ 🌐 ${fancy('Platform')} : 𝐇ᴇʀᴏᴋᴜ
┃ 📦 ${fancy('Version')} : 1.0.0
┃ ⏰ ${fancy('Runtime')} : ${runtime(process.uptime())}
┃ 👤 ${fancy('User')} : ${pushname}
┃
╰───────────────╯

╭━━━〔 👥 ${fancy('Group Menu')} 〕━━━┈⊷
┃◈╭───────────·๏
┃◈┃• ➕ ${fancy('Add')} | ➖ ${fancy('Remove')}
┃◈┃• 🔼 ${fancy('Promote')} | 🔽 ${fancy('Demote')}
┃◈┃• 👋 ${fancy('Setwelcome')} | ${fancy('Setgoodbye')}
┃◈┃• 🖼️ ${fancy('Getpic')}
┃◈╰───────────┈⊷
╰━━━━━━━━━━━━━━━┈⊷

╭━━━〔 ⚡ ${fancy('Main Menu')} 〕━━━┈⊷
┃◈╭───────────·๏
┃◈┃• 🏓 ${fancy('Ping')} | 🚀 ${fancy('Speed')}
┃◈┃• 💚 ${fancy('Alive')} | ⏱️ ${fancy('Runtime')}
┃◈┃• 📦 ${fancy('Repo')} | 👑 ${fancy('Owner')}
┃◈╰───────────┈⊷
╰━━━━━━━━━━━━━━━┈⊷

> ${config.DESCRIPTION}
`;

        await conn.sendMessage(
            from,
            {
                image: { url: config.MENU_IMAGE_URL },
                caption: dec,
                contextInfo: {
                    mentionedJid: [m.sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363400734168271@newsletter',
                        newsletterName: config.BOT_NAME,
                        serverMessageId: 143
                    }
                }
            },
            { quoted: mek }
        );

    } catch (e) {
        console.log(e);
        reply(`❌ ${fancy('Error')} : ${e.message || e}`);
    }
});

// ─── Simple ping ───
cmd({
    pattern: "ping",
    desc: "Check bot latency",
    category: "main",
    react: "🏓",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    const start = Date.now();
    await reply(`🏓 Pong! *${Date.now() - start}ms*`);
});

// ─── Runtime ───
cmd({
    pattern: "runtime",
    alias: ["uptime"],
    desc: "Show bot uptime",
    category: "main",
    react: "⏱️",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    await reply(`⏱️ Runtime: *${runtime(process.uptime())}*`);
});