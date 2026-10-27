const { cmd } = require('../command');
const fs = require('fs-extra');
const path = require('path');

const SHH_FILE = path.join(__dirname, '..', 'data', 'shh.json');

// ─── TAG ALL ───
cmd({
    pattern: "tagall",
    desc: "Tag all members in the group.",
    category: "group",
    react: "📢",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, groupMetadata, reply, q }) => {
    try {
        if (!isGroup) return reply('❌ මේක group එකක විතරයි පුළුවන්.');
        // if (!isAdmins) return reply('❌ මේක පාවිච්චි කරන්න admin කෙනෙක් වෙන්න ඕනේ.');

        const participants = groupMetadata.participants.map(p => p.id);
        const text = q ? q : 'Attention Everyone!';

        let message = `*📢 TAG ALL*\n\n*Message:* ${text}\n\n`;
        
        participants.forEach((p, index) => {
            message += `${index + 1}. @${p.split('@')[0]}\n`;
        });

        await conn.sendMessage(from, { 
            text: message, 
            mentions: participants 
        }, { quoted: mek });

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// ─── HIDE TAG ───
cmd({
    pattern: "hidetag",
    desc: "Tag all members without showing their names.",
    category: "group",
    react: "👻",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, groupMetadata, reply, q }) => {
    try {
        if (!isGroup) return reply('❌ මේක group එකක විතරයි පුළුවන්.');
        if (!isAdmins) return reply('❌ මේක පාවිච්චි කරන්න admin කෙනෙක් වෙන්න ඕනේ.');

        const participants = groupMetadata.participants.map(p => p.id);
        const text = q ? q : 'Attention Everyone!';

        await conn.sendMessage(from, { 
            text: text, 
            mentions: participants 
        }, { quoted: mek });

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});

// ─── SHH (Auto Delete) ───
cmd({
    pattern: "shh",
    desc: "Auto delete messages from a user or everyone.",
    category: "group",
    react: "🤫",
    filename: __filename
},
async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, reply, q, args, sender }) => {
    try {
        if (!isGroup) return reply('❌ මේක group එකක විතරයි පුළුවන්.');
        if (!isAdmins) return reply('❌ මේක පාවිච්චි කරන්න admin කෙනෙක් වෙන්න ඕනේ.');
        if (!isBotAdmins) return reply('❌ මට මැසේජ් delete කරන්න bot එක admin වෙන්න ඕනේ.');

        let targetJid = null;
        let action = null;

        // .shh on / .shh off (හැමෝටම)
        if (args[0] === 'on' || args[0] === 'off') {
            targetJid = 'ALL';
            action = args[0];
        } 
        // .shh @user on / .shh @user off
        else if (m.mentionUser && m.mentionUser.length > 0 && (args[1] === 'on' || args[1] === 'off')) {
            targetJid = m.mentionUser[0];
            action = args[1];
        }
        // reply කරලා .shh on / .shh off
        else if (m.quoted && (args[1] === 'on' || args[1] === 'off')) {
            targetJid = m.quoted.sender;
            action = args[1];
        }
        // .shh 94771234567 on / .shh 94771234567 off
        else if (args[0] && args[1] && (args[1] === 'on' || args[1] === 'off')) {
            const num = args[0].replace(/[^0-9]/g, '');
            if (num.length >= 9) {
                targetJid = `${num}@s.whatsapp.net`;
                action = args[1];
            }
        }

        if (!targetJid || !action) {
            return reply("🤫 *SHH COMMAND*\n\n*Usage:*\n`.shh on` (හැමෝගේම delete)\n`.shh off`\n`.shh @user on`\n`.shh @user off`\nහෝ user ගේ මැසේජ් එකකට reply කරලා `.shh on` කරන්න.");
        }

        // Database එක load කරගන්නවා
        let shhData = {};
        if (fs.existsSync(SHH_FILE)) {
            shhData = await fs.readJson(SHH_FILE);
        }

        if (!shhData[from]) shhData[from] = [];

        if (action === 'on') {
            if (!shhData[from].includes(targetJid)) {
                shhData[from].push(targetJid);
            }
            reply(`✅ SHH ON: ${targetJid === 'ALL' ? 'හැමෝගේම' : '@' + targetJid.split('@')[0] + ' ගේ'} මැසේජ් delete වේ.`);
        } else {
            shhData[from] = shhData[from].filter(id => id !== targetJid);
            reply(`✅ SHH OFF: ${targetJid === 'ALL' ? 'හැමෝගේම' : '@' + targetJid.split('@')[0] + ' ගේ'} මැසේජ් delete වීම නැවතුණා.`);
        }

        await fs.writeJson(SHH_FILE, shhData, { spaces: 2 });
        global.shhList = shhData; // pair.js එකට යන්න

    } catch (e) {
        console.log(e);
        reply(`❌ Error: ${e.message}`);
    }
});
// Load SHH List on startup
if (fs.existsSync(SHH_FILE)) {
    global.shhList = fs.readJsonSync(SHH_FILE);
}