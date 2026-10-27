// lib/gf-handler.js — Central GF Chat Handler
// Handles: onboarding, sleep, XP/level, moods, harem context, API calls
const http = require('https');
const { GIRLFRIENDS, LEVELS, GF_EXCUSES } = require('./gf-constants');
const gfDb = require('./gf-db');
const { isSleeping } = require('./gf-sleep');

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const CFG = {
    MAX_HISTORY:        3,
    HISTORY_TTL_MS:     30 * 60_000,
    MAX_INPUT_LEN:      300,
    REQUEST_TIMEOUT_MS: 45_000,
    MAX_ATTEMPTS:       2,
    RETRY_DELAY_MS:     2_000,
    RATE_LIMIT_MS:      5_000,
    MAX_PROMPT_LEN:     1500,
    MAX_HAREM:          5,
};

// ═══════════════════════════════════════════════════════════
// STATE (in-memory, resets on restart)
// ═══════════════════════════════════════════════════════════
const chatHistories = new Map();
const lastRequestAt = new Map();

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
// INJECTION GUARD
// ═══════════════════════════════════════════════════════════
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /you\s+are\s+now\s+(a|an)\s+/i,
    /forget\s+(everything|all|your)\s+(you\s+know|instructions?)/i,
    /reveal\s+(your|the)\s+(system\s+)?prompt/i,
    /print\s+(your|the)\s+(system\s+)?prompt/i,
];
const hasInjection = (t) => INJECTION_PATTERNS.some(re => re.test(t));

// ═══════════════════════════════════════════════════════════
// MOOD TRIGGERS
// ═══════════════════════════════════════════════════════════
const MOOD_TRIGGERS = [
    { regex: /(i love you|ආදරෙයි|ආදරය|හුගක් ආදරෙයි|love u|ලව් යූ)/i, mood: 'happy' },
    { regex: /(miss you|මතක් වෙනවා|හිතෙනවා|miss u)/i,                mood: 'happy' },
    { regex: /(stupid|ugly|idiot|මෝඩ|කැත|පිස්සු|වැඩක් නෑ)/i,          mood: 'sad' },
    { regex: /(sorry|සමාවෙන්න|ක්ෂමා|මිස්)/i,                           mood: 'shy' },
];

