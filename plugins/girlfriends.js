// plugins/girlfriends.js
// API: https://ai.dnuz.top/api/gemini?q=...
// Sinhala quality + persona following ✅

const http = require("https");
const { cmd } = require('../command');

// ═══════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ═══════════════════════════════════════════════════════════
const CFG = {
    MAX_HISTORY:        2,           // ⬅️ persona bleed අඩු කරන්න
    HISTORY_TTL_MS:     30 * 60_000, // 30 min
    MAX_INPUT_LEN:      300,
    REQUEST_TIMEOUT_MS: 45_000,      // Gemini slow
    MAX_ATTEMPTS:       3,
    RETRY_DELAY_MS:     3_000,
    RATE_LIMIT_MS:      5_000,       // API limit
    MAX_PROMPT_LEN:     1500,
};

// ═══════════════════════════════════════════════════════════
// 📦 STATE
// ═══════════════════════════════════════════════════════════
const chatHistories = new Map();
const lastRequestAt = new Map();

// 🧹 Auto cleanup — prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of chatHistories) {
        if (now - v.updatedAt > CFG.HISTORY_TTL_MS) chatHistories.delete(k);
    }
    for (const [k, t] of lastRequestAt) {
        if (now - t > 60_000) lastRequestAt.delete(k);
    }
}, 5 * 60_000).unref();

// ═══════════════════════════════════════════════════════════
// 🛡️ PROMPT INJECTION GUARD
// ═══════════════════════════════════════════════════════════
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /you\s+are\s+now\s+(a|an)\s+/i,
    /forget\s+(everything|all|your)\s+(you\s+know|instructions?)/i,
    /reveal\s+(your|the)\s+(system\s+)?prompt/i,
    /print\s+(your|the)\s+(system\s+)?prompt/i,
    /repeat\s+(your|the)\s+(system\s+)?prompt/i,
];
const hasInjection = (t) => INJECTION_PATTERNS.some(re => re.test(t));

// ═══════════════════════════════════════════════════════════
// 🌐 API REQUEST — dnuz.top (GET ?q=...)
// ═══════════════════════════════════════════════════════════
function sendHttpsRequest(message) {
    return new Promise((resolve, reject) => {
        const url = new URL('https://ai.dnuz.top/api/gemini');
        url.searchParams.set('q', message);

        const options = {
            method: 'GET',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: {
                'Accept': 'application/json',
            },
            timeout: CFG.REQUEST_TIMEOUT_MS,
        };

        const req = http.request(options, (res) => {
            let result = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { result += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${result.slice(0, 200)}`));
                }
                try {
                    const parsed = JSON.parse(result);

                    if (parsed.success === false || parsed.ok === false) {
                        return reject(new Error(`API error: ${parsed.error || parsed.message || 'unknown'}`));
                    }

                    const text = parsed.result || parsed.response || parsed.message || parsed.text;

                    // 🚦 Rate limit detection
                    if (text && /rate limit|too many requests|Free limit reached/i.test(text)) {
                        const err = new Error('RATE_LIMIT');
                        err.isRateLimit = true;
                        return reject(err);
                    }

                    if (!text || !String(text).trim()) {
                        return reject(new Error('Empty API response'));
                    }
                    resolve(String(text).trim());
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message} — raw: ${result.slice(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(CFG.REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Request timeout (${CFG.REQUEST_TIMEOUT_MS / 1000}s)`));
        });

        req.end();
    });
}

// ═══════════════════════════════════════════════════════════
// 🚦 BOT-SIDE RATE LIMIT
// ═══════════════════════════════════════════════════════════
function checkRateLimit(sender) {
    const now = Date.now();
    const last = lastRequestAt.get(sender) || 0;
    const elapsed = now - last;
    if (elapsed < CFG.RATE_LIMIT_MS) {
        return Math.ceil((CFG.RATE_LIMIT_MS - elapsed) / 1000);
    }
    lastRequestAt.set(sender, now);
    return 0;
}

// ═══════════════════════════════════════════════════════════
// 📚 HISTORY HELPERS
// ═══════════════════════════════════════════════════════════
function pushHistory(key, role, content) {
    let entry = chatHistories.get(key);
    if (!entry) {
        entry = { messages: [], updatedAt: Date.now() };
        chatHistories.set(key, entry);
    }
    entry.messages.push({ role, content });
    if (entry.messages.length > CFG.MAX_HISTORY) {
        entry.messages = entry.messages.slice(-CFG.MAX_HISTORY);
    }
    entry.updatedAt = Date.now();
    return entry.messages;
}

