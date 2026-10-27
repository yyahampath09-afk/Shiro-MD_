// lib/anime-news.js — Anime News Fetcher + Auto Scheduler
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'anime-news.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const RSS_SOURCES = [
    { name: 'Anime News Network', url: 'https://www.animenewsnetwork.com/all/rss.xml' },
    { name: 'Anime Corner',       url: 'https://animecorner.me/feed/' },
    { name: 'Crunchyroll News',   url: 'https://www.crunchyroll.com/newsrss' },
];

const CFG = {
    MAX_SEEN_GUIDS: 200,
    MAX_TITLE_LEN: 150,
    MAX_DESC_LEN: 200,
    SEND_DELAY_MS: 1200,
    FETCH_TIMEOUT_MS: 15000,
};

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let schedulerTimer = null;
let sockProvider = () => null;

function setSockProvider(fn) {
    sockProvider = fn;
}

function getSock() {
    try { return sockProvider(); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// SETTINGS (JSON storage)
// ═══════════════════════════════════════════════════════════
function getSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return {
                enabled: false,
                intervalHours: 6,
                targets: [],
                lastSeenGuids: [],
                lastCheck: null,
            };
        }
        const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        return {
            enabled: !!raw.enabled,
            intervalHours: raw.intervalHours || 6,
            targets: Array.isArray(raw.targets) ? raw.targets : [],
            lastSeenGuids: Array.isArray(raw.lastSeenGuids) ? raw.lastSeenGuids : [],
            lastCheck: raw.lastCheck || null,
        };
    } catch (e) {
        console.error('[anime-news] read settings fail:', e.message);
        return {
            enabled: false, intervalHours: 6, targets: [],
            lastSeenGuids: [], lastCheck: null,
        };
    }
}

function updateSettings(patch) {
    const current = getSettings();
    const next = { ...current, ...patch };
    if (next.lastSeenGuids.length > CFG.MAX_SEEN_GUIDS) {
        next.lastSeenGuids = next.lastSeenGuids.slice(-CFG.MAX_SEEN_GUIDS);
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

// ═══════════════════════════════════════════════════════════
// RSS PARSER (regex-based, no dependencies)
// ═══════════════════════════════════════════════════════════
function decodeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTag(xml, tag) {
    const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
    const m = xml.match(regex);
    return m ? m[1].trim() : '';
}

function extractAttr(xml, tag, attr) {
    const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
    const m = xml.match(regex);
    return m ? m[1] : '';
}

function parseRSS(xml, sourceName) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        const title = decodeHTML(extractTag(itemXml, 'title')).slice(0, CFG.MAX_TITLE_LEN);
        const link = extractTag(itemXml, 'link') || extractAttr(itemXml, 'link', 'href');
        const pubDate = extractTag(itemXml, 'pubDate');
        const description = decodeHTML(extractTag(itemXml, 'description')).slice(0, CFG.MAX_DESC_LEN);
        const guid = extractTag(itemXml, 'guid') || link;
        const thumbnail =
            extractAttr(itemXml, 'media:thumbnail', 'url') ||
            extractAttr(itemXml, 'enclosure', 'url') ||
            extractAttr(itemXml, 'media:content', 'url') ||
            '';

        if (title && link && guid) {
            items.push({
                title, link, pubDate, description, guid,
                thumbnail, source: sourceName,
            });
        }
    }
    return items;
}

// ═══════════════════════════════════════════════════════════
// FETCH NEWS
// ═══════════════════════════════════════════════════════════
async function fetchNews(limit = 3) {
    let lastError = null;
    for (const source of RSS_SOURCES) {
        try {
            const res = await axios.get(source.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; BlackQueenMD/1.0)',
                    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                },
                timeout: CFG.FETCH_TIMEOUT_MS,
                responseType: 'text',
            });
            const items = parseRSS(res.data, source.name);
            if (items.length === 0) {
                lastError = new Error(`${source.name}: no items`);
                continue;
            }
            items.sort((a, b) => {
                const da = new Date(a.pubDate).getTime() || 0;
                const db = new Date(b.pubDate).getTime() || 0;
                return db - da;
            });
            return items.slice(0, limit);
        } catch (e) {
            console.error(`[anime-news] ${source.name} fail:`, e.message);
            lastError = e;
        }
    }
    throw lastError || new Error('All sources failed');
}