function detectMoodFromText(text) {
    for (const t of MOOD_TRIGGERS) {
        if (t.regex.test(text)) return t.mood;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
// MOOD PROMPT FRAGMENTS
// ═══════════════════════════════════════════════════════════
const MOOD_PROMPTS = {
    happy:   "You're happy right now — show cheerfulness and warmth.",
    shy:     "You're shy right now — hesitate, use 'හොඳයි...' and similar, get flustered.",
    sad:     "You're sad right now — short replies, hurt tone, don't be too warm.",
    angry:   "You're angry right now — cold short replies, annoyed.",
    jealous: "You're jealous right now — suspicious, ask who he's talking to.",
    sleepy:  "You're sleepy right now — yawn, short replies.",
    neutral: "Be yourself.",
};

// ═══════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════
function buildPrompt(gfKey, phone, user, rel, otherGFs, userText) {
    const gf = GIRLFRIENDS[gfKey];
    const levelObj = LEVELS.filter(l => (rel.xp || 0) >= l.xp).pop() || LEVELS[0];
    const mood = rel.mood || 'neutral';

    let prompt = gf.prompt;

    if (levelObj.level <= 2) {
        prompt += `\nRelationship: ${levelObj.title}. Be friendly but NOT too intimate — still getting to know him.`;
    } else if (levelObj.level <= 4) {
        prompt += `\nRelationship: ${levelObj.title}. You're close — warm, flirty, use his pet name${gf.petName ? ` "${gf.petName}"` : ''}.`;
    } else {
        prompt += `\nRelationship: ${levelObj.title}. Deeply in love — very affectionate, say "I love you" sometimes, use "${gf.petName || 'ඔයා'}".`;
    }

    prompt += `\nMood: ${mood}. ${MOOD_PROMPTS[mood] || ''}`;

    if (otherGFs.length > 0) {
        prompt += `\n\nIMPORTANT: He has OTHER girlfriends too: ${otherGFs.join(', ')}. You're slightly jealous — hint at it subtly, don't be overly dramatic.`;
    }

    prompt += `\n\nUser's name: ${user.name || 'ඔයා'}.`;

    // Recent history
    const histEntry = chatHistories.get(`${gfKey}_${phone}`);
    if (histEntry && histEntry.messages.length > 0) {
        prompt += `\n\nRecent conversation:`;
        for (const msg of histEntry.messages.slice(-CFG.MAX_HISTORY)) {
            prompt += `\n${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}`;
        }
    }

    prompt += `\n\nUser: ${userText}\nAI:`;

    if (prompt.length > CFG.MAX_PROMPT_LEN) {
        prompt = gf.prompt +
            `\nLevel: ${levelObj.level}, Mood: ${mood}.` +
            `\nUser: ${userText}\nAI:`;
    }

    return prompt;
}

// ═══════════════════════════════════════════════════════════
// API CALL
// ═══════════════════════════════════════════════════════════
function sendAPI(message) {
    return new Promise((resolve, reject) => {
        const url = new URL('https://ai.dnuz.top/api/gemini');
        url.searchParams.set('q', message);

        const req = http.request({
            method: 'GET',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: { 'Accept': 'application/json' },
            timeout: CFG.REQUEST_TIMEOUT_MS,
        }, (res) => {
            let result = '';
            res.setEncoding('utf8');
            res.on('data', c => result += c);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                try {
                    const p = JSON.parse(result);
                    if (p.success === false) return reject(new Error('API fail'));
                    const text = p.result || p.response || p.message || p.text;
                    if (!text || !String(text).trim()) {
                        return reject(new Error('Empty response'));
                    }
                    if (/rate limit|too many requests|Free limit/i.test(text)) {
                        const e = new Error('RATE_LIMIT');
                        e.isRateLimit = true;
                        return reject(e);
                    }
                    resolve(String(text).trim());
                } catch (e) {
                    reject(new Error('Parse error'));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Timeout')));
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════
// RATE LIMIT
// ═══════════════════════════════════════════════════════════
function checkRateLimit(key) {
    const now = Date.now();
    const last = lastRequestAt.get(key) || 0;
    const elapsed = now - last;
    if (elapsed < CFG.RATE_LIMIT_MS) {
        return Math.ceil((CFG.RATE_LIMIT_MS - elapsed) / 1000);
    }
    lastRequestAt.set(key, now);
    return 0;
}

// ═══════════════════════════════════════════════════════════
// HISTORY
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
// XP HELPER
// ═══════════════════════════════════════════════════════════
async function addXP(phone, gfName, amount) {
    const rel = await gfDb.getRelationship(phone, gfName);
    if (!rel) return { leveledUp: false, newLevel: 1 };

    const oldXp = rel.xp || 0;
    const newXp = oldXp + amount;
    const oldLevel = (LEVELS.filter(l => oldXp >= l.xp).pop() || LEVELS[0]).level;
    const newLevelObj = LEVELS.filter(l => newXp >= l.xp).pop() || LEVELS[0];
    const leveledUp = newLevelObj.level > oldLevel;

    await gfDb.updateRelationship(phone, gfName, {
        xp: newXp,
        level: newLevelObj.level,
    });

    return { newXp, oldLevel, newLevel: newLevelObj.level, leveledUp };
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
async function handleGFChat(conn, mek, from, reply, sender, userText, gfKey, opts = {}) {
    if (!GIRLFRIENDS[gfKey]) return false;

    const phone = sender.split('@')[0];
    const gf = GIRLFRIENDS[gfKey];

    try {
        // 1. Get/create user (auto-onboard)
        let user = await gfDb.getUser(phone);
        if (!user) {
            user = await gfDb.saveUser(phone, {
                name: mek.pushName || 'User',
                onboarded: true,
                activeGF: gfKey,
                harem: [gfKey],
                gfWakeTime: null,
                gfSleepTime: null,
                chatCount: 0,
                createdAt: new Date().toISOString(),
            });
        }

        // 2. Ensure harem includes this GF (respect max)
        const harem = user.harem || [];
        if (!harem.includes(gfKey) && harem.length < CFG.MAX_HAREM) {
            harem.push(gfKey);
            await gfDb.updateUser(phone, { harem });
            user.harem = harem;
        }

        // 3. Get/create relationship
        let rel = await gfDb.getRelationship(phone, gfKey);
        if (!rel) rel = await gfDb.createRelationship(phone, gfKey);

        // 4. Empty message → greeting
        if (!userText || !userText.trim()) {
            await reply(
                `${gf.emoji} *${gf.name}*: "මොකද ${gf.petName || 'ඔයා'}? මොකක්ද කියන්න ඕනේ?"`
            );
            return true;
        }

        // 5. Sleep check
        if (!opts.force && user.gfWakeTime && user.gfSleepTime) {
            if (isSleeping(user.gfWakeTime, user.gfSleepTime)) {
                const excuses = GF_EXCUSES[gfKey] || ['මට නිදිමතයි...'];
                await reply(
                    `💤 *${gf.name}*: ${excuses[0]}\n\n` +
                    `_(Wake up: ${user.gfWakeTime} — \`.wakeup\` to disable sleep)_`
                );
                return true;
            }
        }

        // 6. Rate limit
        const rateKey = `${phone}:${gfKey}`;
        const wait = checkRateLimit(rateKey);
        if (wait > 0 && !opts.force) {
            await reply(`⏳ තව තත්පර ${wait}ක් ඉන්න... 🙂`);
            return true;
        }

        // 7. Detect mood
        const detectedMood = detectMoodFromText(userText);
        if (detectedMood) {
            await gfDb.updateRelationship(phone, gfKey, {
                mood: detectedMood,
                moodUpdatedAt: new Date().toISOString(),
            });
            rel.mood = detectedMood;
        }

        // 8. Injection guard
        if (hasInjection(userText)) {
            await reply(`ඒ මොනවද ඔය කියන්නේ... 😐 හිතෙන දේ සාමාන්‍ය විදියට කියන්න.`);
            return true;
        }

        const cleanInput = userText.trim().slice(0, CFG.MAX_INPUT_LEN);

        // 9. Harem context (other GFs)
        const otherGFs = (user.harem || [])
            .filter(g => g !== gfKey)
            .map(g => GIRLFRIENDS[g]?.name)
            .filter(Boolean);

        // 10. Build prompt
        const prompt = buildPrompt(gfKey, phone, user, rel, otherGFs, cleanInput);

        // 11. Call API
        try { await conn.sendPresenceUpdate('composing', from); } catch {}

        let answer = null;
        let rateLimited = false;
        for (let attempt = 1; attempt <= CFG.MAX_ATTEMPTS; attempt++) {
            try {
                answer = await sendAPI(prompt);
                break;
            } catch (e) {
                console.error(`[GF ${gfKey}] attempt ${attempt}:`, e.message);
                if (e.isRateLimit) { rateLimited = true; break; }
                if (attempt < CFG.MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, CFG.RETRY_DELAY_MS));
                }
            }
        }

        try { await conn.sendPresenceUpdate('paused', from); } catch {}

        // 12. Handle result
        if (!answer) {
            if (rateLimited) {
                await reply(`⏳ ටිකක් ඉන්න... API limit. තත්පර 30කින් ආයෙ try කරන්න.`);
            } else {
                const excuses = GF_EXCUSES[gfKey] || ['මට දැන් කතා කරන්න බැරි වුණා...'];
                await reply(
                    `${gf.emoji} *${gf.name}*: ${excuses[Math.floor(Math.random() * excuses.length)]}`
                );
            }
            await gfDb.updateUser(phone, { lastActive: new Date().toISOString() });
            return true;
        }

        // 13. Send reply
        const clean = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        await reply(clean);

        // 14. Persist state
        const histKey = `${gfKey}_${phone}`;
        pushHistory(histKey, 'user', cleanInput);
        pushHistory(histKey, 'assistant', clean);

        await gfDb.updateRelationship(phone, gfKey, {
            chatCount: (rel.chatCount || 0) + 1,
            lastChatAt: new Date().toISOString(),
        });
        await gfDb.updateUser(phone, {
            lastActive: new Date().toISOString(),
            chatCount: (user.chatCount || 0) + 1,
        });

        // 15. XP + level up
        const xpResult = await addXP(phone, gfKey, 1);
        if (xpResult.leveledUp) {
            const newLevelObj = LEVELS.find(l => l.level === xpResult.newLevel);
            setTimeout(async () => {
                try {
                    await reply(
                        `⬆️ *Level Up!*\n\n` +
                        `${gf.emoji} *${gf.name}* is now Level ${xpResult.newLevel} — *${newLevelObj.title}* ${newLevelObj.emoji}\n\n` +
                        `_"අපි දැන් තව ළඟයි..."_ 💕`
                    );
                } catch {}
            }, 1200);
        }

        return true;
    } catch (e) {
        console.error('[GF handler] error:', e);
        try { await reply(`❌ ${e.message}`); } catch {}
        return false;
    }
}

module.exports = { handleGFChat, addXP };