const { cmd } = require('../command');
const fs = require('fs-extra');
const path = require('path');

const SUDO_FILE = path.join(__dirname, '..', 'data', 'sudo.json');

// Load sudo list on startup
if (fs.existsSync(SUDO_FILE)) {
    try {
        global.sudoList = fs.readJsonSync(SUDO_FILE);
    } catch (e) {
        global.sudoList = [];
    }
} else {
    global.sudoList = [];
    if (!fs.existsSync(path.dirname(SUDO_FILE))) {
        fs.mkdirSync(path.dirname(SUDO_FILE), { recursive: true });
    }
    fs.writeJsonSync(SUDO_FILE, []);
}

// 👇 SUDO ADD COMMAND 👇
cmd({
    pattern: "addsudo",
    desc: "Add a user to sudo list (Owner only).",
    category: "owner",
    react: "✅",
    filename: __filename
},
async (conn, mek, m, { reply, isOwner }) => {
    try {
        if (!isOwner) return reply('❌ Owner ට විතරයි මේක කරන්න පුළුවන්.');

        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        
        if (!targetJid) return reply('❌ කරුණාකර කෙනෙක්ගේ මැසේජ් එකකට reply කරන්න හෝ tag කරන්න.');

        const cleanNumber = targetJid.split('@')[0];
        const formattedJid = `${cleanNumber}@s.whatsapp.net`;

        if (!global.sudoList.includes(formattedJid)) {
            global.sudoList.push(formattedJid);
            await fs.writeJson(SUDO_FILE, global.sudoList, { spaces: 2 });
            reply(`✅ @${cleanNumber} සාර්ථකව sudo ලැයිස්තුවට එකතු කළා. දැන් එයාට bot පාවිච්චි කරන්න පුළුවන්.`);
        } else {
            reply(`⚠️ @${cleanNumber} දැනටමත් sudo ලැයිස්තුවේ ඉන්නවා.`);
        }

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// 👇 SUDO DELETE COMMAND 👇
cmd({
    pattern: "delsudo",
    desc: "Remove a user from sudo list (Owner only).",
    category: "owner",
    react: "❌",
    filename: __filename
},
async (conn, mek, m, { reply, isOwner }) => {
    try {
        if (!isOwner) return reply('❌ Owner ට විතරයි මේක කරන්න පුළුවන්.');

        let targetJid = null;
        if (m.quoted) targetJid = m.quoted.sender;
        else if (m.mentionUser && m.mentionUser.length > 0) targetJid = m.mentionUser[0];
        
        if (!targetJid) return reply('❌ කරුණාකර කෙනෙක්ගේ මැසේජ් එකකට reply කරන්න හෝ tag කරන්න.');

        const cleanNumber = targetJid.split('@')[0];

        global.sudoList = global.sudoList.filter(jid => jid.split('@')[0] !== cleanNumber);
        await fs.writeJson(SUDO_FILE, global.sudoList, { spaces: 2 });
        reply(`✅ @${cleanNumber} sudo ලැයිස්තුවෙන් ඉවත් කළා.`);

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});