// ═══════════════════════════════════════════════════════════
// SEND ARTICLES
// ═══════════════════════════════════════════════════════════
function formatArticle(a, index) {
    let text = `*${index}. ${a.title}*\n\n`;
    if (a.description) text += `_${a.description}_\n\n`;
    text += `🔗 ${a.link}\n`;
    if (a.pubDate) {
        try {
            const date = new Date(a.pubDate).toLocaleString('en-GB', {
                timeZone: 'Asia/Colombo',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
            text += `📅 ${date}\n`;
        } catch {}
    }
    return text;
}

async function sendArticles(conn, target, articles, quoted = null) {
    if (!articles || articles.length === 0) return;
    if (!conn) throw new Error('No connection');

    const header =
        `📰 *Anime News Update* 📰\n` +
        `${articles.length} article(s)\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

    await conn.sendMessage(target, { text: header }, quoted ? { quoted } : undefined);
    await new Promise(r => setTimeout(r, 800));

    for (let i = 0; i < articles.length; i++) {
        const a = articles[i];
        const caption = formatArticle(a, i + 1);

        try {
            if (a.thumbnail) {
                await conn.sendMessage(target,
                    { image: { url: a.thumbnail }, caption },
                    quoted ? { quoted } : undefined
                );
            } else {
                await conn.sendMessage(target,
                    { text: caption },
                    quoted ? { quoted } : undefined
                );
            }
        } catch (e) {
            console.error('[anime-news] send fail:', e.message);
        }
        if (i < articles.length - 1) {
            await new Promise(r => setTimeout(r, CFG.SEND_DELAY_MS));
        }
    }
}

// ═══════════════════════════════════════════════════════════
// AUTO SEND
// ═══════════════════════════════════════════════════════════
async function autoSend() {
    const settings = getSettings();
    if (!settings.enabled || settings.targets.length === 0) return;

    const conn = getSock();
    if (!conn) {
        console.log('[anime-news] no socket, skip cycle');
        return;
    }

    console.log('[anime-news] auto cycle start');

    let articles;
    try {
        articles = await fetchNews(10);
    } catch (e) {
        console.error('[anime-news] fetch fail:', e.message);
        return;
    }

    const seen = new Set(settings.lastSeenGuids);
    const fresh = articles.filter(a => !seen.has(a.guid));
    const newGuids = [...settings.lastSeenGuids, ...fresh.map(a => a.guid)];

    updateSettings({
        lastSeenGuids: newGuids,
        lastCheck: new Date().toISOString(),
    });

    if (fresh.length === 0) {
        console.log('[anime-news] no new articles');
        return;
    }

    const toSend = fresh.slice(0, 5);

    for (const target of settings.targets) {
        try {
            await sendArticles(conn, target, toSend);
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error(`[anime-news] target fail ${target}:`, e.message);
        }
    }

    console.log(`[anime-news] sent ${toSend.length} to ${settings.targets.length} target(s)`);
}

// ═══════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════
function startScheduler() {
    if (schedulerTimer) return;
    const settings = getSettings();
    if (!settings.enabled) {
        console.log('[anime-news] scheduler skipped (disabled)');
        return;
    }
    if (settings.targets.length === 0) {
        console.log('[anime-news] scheduler skipped (no targets)');
        return;
    }

    const ms = settings.intervalHours * 3600 * 1000;
    schedulerTimer = setInterval(() => {
        autoSend().catch(e => console.error('[anime-news] autoSend:', e));
    }, ms);

    console.log(`[anime-news] scheduler started (${settings.intervalHours}h, ${settings.targets.length} target(s))`);
}

function stopScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        console.log('[anime-news] scheduler stopped');
    }
}

function isSchedulerRunning() {
    return schedulerTimer !== null;
}

module.exports = {
    getSettings,
    updateSettings,
    fetchNews,
    sendArticles,
    startScheduler,
    stopScheduler,
    isSchedulerRunning,
    setSockProvider,
    autoSend,
};