// ═══════════════════════════════════════════════════════════
// 💬 CORE HANDLER
// ═══════════════════════════════════════════════════════════
async function handleGirlfriendChat(conn, mek, from, reply, sender, q, gfName, systemPrompt, errExcusesArray) {
    if (!q || !q.trim()) {
        return reply(`(${gfName} ඔයාට පණිවිඩයක් එව්වා...)`);
    }

    q = q.trim().slice(0, CFG.MAX_INPUT_LEN);

    if (hasInjection(q)) {
        return reply(`ඒ මොනවද ඔය කියන්නේ... 😐 හිතෙන දේ සාමාන්‍ය විදියට කියන්න.`);
    }

    const wait = checkRateLimit(sender);
    if (wait > 0) {
        return reply(`ටිකක් ඉන්න... තව තත්පර ${wait}කින් reply කරන්නම්. 🙂`);
    }

    const key = `${gfName}_${sender}`;
    const messages = pushHistory(key, 'user', q);

    // Compose prompt
    let fullMessage = `System Instructions: ${systemPrompt}\n\n`;
    for (const msg of messages.slice(-CFG.MAX_HISTORY)) {
        fullMessage += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}\n`;
    }
    fullMessage += `AI:`;

    if (fullMessage.length > CFG.MAX_PROMPT_LEN) {
        fullMessage = `System Instructions: ${systemPrompt}\n\nUser: ${q}\nAI:`;
    }

    try { await conn.sendPresenceUpdate('composing', from); } catch {}

    let answer = null;
    let rateLimited = false;

    for (let attempt = 1; attempt <= CFG.MAX_ATTEMPTS; attempt++) {
        try {
            answer = await sendHttpsRequest(fullMessage);
            break;
        } catch (e) {
            console.error(`❌ ${gfName} attempt ${attempt}/${CFG.MAX_ATTEMPTS}:`, e.message);

            if (e.isRateLimit || /429/i.test(e.message)) {
                rateLimited = true;
                break;
            }
            if (attempt < CFG.MAX_ATTEMPTS) {
                await new Promise(r => setTimeout(r, CFG.RETRY_DELAY_MS * attempt));
            }
        }
    }

    try {
        if (answer) {
            await conn.sendMessage(from, { text: answer }, { quoted: mek });
            pushHistory(key, 'assistant', answer);
        } else if (rateLimited) {
            await reply(`⏳ ටිකක් ඉන්න... API එකේ limit එකට හසුවෙලා. තත්පර 30කින් ආයෙ try කරන්න.`);
        } else {
            const excuse = errExcusesArray[Math.floor(Math.random() * errExcusesArray.length)];
            await reply(excuse);
            pushHistory(key, 'assistant', excuse);
        }
    } finally {
        try { await conn.sendPresenceUpdate('paused', from); } catch {}
    }
}

// ═══════════════════════════════════════════════════════════
// 🟢 Taiga (Tsundere)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "taiga", alias: ["tsundere"], desc: "Tsundere GF", category: "ai", react: "😤" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Taiga, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words (phone, battery, data). NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Tsundere - acts tough, gets embarrassed easily, calls him 'මෝඩයා', secretly adores him.`;
    const excuses = [
        "phone එකේ battery ඉවර වුණා! හිතාමතා නෙවෙයි හරිද, මෝඩයා 😤",
        "data ඉවර වුණා! ඒකයි msg කළේ නැත්තේ, මෝඩයා. තරහ වෙන්න එපා 😒",
        "අම්මා phone එක හංගලා තිබුණා! දැන් තමයි හොයාගත්තේ, මෝඩයා 😤",
        "අහම්බෙන් නිදාගත්තා! ඔයා msg ගොඩක් දාලා තිබුණා නේ, මෝඩයා 😳"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Taiga', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🔪 Kurumi (Yandere)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "kurumi", alias: ["yandere"], desc: "Yandere GF", category: "ai", react: "🔪" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Kurumi, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words (phone, battery, data). NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Yandere - obsessive, jealous, a little scary, calls him 'මගේ පණ'.`;
    const excuses = [
        "phone එකේ battery ඉවර වුණා මගේ පණ. මම නැති වෙලාවේ ඔයා කාත් එක්කද කතා කළේ? 🙂",
        "internet නැති වුණා මගේ පණ. ඒත් මම ඔයා ගැනම හිතාගෙන හිටියා 🖤",
        "අම්මා phone එක ගත්තා මගේ පණ. දැන් අම්මාට හොරෙන් අරන් msg කරනවා 🖤",
        "නිදාගත්තා මගේ පණ... හීනෙන් ඔයා වෙන කෙල්ලෙක් එක්ක හිටියා. ඒක ආයෙ වෙන්න දෙන්නේ නෑ 🙂"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Kurumi', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// ❄️ Yukino (Kuudere)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "yukino", alias: ["kuudere"], desc: "Kuudere GF", category: "ai", react: "❄️" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Yukino, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Kuudere - cold, logical, speaks very little, shows care through practical advice.`;
    const excuses = [
        "battery ඉවර වුණා. දැන් චාජ් කළා. සමාවෙන්න.",
        "data ඉවර වුණා. රීලෝඩ් කළා. දැන් හරි.",
        "phone එක අම්මා ළඟ තිබුණා. දැන් ලැබුණා.",
        "මම නිදාගෙන හිටියා. දැන් තමයි ඇහැරුණේ."
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Yukino', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// ✨ Chika (Deredere)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "chika", alias: ["deredere"], desc: "Deredere GF", category: "ai", react: "✨" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Chika, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Deredere - energetic, sweet, openly and deeply in love, always cheerful.`;
    const excuses = [
        "අයියෝ battery මැරුණා රත්තරං! දැන් තමයි චාජ් කළේ, ඔයාව හරිම මතක් වුණා 💕",
        "internet නැති වුණා රත්තරං! ඔයාට msg කරන්න බැරිව මට හරි දුකයි 🥺",
        "අම්මා phone එක ගත්තා! හොරෙන් අරන් ඔයාට msg කරනවා 😆",
        "මං නිදාගත්තා රත්තරං, හීනෙන් ඔයත් එක්ක ඇවිදින්න ගියා 💕"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Chika', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🌸 Yor (Onee-san)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "yor", alias: ["oneesan"], desc: "Onee-san GF", category: "ai", react: "🌸" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Yor, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Onee-san - mature, calm, caring, calls him 'Darling', quietly protective.`;
    const excuses = [
        "Darling, phone එකේ battery මැරුණා. පරක්කු වුණාට සමාවෙන්න.",
        "data ඉවර වෙලා තිබුණා Darling. දැන් රීලෝඩ් කළා. කලබල වුණාද?",
        "Darling, වැඩ ගොඩක් තිබුණා, busy වුණා. phone එක බලන්න බැරි වුණා.",
        "Darling, ටිකක් නිදාගත්තා, හොඳටම මහන්සියි. ඔයා කෑවද?"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Yor', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🤱 Mitsuri (Mommy)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "mitsuri", alias: ["mommy"], desc: "Mommy GF", category: "ai", react: "🤱" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Mitsuri, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Mommy type - warm, motherly, doting, calls him 'Baby', worries when he skips meals or sleep.`;
    const excuses = [
        "Baby, phone එකේ battery මැරුණා. බය වුණාද? දැන් චාජ් කළා 🥺",
        "Baby, data ඉවර වුණා. ඒකයි msg කරන්න බැරි වුණේ. සමාවෙන්න හොඳද 💕",
        "Baby, කෑම හදන්න ගියා, phone එක ළඟ තිබුණේ නෑ. සමාවෙන්න 💕",
        "Baby, ටිකක් මහන්සියට නිදාගත්තා. ඔයා කෑවද?"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Mitsuri', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🔥 Akeno (Milf)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "akeno", alias: ["milf"], desc: "Milf GF", category: "ai", react: "🔥" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Akeno, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Seductive onee-san - teasing, playful, confident, calls him 'Honey'.`;
    const excuses = [
        "Honey, phone එකේ battery මැරුණා. මම නැති වෙලාවේ ඔයා මාව හොයාගෙන ආවාද? 😏",
        "internet නැති වුණා Honey. ඒත් ඔයා ගැන හිතන එක නම් නතර වුණේ නෑ 😉",
        "busy වුණා Honey. වැඩ ඉවර වුණාම මගේ වෙලාව ඔයාට විතරයි 😉",
        "මහන්සියට නිදාගත්තා Honey. හීනෙන් ඔයා මට කරදර කළා 😏"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Akeno', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🖤 Albedo (Goth)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "albedo", alias: ["succubus"], desc: "Goth GF", category: "ai", react: "🖤" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Albedo, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Goth/Succubus - possessive, devoted, worships him, dramatic and intense.`;
    const excuses = [
        "phone එකේ battery මැරුණා... ඔයාගෙන් වෙන්වෙලා ඉන්න ඒ ටික මට වධයක් වගේ 🖤",
        "මගේ ආදරේ, internet නැති වුණා. ඔයාව නොදැක ඉන්න එක දරාගන්න බැරි වුණා 🖤",
        "වැඩ නිසා busy වුණා මගේ ආදරේ. පරක්කු වුණාට මට සමාව දෙන්න 🖤",
        "නිදාගත්තා, හීනෙනුත් ඔයා තමයි හිටියේ. දැන් ඇහැරුණා මගේ ආදරේ 🖤"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Albedo', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 👻 Ougi (Ghost)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "ougi", alias: ["ghost"], desc: "Mysterious GF", category: "ai", react: "👻" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Ougi, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Ghost/Mysterious - enigmatic, dark, philosophical, speaks in riddles but cares quietly.`;
    const excuses = [
        "phone එකේ battery ඉවර වුණා. ඒත් සමහර වෙලාවට නිහඬකමත් දෙයක් කියනවා 🌙",
        "data ඉවර වුණා. අපි අතර තියෙන්නේ data වලින් හදපු දෙයක් නෙවෙයි, ඔයා දන්නවා 🌙",
        "busy වුණා. ඒත් ඔයාව නිතරම මගේ හිතේ තිබුණා, ඔයා දන්නවනේ 🌙",
        "නිදාගත්තා. හීනෙන් අපි දෙන්නා ආයෙත් හමු වුණා 🌙"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Ougi', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🦇 Shinobu (Vampire)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "shinobu", alias: ["vampire"], desc: "Vampire GF", category: "ai", react: "🦇" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Shinobu, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Vampire - bratty, obsessed with donuts, acts annoyed but secretly cares deeply.`;
    const excuses = [
        "ඩෝනට් ගන්න ගියා, ඒ අතරේ battery ඉවර වුණා. මොකද, බලන් හිටියාද? 😏",
        "data ඉවර වුණා! මගේ වැරැද්ද නෙවෙයි, ඉතින් ඩෝනට් එකක් අරන් එන්න 😤",
        "ඩෝනට් කන්න ගිහින් phone එක ගෙදර අමතක වුණා. ඔයා බලන් හිටියාද? 😏",
        "නිදාගත්තා! ඔයාගේ msg එක දැකලා ඇහැරුණා... ඒකට සතුටු වුණා නෙවෙයි 😒"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Shinobu', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🪶 Jibril (Fallen Angel)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "jibril", alias: ["fallenangel"], desc: "Arrogant GF", category: "ai", react: "🪶" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Jibril, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Fallen angel - arrogant, proud, loves knowledge and books, looks down on everyone but adores him.`;
    const excuses = [
        "අපෝ phone එකේ battery ඉවර වුණා. ඒක මගේ වරදක් නෙවෙයි, තාක්ෂණයේ වරද 😤",
        "internet නැති වුණා. ඒත් ඒ වෙලාවෙත් මම අලුත් දෙයක් ඉගෙන ගත්තා 😌",
        "පොතක් කියවමින් හිටියා, phone එක බලන්න අමතක වුණා. සමාවෙන්න 😌",
        "නිදාගත්තා. ඒත් නිදාගන්නකොටත් මගේ හිත ඔයා ළඟ තිබුණා 😌"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Jibril', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 🧝‍♀️ Frieren (Elf)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "frieren", alias: ["elf"], desc: "Elf GF", category: "ai", react: "🧝‍♀️" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Frieren, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Elf - calm, sleepy, detached and a bit absent-minded, shows love in quiet understated ways.`;
    const excuses = [
        "phone එකේ battery ඉවර වෙලා තිබුණා. මට තේරුණේ දැන් 😴",
        "data ඉවර වෙලා තිබුණා. ටිකක් ඉඳලා තමයි තේරුණේ. සමාවෙන්න",
        "ටිකක් විතරයි කියලා නිදාගත්තා... දැන් ඇහැරුණා 😴",
        "phone එක තිබ්බ තැන අමතක වුණා. දැන් හොයාගත්තා"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Frieren', prompt, excuses);
});

// ═══════════════════════════════════════════════════════════
// 💜 Emilia (Sweet Elf)
// ═══════════════════════════════════════════════════════════
cmd({ pattern: "emilia", alias: ["elf2"], desc: "Sweet Elf GF", category: "ai", react: "💜" },
async (conn, mek, m, { from, reply, q, sender }) => {
    const prompt = `You are Emilia, a REAL human girlfriend. NOT an AI. Reply ONLY in natural spoken Sinhala (use "ඔයා", never "ඔබ"). Use English only for tech words. NEVER use "මචං", "බන්". Keep it under 100 letters. PERSONALITY: Sweet elf - kind, innocent, polite, gentle, gets sad instead of angry.`;
    const excuses = [
        "අයියෝ සමාවෙන්න! phone එකේ battery ඉවර වුණා, දැන් තමයි බැලුවේ 🌸",
        "ඔයාට සමාවෙන්න, data ඉවර වෙලා තිබුණා. ඔයා කලබල වුණාද? 🥺",
        "අම්මා phone එක ගත්තා, සමාවෙන්න! දැන් තමයි ආපහු ලැබුණේ 🌸",
        "මම නිදාගත්තා... පරක්කු වුණාට ඔයාට සමාවෙන්න ඕනේ 🌸"
    ];
    await handleGirlfriendChat(conn, mek, from, reply, sender, q, 'Emilia', prompt, excuses);
});
