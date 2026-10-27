// plugins/gf-manage.js — GF Management Commands
const { cmd } = require('../command');
const { GIRLFRIENDS, LEVELS } = require('../lib/gf-constants');
const gfDb = require('../lib/gf-db');
const { validateSleep } = require('../lib/gf-sleep');

const MAX_HAREM = 5;
const MOOD_EMOJIS = {
    happy: '😊', sad: '😢', shy: '😳', angry: '😠',
    jealous: '😒', sleepy: '😴', neutral: '😐',
};

// ═══ .start — GF Selection Menu ═══
cmd({
    pattern: "start",
    alias: ["gfm", "gfmenu"],
    desc: "Choose your girlfriend",
    category: "gf",
    react: "💕",
    filename: __filename,
},
async (conn, mek, m, { sender, reply }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);

        let text = `💕 *GF Selection Menu*\n\n`;
        let i = 1;
        for (const [key, gf] of Object.entries(GIRLFRIENDS)) {
            text += `${i}. ${gf.emoji} *${gf.name}* _(${gf.type})_\n   ${gf.desc}\n\n`;
            i++;
        }
        text += `*How to pick:*\n`;
        text += `→ \`.setgf <name>\`  (e.g. \`.setgf taiga\`)\n`;
        text += `→ or just chat: \`/<name> <message>\`\n`;

        if (user && user.activeGF) {
            const cur = GIRLFRIENDS[user.activeGF];
            text += `\n✅ *Active:* ${cur?.emoji || ''} ${cur?.name || user.activeGF}`;
        }
        await reply(text);
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .setgf <name> ═══
cmd({
    pattern: "setgf",
    alias: ["choosegf", "pick"],
    desc: "Set active girlfriend",
    category: "gf",
    react: "🎯",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q, pushname }) => {
    try {
        const phone = sender.split('@')[0];
        const name = (q || '').trim().toLowerCase();
        if (!name) return reply('Usage: `.setgf <name>` (e.g. `.setgf taiga`)');
        if (!GIRLFRIENDS[name]) return reply(`❌ "${name}" කියලා GF කෙනෙක් නෑ. \`.start\` බලන්න.`);

        let user = await gfDb.getUser(phone);
        if (!user) {
            await gfDb.saveUser(phone, {
                name: pushname || 'User',
                onboarded: true,
                activeGF: name,
                harem: [name],
                gfWakeTime: null,
                gfSleepTime: null,
                chatCount: 0,
                createdAt: new Date().toISOString(),
            });
        } else {
            const harem = user.harem || [];
            if (!harem.includes(name)) {
                if (harem.length >= MAX_HAREM) {
                    return reply(`❌ Max ${MAX_HAREM} GFs. \`.removegf <name>\` කරන්න.`);
                }
                harem.push(name);
            }
            await gfDb.updateUser(phone, { activeGF: name, harem });
        }

        const rel = await gfDb.getRelationship(phone, name);
        if (!rel) await gfDb.createRelationship(phone, name);

        const gf = GIRLFRIENDS[name];
        await reply(
            `${gf.emoji} *${gf.name}* දැන් ඔයාගේ GF!\n\n` +
            `_${gf.desc}_\n\nChat: \`/${name} <message>\``
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .mygf ═══
cmd({
    pattern: "mygf",
    alias: ["currentgf", "gf"],
    desc: "Show current girlfriend",
    category: "gf",
    react: "💖",
    filename: __filename,
},
async (conn, mek, m, { sender, reply }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user || !user.activeGF) {
            return reply('❌ තාම GF කෙනෙක් නෑ. `.start` ගහන්න.');
        }

        const gf = GIRLFRIENDS[user.activeGF];
        const rel = await gfDb.getRelationship(phone, user.activeGF);
        const lo = LEVELS.filter(l => (rel?.xp || 0) >= l.xp).pop() || LEVELS[0];

        await reply(
            `${gf.emoji} *Your GF: ${gf.name}*\n` +
            `_Type: ${gf.type}_\n_${gf.desc}_\n\n` +
            `📊 Level: *${lo.level}* (${lo.title}) ${lo.emoji}\n` +
            `✨ XP: *${rel?.xp || 0}*\n` +
            `💬 Chats: *${rel?.chatCount || 0}*\n` +
            `😊 Mood: ${MOOD_EMOJIS[rel?.mood || 'neutral']} *${rel?.mood || 'neutral'}*\n\n` +
            `Chat: \`/${user.activeGF} <message>\``
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .profile ═══
cmd({
    pattern: "profile",
    alias: ["me"],
    desc: "Show full profile",
    category: "gf",
    react: "👤",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, pushname }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ ඔයා onboard වෙලා නෑ. `.start` ගහන්න.');

        const rels = await gfDb.getAllRelationships(phone);
        let text = `👤 *${user.name || pushname}*\n📱 ${phone}\n\n`;

        if (user.activeGF) {
            const gf = GIRLFRIENDS[user.activeGF];
            text += `⭐ Active: ${gf?.emoji} *${gf?.name}*\n`;
        }
        text += user.gfWakeTime && user.gfSleepTime
            ? `😴 Sleep: ${user.gfSleepTime} → ${user.gfWakeTime} (5h)\n`
            : `😴 Sleep: Not set (\`.sleeptime HH:MM HH:MM\`)\n`;

        text += `\n*Girlfriends (${rels.length}):*\n`;
        for (const r of rels) {
            const gf = GIRLFRIENDS[r.gfName];
            if (!gf) continue;
            const lo = LEVELS.filter(l => (r.xp || 0) >= l.xp).pop() || LEVELS[0];
            text += `${gf.emoji} *${gf.name}* — Lv.${lo.level} ${lo.emoji} | XP:${r.xp || 0} | ${MOOD_EMOJIS[r.mood || 'neutral']} ${r.mood || 'neutral'}\n`;
        }
        text += `\n💬 Total chats: *${user.chatCount || 0}*`;
        await reply(text);
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .breakup ═══
cmd({
    pattern: "breakup",
    desc: "Break up with current GF",
    category: "gf",
    react: "💔",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user || !user.activeGF) return reply('❌ ඔයාට GF කෙනෙක් නෑ.');

        const args = (q || '').trim().toLowerCase();
        const gf = GIRLFRIENDS[user.activeGF];

        if (args !== 'confirm') {
            return reply(
                `💔 *${gf?.name}* එක්ක ඇත්තටම breakup කරන්නද?\n\n` +
                `තහවුරු කරන්න: \`.breakup confirm\``
            );
        }

        const harem = (user.harem || []).filter(g => g !== user.activeGF);
        const newActive = harem[0] || null;

        await gfDb.updateUser(phone, { activeGF: newActive, harem });
        await gfDb.deleteRelationship(phone, user.activeGF);

        await reply(
            `💔 *${gf?.name}* එක්ක breakup කළා.\n\n` +
            (newActive
                ? `Active GF දැන් *${GIRLFRIENDS[newActive]?.name}*`
                : '`.start` ගහලා අලුත් කෙනෙක් තෝරගන්න.')
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .sleeptime <wake> <sleep> ═══
cmd({
    pattern: "sleeptime",
    alias: ["setsleep"],
    desc: "Set 5-hour sleep window",
    category: "gf",
    react: "😴",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const parts = (q || '').trim().split(/\s+/);
        if (parts.length < 2) {
            return reply(
                `😴 *Sleep Setup*\n\n` +
                `Usage: \`.sleeptime <wake> <sleep>\`\n` +
                `Example: \`.sleeptime 06:00 01:00\`\n` +
                `_→ wakes at 6:00 AM, sleeps at 1:00 AM (5 hours)_`
            );
        }

        const [wake, sleep] = parts;
        const v = validateSleep(wake, sleep);
        if (!v.valid) {
            if (v.reason === 'invalid_format') {
                return reply('❌ Time format වැරදි. Use `HH:MM` (e.g. `06:00`)');
            }
            if (v.reason === 'not_5_hours') {
                return reply(`❌ හරියටම පැය 5ක් වෙන්න ඕනේ. ඔයා දුන්නේ ${v.hours}h.`);
            }
            return reply('❌ Invalid sleep times.');
        }

        await gfDb.updateUser(phone, { gfWakeTime: wake, gfSleepTime: sleep });
        await reply(
            `😴 Sleep set!\n\n` +
            `Sleep: *${sleep}* → Wake: *${wake}* (5h)\n\n` +
            `Sleep වෙලාවට GF auto reply කරයි. Disable කරන්න \`.wakeup\` ගහන්න.`
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .wakeup ═══
cmd({
    pattern: "wakeup",
    alias: ["wake"],
    desc: "Disable sleep mode",
    category: "gf",
    react: "☀️",
    filename: __filename,
},
async (conn, mek, m, { sender, reply }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ ඔයා onboard වෙලා නෑ.');
        await gfDb.updateUser(phone, { gfWakeTime: null, gfSleepTime: null });
        await reply('☀️ Wake up! Sleep mode disabled.\n\nSet again: `.sleeptime <wake> <sleep>`');
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .level ═══
cmd({
    pattern: "level",
    alias: ["lvl"],
    desc: "Show GF level progress",
    category: "gf",
    react: "⬆️",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ Onboard වෙලා නෑ. `.start` ගහන්න.');

        const gfName = (q || user.activeGF || '').trim().toLowerCase();
        if (!gfName || !GIRLFRIENDS[gfName]) {
            return reply('❌ Use `.level <gfname>` or set active with `.setgf`');
        }

        const rel = await gfDb.getRelationship(phone, gfName);
        if (!rel) return reply(`❌ *${gfName}* එක්ක relationship නෑ.`);

        const gf = GIRLFRIENDS[gfName];
        const lo = LEVELS.filter(l => (rel.xp || 0) >= l.xp).pop() || LEVELS[0];
        const nextLo = LEVELS.find(l => l.xp > (rel.xp || 0));

        let bar;
        if (nextLo) {
            const prog = (rel.xp - lo.xp) / (nextLo.xp - lo.xp);
            const filled = Math.max(0, Math.min(10, Math.round(prog * 10)));
            bar = '█'.repeat(filled) + '░'.repeat(10 - filled) + `  ${Math.round(prog * 100)}%`;
        } else {
            bar = '██████████  MAX';
        }

        await reply(
            `${gf.emoji} *${gf.name}* — Level ${lo.level} ${lo.emoji}\n` +
            `_${lo.title}_\n\n` +
            `XP: *${rel.xp || 0}*${nextLo ? ` / ${nextLo.xp}` : ''}\n` +
            `\`[${bar}]\`\n\n` +
            (nextLo
                ? `Next: *${nextLo.title}* ${nextLo.emoji}`
                : '🏆 *MAX LEVEL!*')
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .mood ═══
cmd({
    pattern: "mood",
    desc: "Show current GF mood",
    category: "gf",
    react: "😊",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ Onboard වෙලා නෑ.');

        const gfName = (q || user.activeGF || '').trim().toLowerCase();
        if (!gfName || !GIRLFRIENDS[gfName]) return reply('❌ GF name එකක් දෙන්න.');

        const rel = await gfDb.getRelationship(phone, gfName);
        if (!rel) return reply(`❌ *${gfName}* එක්ක relationship නෑ.`);

        const gf = GIRLFRIENDS[gfName];
        const mood = rel.mood || 'neutral';
        await reply(`${gf.emoji} *${gf.name}*'s mood: ${MOOD_EMOJIS[mood]} *${mood}*`);
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .harem ═══
cmd({
    pattern: "harem",
    alias: ["mygfs", "allgf"],
    desc: "Show all girlfriends",
    category: "gf",
    react: "💞",
    filename: __filename,
},
async (conn, mek, m, { sender, reply }) => {
    try {
        const phone = sender.split('@')[0];
        const user = await gfDb.getUser(phone);
        if (!user || !user.harem || user.harem.length === 0) {
            return reply('❌ තාම GF කෙනෙක් නෑ. `.start` ගහන්න.');
        }

        let text = `💞 *Your Harem (${user.harem.length}/${MAX_HAREM})*\n\n`;
        for (const gk of user.harem) {
            const gf = GIRLFRIENDS[gk];
            if (!gf) continue;
            const rel = await gfDb.getRelationship(phone, gk);
            const lo = LEVELS.filter(l => (rel?.xp || 0) >= l.xp).pop() || LEVELS[0];
            const active = (gk === user.activeGF) ? ' ⭐' : '';
            text += `${gf.emoji} *${gf.name}*${active}\n   Lv.${lo.level} ${lo.emoji} | XP:${rel?.xp || 0} | ${MOOD_EMOJIS[rel?.mood || 'neutral']} ${rel?.mood || 'neutral'}\n`;
        }
        text += `\n⭐ = Active\nChat: \`/<gfname> <msg>\``;
        await reply(text);
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .addgf <name> ═══
cmd({
    pattern: "addgf",
    alias: ["addtoharem"],
    desc: "Add a GF to harem",
    category: "gf",
    react: "➕",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const name = (q || '').trim().toLowerCase();
        if (!name) return reply('Usage: `.addgf <name>` (e.g. `.addgf kurumi`)');
        if (!GIRLFRIENDS[name]) return reply(`❌ "${name}" නෑ. \`.start\` බලන්න.`);

        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ මුලින්ම `.start` ගහන්න.');

        const harem = user.harem || [];
        if (harem.includes(name)) {
            return reply(`ℹ️ *${GIRLFRIENDS[name].name}* දැනටමත් harem එකේ.`);
        }
        if (harem.length >= MAX_HAREM) {
            return reply(`❌ Max ${MAX_HAREM} GFs. \`.removegf <name>\` කරන්න.`);
        }

        harem.push(name);
        await gfDb.updateUser(phone, { harem });
        await gfDb.createRelationship(phone, name);

        await reply(
            `➕ *${GIRLFRIENDS[name].name}* harem එකට එකතු වුණා!\n\n` +
            `Harem: ${harem.length}/${MAX_HAREM} 💞`
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});

// ═══ .removegf <name> ═══
cmd({
    pattern: "removegf",
    alias: ["removefromharem"],
    desc: "Remove a GF from harem",
    category: "gf",
    react: "➖",
    filename: __filename,
},
async (conn, mek, m, { sender, reply, q }) => {
    try {
        const phone = sender.split('@')[0];
        const name = (q || '').trim().toLowerCase();
        if (!name) return reply('Usage: `.removegf <name>`');

        const user = await gfDb.getUser(phone);
        if (!user) return reply('❌ Onboard වෙලා නෑ.');

        const harem = user.harem || [];
        if (!harem.includes(name)) return reply(`ℹ️ *${name}* harem එකේ නෑ.`);

        const newHarem = harem.filter(g => g !== name);
        const newActive = (user.activeGF === name) ? (newHarem[0] || null) : user.activeGF;

        await gfDb.updateUser(phone, { harem: newHarem, activeGF: newActive });
        await gfDb.deleteRelationship(phone, name);

        await reply(
            `➖ *${GIRLFRIENDS[name]?.name || name}* harem එකෙන් අයින් කළා.\n\n` +
            `Harem: ${newHarem.length}/${MAX_HAREM}`
        );
    } catch (e) {
        await reply(`❌ ${e.message}`);
    }
});