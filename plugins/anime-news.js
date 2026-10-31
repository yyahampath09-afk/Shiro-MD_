// plugins/anime-news.js — Auto Anime News Broadcaster
// (Full Article + Photo card + Reply-style post + "View channel" button + AI summary + No-duplicates + Anti-Ban)
/*
   config.js එකේ ANIME_NEWS ඇතුළේ දාන්න පුළුවන් options (ENABLED / TARGET_JIDS / INTERVAL_MINUTES හැර ඔක්කොම optional):
     VIEW_CHANNEL_JID  : '120363XXXXXXXXXXXXXX@newsletter'   ← "View channel" button එක tap කළාම යන channel එකේ JID එක
     VIEW_CHANNEL_NAME : 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ'                       ← post එකේ උඩින් පේන channel නම
     VIEW_CHANNEL_LINK : 'https://whatsapp.com/channel/XXXX'  ← JID එක නැත්නම් මේකෙන් හොයාගන්නවා; card tap කළාමත් මෙතනට
     QUOTE_NAME        : 'ᴵⁿᵒˢᵘᵏᵉ'                            ← reply card එකේ නම   (QUOTE_ENABLED: false = reply card නැහැ)
     POST_STYLE        : 'card' | 'image'
     SUMMARY           : true | false                         ← AI summary   (SUMMARY_LANG: 'English' | 'Sinhala' ...)
     SHOW_TITLE / SHOW_SOURCE / TZ_OFFSET_MINUTES / STATE_FILE / START_DELAY_SECONDS / AI_API_URL
*/
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const CFG = config.ANIME_NEWS || {};
// config.js එකේ ANIME_NEWS ඇතුළේ දැම්මොත් ඒක ගන්නවා, නැත්නම් මෙතන තියෙන default එක
const opt = (key, def) => (CFG[key] === undefined || CFG[key] === null || CFG[key] === '' ? def : CFG[key]);

/* ═══════════════ ⚙️ SETTINGS — මෙතනින් වෙනස් කරන්න පුළුවන් ═══════════════ */
const FEED_URL      = 'https://animecorner.me/feed/';
const MAX_PER_CHECK = 2;      // එක check එකකදී යවන උපරිම news ගණන
const MAX_AGE_HOURS = 36;     // මීට පරණ news යවන්නේ නැහැ
const POST_LATEST_ON_FIRST_RUN = false;   // true කළොත් state file එක නැති පළවෙනි run එකේදී අලුත්ම news යවනවා (test කරන්න විතරයි!
                                          // restart වෙද්දී file එක මැකෙන host එකක නම් true දාන්න එපා — එහෙම දැම්මොත් restart හැමවෙලේම ආයේ යනවා)
const START_DELAY_SEC = Number(opt('START_DELAY_SECONDS', 30));   // bot පටන් ගෙන තත්පර මෙච්චරකින් පස්සේ පළවෙනි check එක (connection එක ස්ථාවර වෙන්න)

// 📢 "View channel" button — config.js එකේ ANIME_NEWS ඇතුළේ දැම්මත් හරි, මෙතන quotes ඇතුළේ දැම්මත් හරි
//   VIEW_CHANNEL_JID  → ඔබට කැමති channel එකේ JID එක: '120363XXXXXXXXXXXXXX@newsletter'  (button එක tap කළාම යන්නේ මේ channel එකට)
//   VIEW_CHANNEL_NAME → post එකේ උඩින් පේන channel නම
//   VIEW_CHANNEL_LINK → (optional) https://whatsapp.com/channel/XXXX
//                       • JID එක දාලා නැත්නම් මේ link එකෙන් JID එක auto හොයාගන්නවා
//                       • card එක tap කළාමත් යන්නේ මේ link එකට
const normChannelJid = (v) => { v = String(v || '').trim(); return /^\d{8,}$/.test(v) ? v + '@newsletter' : v; };
const VIEW_CHANNEL_JID  = normChannelJid(CFG.VIEW_CHANNEL_JID || '');
const VIEW_CHANNEL_NAME = CFG.VIEW_CHANNEL_NAME || 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ';
const VIEW_CHANNEL_LINK = String(CFG.VIEW_CHANNEL_LINK || '').trim();
const NEWSLETTER_MSG_ID = 143;                       // "View channel" button එකට ඕන message id එක (වෙනස් කරන්න ඕන නැහැ)

// 💬 "Reply" style — post එක, නමක් තියෙන contact card එකකට reply කළා වගේ පේනවා (WhatsApp respond එකක් වගේ)
const QUOTE_ENABLED = CFG.QUOTE_ENABLED !== false;   // false කළොත් reply card එක නැතුව යවනවා
const QUOTE_NAME    = CFG.QUOTE_NAME || 'ᴵⁿᵒˢᵘᵏᵉ';   // reply card එකේ පේන නම (කලින් ADMIN_TEAM තිබුණු තැන)

// 🖼️ Post style:
//   'card'  → පින්තූරය ලොකු card එකක් විදිහට + full news එකම message එකේ (ගැලපෙන තරම්)
//   'image' → සාමාන්‍ය image message (caption එකට ගැලපෙන ටික, ඉතුරු normal messages)
const POST_STYLE  = (CFG.POST_STYLE === 'image') ? 'image' : 'card';
const CARD_BODY   = '📰 Anime News Update';        // card එකේ title යට පේන පොඩි text එක
const SHOW_TITLE  = CFG.SHOW_TITLE !== false;      // post එකේ text එකටත් title එක වැටෙනවා (false කළොත් card එකේ විතරයි)
const SHOW_SOURCE = CFG.SHOW_SOURCE === true;      // false = ලිපියේ අගට තියෙන "Source: ..." line එක / link එක දාන්නේ නැහැ

// 🤖 AI summary (Gemini API) — post එකේ "In short" කොටස
const SUMMARY_ENABLED   = CFG.SUMMARY !== false;                                            // false කළොත් summary නැතුව යවනවා
const SUMMARY_LANG      = String(opt('SUMMARY_LANG', 'English'));                           // 'English' | 'Sinhala' | ...
const AI_API_URL        = String(opt('AI_API_URL', 'https://ai.dnuz.top/api/gemini?q='));  // අන්තිමට q= එක තියෙන්න ඕන
const SUMMARY_MAX_CHARS = 420;     // summary එකේ උපරිම අකුරු ගණන
const AI_INPUT_CHARS    = 1800;    // AI එකට යවන article කොටසේ උපරිම අකුරු ගණන (URL එක දිග වැඩි වෙන්නේ නැති වෙන්න)
const AI_MAX_URL_LEN    = 6000;    // මීට වඩා දිග URL එකක් යවන්නේ නැහැ
const AI_TIMEOUT_MS     = 25000;

const TZ_OFFSET_MIN = Number(opt('TZ_OFFSET_MINUTES', 330));   // 📅 date එක පෙන්නන වෙලා කලාපය (Sri Lanka = UTC+5:30 = 330)
const MAX_TAGS      = 6;                                       // 🏷️ hashtags උපරිම ගණන

const CAPTION_LIMIT     = 1000;    // 'image' style: caption එකට අකුරු ගණන (WhatsApp limit එක 1024)
const TEXT_LIMIT        = 4000;    // එක message එකකට උපරිම අකුරු ගණන
const MAX_ARTICLE_CHARS = 15000;   // මීට වඩා දිග article එකක් කපනවා (spam / ban වළක්වන්න)
const MAX_RETRIES       = 3;       // කිසිම තැනකට යන්න බැරි වුණ news එකක් ආයේ try කරන උපරිම වාර ගණන

const BANNER  = '📰 *ANIME NEWS* 📰';
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const BT      = String.fromCharCode(96);
const FOOTER  = BT + 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ᴵⁿᵒˢᵘᵏᵉ' + BT;
const NO_COPY = "> *🚫 Don't Copy This Article/Post  🚫*";
const SUMMARY_LABEL = '💬 *In short*';
const BODY_LABEL    = '📖 *Full News*';
/* ═══════════════════════════════════════════════════════════════════════ */

const CHANNEL_OK = /@newsletter$/.test(VIEW_CHANNEL_JID);
const isNewsletter = (jid) => String(jid || '').endsWith('@newsletter');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

const parser = new Parser({ timeout: 20000, headers: BROWSER_HEADERS });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const totalLen = (arr) => arr.reduce((n, s) => n + s.length, 0);

// අකුරු/ඉලක්කම් විතරක් — paragraph / title දෙකක් සසඳන්න
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* ═══════════════ 🔁 Duplicate වළක්වන කොටස ═══════════════
   • යවපු news ලැයිස්තුව file එකක save වෙනවා (atomic write) → bot restart වුණත් ආයේ යන්නේ නැහැ
   • හැම check එකකටම කලින් සහ යවන්න කලින්ම file එක ආයේ කියවලා merge කරනවා → restart / deploy වෙද්දී
     process දෙකක් එකවර දුවනවා නම් දෙවැන්නා ඒක දැකලා skip කරනවා
   • guid, link, title තුනෙන්ම බලනවා → feed එකේ guid / link වෙනස් වුණත් එකම news එක ආයේ යන්නේ නැහැ
   • යවන්න කලින්ම "claim" කරනවා. කිසිම තැනකට යන්න බැරි වුණොත් (connection නැතිව) විතරක් ආයේ try කරනවා (උපරිම MAX_RETRIES)
   • "Timed out" වගේ ගියාද නැද්ද කියලා හරියටම කියන්න බැරි error එකක් ආවොත් වෙන format එකකින් ආයේ යවන්නේ නැහැ
   • state එක global එකේත් තියෙනවා → plugin එක reload / reconnect එකකදී දෙපාරක් load වුණත් timers දෙකක් හැදෙන්නේ නැහැ
   ⚠️ host එක restart වෙද්දී file system එක reset වෙනවා නම් (Heroku / Railway / Render...) persistent disk එකක් පාවිච්චි කරන්න
      හෝ config එකේ STATE_FILE එකට persistent folder එකක path එකක් දෙන්න. anime-news-sent.json GitHub එකට commit කරන්නත් එපා.   */
const STATE_FILE = CFG.STATE_FILE ? path.resolve(String(CFG.STATE_FILE)) : path.join(__dirname, '..', 'anime-news-sent.json');
const MAX_STATE  = 900;
const G = global.__animeNews || (global.__animeNews = {});

function readDisk() {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (data && Array.isArray(data.guids)) return new Set(data.guids.map(String));
    } catch (e) { /* file එක නැහැ / කියවන්න බැහැ */ }
    return null;
}

// වෙන process එකක් (හෝ කලින් run එකක්) ලියපු දේවල් ඇතුළු කරගන්නවා
function mergeDisk() {
    const disk = readDisk();
    if (disk && disk.size) {
        disk.forEach((k) => G.sent.add(k));
        G.fresh = false;
    }
}

function saveState(merge) {
    try {
        if (merge !== false) mergeDisk();
        const json = JSON.stringify({ guids: Array.from(G.sent).slice(-MAX_STATE), savedAt: new Date().toISOString() });
        const tmp = STATE_FILE + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
        fs.writeFileSync(tmp, json);
        try {
            fs.renameSync(tmp, STATE_FILE);                  // අඩක් ලියවුණු file එකක් ඉතුරු වෙන්නේ නැහැ
        } catch (e) {                                        // සමහර disks / Windows වල rename කරන්න බැරි වුණොත් කෙළින්ම ලියනවා
            fs.writeFileSync(STATE_FILE, json);
            try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        }
        return true;
    } catch (e) {
        console.error('⚠️ Anime news: යවපු list එක save කරන්න බැරි වුණා:', e.message);
        return false;
    }
}

if (!G.sent) {
    const disk = readDisk();
    G.sent = disk || new Set();
    G.fresh = !disk || disk.size === 0;                      // file එක නැත්නම් / හිස් නම් = පළවෙනි run එක
}

// එකම news එකට keys කීපයක්: guid, link, title
const itemKeys = (item) => {
    const keys = [item.guid, item.link, item.title ? 't:' + norm(item.title) : '']
        .map((k) => String(k || '').trim())
        .filter((k) => k && k !== 't:');
    return Array.from(new Set(keys));
};
const isSeen   = (item) => itemKeys(item).some((k) => G.sent.has(k));
const markSeen = (item) => itemKeys(item).forEach((k) => G.sent.add(k));

// යවන්න කලින් "මේක මම ගත්තා" කියලා file එකේ ලියනවා. වෙන කෙනෙක් කලින් ගත්තා නම් false
function claim(item) {
    mergeDisk();
    if (isSeen(item)) return false;
    markSeen(item);
    saveState(false);
    return true;
}

// claim එක අයින් කරනවා — මේ news එකේ keys විතරයි; වෙන process එකක් ලියපු අනිත් ඒවා රැකගන්නවා
function release(item) {
    const mine = new Set(itemKeys(item));
    const disk = readDisk();
    if (disk) disk.forEach((k) => { if (!mine.has(k)) G.sent.add(k); });
    mine.forEach((k) => G.sent.delete(k));
    saveState(false);
}

// කිසිම තැනකට යන්න බැරි වුණ news එකක් ආයේ try කරන්න ඉඩ දෙනවා (උපරිම MAX_RETRIES වතාවක්)
function giveBack(item, reason) {
    G.fails = G.fails || {};
    const key = itemKeys(item)[0];
    G.fails[key] = (G.fails[key] || 0) + 1;
    if (G.fails[key] < MAX_RETRIES) {
        release(item);
        console.error(`↩️ Anime news: "${item.title}" යන්න බැරි වුණා (${reason}) — ඊළඟ check එකේදී ආයේ try කරනවා (${G.fails[key]}/${MAX_RETRIES})`);
    } else {
        console.error(`🛑 Anime news: "${item.title}" ${MAX_RETRIES} පාරක්ම අසාර්ථකයි (${reason}) — මේක skip කරනවා`);
    }
}

function isTooOld(item) {
    const t = Date.parse(item.isoDate || item.pubDate || '');
    return !!t && (Date.now() - t) > MAX_AGE_HOURS * 3600 * 1000;
}

/* ═══════════════ 🧹 HTML → WhatsApp text (ඡේද, bold, list රැකගන්නවා) ═══════════════ */

const BLOCK_SELECTOR = 'p, h2, h3, h4, h5, h6, li, blockquote';

// article body එකට අයිති නැති කොටස් (menu, ads, share, related, comments...)
const JUNK_SELECTOR = [
    'script', 'style', 'noscript', 'iframe', 'form', 'button', 'select', 'svg', 'video', 'audio',
    'figure', 'header', 'footer', 'nav', 'aside',
    '.twitter-tweet', '.instagram-media', '.wp-block-embed', '.sharedaddy', '.addtoany_share_save_container',
    '.jp-relatedposts', '.yarpp-related', '.adsbygoogle',
    '[class~="ad"]', '[class~="ads"]', '[class~="advert"]', '[class~="advertisement"]',
    '[class~="share"]', '[class~="sharing"]', '[class~="related"]', '[class~="comments"]', '#comments'
].join(', ');

// මේ heading එකක් (සම්පූර්ණ text එකම) ආවොත් article එක ඉවරයි — ඊට පස්සේ related / comments
const TERMINATOR = /^(related (posts?|articles?|stories|news)|join the discussion|trending( posts?| now)?|popular( posts?)?|recommended( for you| posts?)?|comments?|you may also like|more (news|stories)|read next|latest news|leave a (reply|comment))$/i;

const KNOWN_ROOTS = ['.entry-content', '.post-content', '.article-content', '.article-body', '.prose', '[itemprop="articleBody"]', 'article'];

const decodeText = (html) => {
    if (!html) return '';
    return cheerio.load('<div>' + html + '</div>')('div').text().replace(/\s+/g, ' ').trim();
};

const tidy = (s) => s
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

// <strong>/<em> → WhatsApp *bold* / _italic_ (spaces marker එකෙන් එළියට)
function wrapMark(text, mark) {
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m || !m[2] || m[2].includes('\n')) return text;
    if (m[2][0] === mark && m[2][m[2].length - 1] === mark) return text;
    return m[1] + mark + m[2] + mark + m[3];
}

const NO_TAGS = new Set();
const LIST_TAGS = new Set(['ul', 'ol']);

function nodeToText(node, skipTags) {
    if (!node) return '';
    if (node.type === 'text') return (node.data || '').replace(/\s+/g, ' ');
    if (node.type !== 'tag') return '';                       // comment, script, style...
    const name = (node.name || '').toLowerCase();
    if (name === 'br') return '\n';
    if (skipTags.has(name)) return '';
    const inner = (node.children || []).map((n) => nodeToText(n, skipTags)).join('');
    if (name === 'strong' || name === 'b') return wrapMark(inner, '*');
    if (name === 'em' || name === 'i') return wrapMark(inner, '_');
    return inner;
}

function isSkippable(t) {
    if (/^(advertisement|sponsored|ad|share|share this|continue reading)$/i.test(t)) return true;
    if (/^the post .+ appeared first on /i.test(t)) return true;
    if (/^(read more|related( posts?| articles?)?|also read|see also|recommended)\s*[:–-]/i.test(t)) return true;
    if (/^written by\b/i.test(t) && t.length < 80) return true;
    if (/^https?:\/\/\S+$/i.test(t)) return true;             // URL එක විතරක් තියෙන line
    return false;
}

// link එකක් විතරම නම් (related post, "Previous post" වගේ) — ඒක news text එකක් නෙවෙයි
function isLinkOnly($el, plain) {
    const linkText = $el.find('a').text().replace(/\s+/g, ' ').trim();
    return plain.length < 160 && linkText.length / plain.length > 0.9;
}

// root එක ඇතුළේ තියෙන paragraphs, headings, lists, quotes → ලස්සන ඡේද array එකක්
function extractParagraphs($, $root, authorKey) {
    const $c = $root.clone();
    $c.find(JUNK_SELECTOR).remove();

    const out = [];
    let sourceSeen = false;
    let stop = false;
    let lastKind = '';                                          // '', 'p', 'item', 'other'

    const run = (selector) => {
        $c.find(selector).each((_, el) => {
            if (stop) return false;
            const $el = $(el);
            const tag = (el.name || '').toLowerCase();

            // nested block ඇත්නම් ඇතුළේ තියෙන එක විතරක් ගන්නවා
            const nested = tag === 'li' ? 'p, h2, h3, h4, h5, h6, blockquote' : selector;
            if ($el.find(nested).length) return;

            const plain = tidy($el.text().replace(/\s+/g, ' '));
            if (!plain) return;

            const isHeading = /^h[2-6]$/.test(tag);
            const li = tag === 'li' ? el : ($el.closest('li').get(0) || null);
            if (out.length) {
                // article එක ඉවරයි: related / comments heading, author box ("Written by" හෝ author නම heading එකක්)
                const authorBox = isHeading && authorKey && norm(plain) === authorKey;
                const writtenBy = /^written by\b/i.test(plain) && plain.length < 80;
                if ((isHeading && TERMINATOR.test(plain)) || authorBox || writtenBy) { stop = true; return false; }
            }
            // "Source: ..." line එක — SHOW_SOURCE=false නම් ඒකයි ඊට පස්සේ තියෙන ඒවයි post එකට දාන්නේ නැහැ
            const isSourceLine = !li && /^sources?\s*[:：]/i.test(plain);
            if (isSourceLine && !SHOW_SOURCE) { stop = true; return false; }
            // SHOW_SOURCE=true: "Source:" line එකෙන් පස්සේ (© line එක හැර) තියෙන්නේ article එකට අයිති නැති දේවල්
            if (sourceSeen && !/^(©|\(c\)|copyright)/i.test(plain)) { stop = true; return false; }
            if (isSkippable(plain) || (!li && isLinkOnly($el, plain))) return;

            if (isHeading) {
                out.push('🔸 *' + plain.replace(/\*/g, '') + '*');
                lastKind = 'other';
                return;
            }

            let raw = tidy((el.children || []).map((n) => nodeToText(n, tag === 'li' ? LIST_TAGS : NO_TAGS)).join(''));
            // <br> එකකින් පස්සේ "Source: ..." කියලා line එකක් තියෙනවා නම් ඒකත් අයින් කරනවා
            if (!SHOW_SOURCE) raw = raw.split('\n').filter((ln) => !/^\s*sources?\s*[:：]/i.test(ln)).join('\n').trim();
            if (!raw) return;

            const inQuote = tag === 'blockquote' || $el.closest('blockquote').length > 0;

            // <br><br> වලින් වෙන් වුණු කොටස් වෙනම ඡේද කරනවා
            raw.split(/\n{2,}/).forEach((part) => {
                part = part.trim();
                if (!part) return;
                if (li) {
                    const ordered = li.parent && li.parent.name === 'ol';
                    part = (ordered ? ($(li).prevAll('li').length + 1) + '. ' : '▪️ ') + part;
                    // list items (සහ ":" වලින් ඉවර වෙන lead-in ඡේදය) එකට ගොඩගහනවා — අතරමැද හිස් line නැතුව
                    const leadIn = lastKind === 'p' && /:$/.test(out[out.length - 1]);
                    if (lastKind === 'item' || leadIn) out[out.length - 1] += '\n' + part;
                    else out.push(part);
                    lastKind = 'item';
                    return;
                }
                lastKind = inQuote ? 'other' : 'p';
                out.push(inQuote ? '❝ ' + part + ' ❞' : part);
            });

            if (isSourceLine) sourceSeen = true;
        });
    };

    run(BLOCK_SELECTOR);
    // p / li / heading එකක්වත් නැති site වලට — leaf <div> වලින් try කරනවා
    if (!out.length && !$c.find(BLOCK_SELECTOR).length) run(BLOCK_SELECTOR + ', div');

    return out.filter((s, i) => s !== out[i - 1]);              // එක දිගට එකම ඡේදය දෙපාරක් නැහැ
}

const isInside = (node, ancestor) => {
    for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
    return false;
};

// article body එක තියෙන තැන auto-detect කරනවා (class names මත යැපෙන්නේ නැහැ):
// paragraph text වැඩිපුරම තියෙන container එක, RSS excerpt එකෙන් පටන් ගන්න paragraph එක ඇතුළත්ව
function findArticleRoot($, hints) {
    const scores = new Map();
    let anchor = null;

    $('p').each((_, el) => {
        const $p = $(el);
        if ($p.closest('header, footer, nav, aside').length) return;
        const text = $p.text().replace(/\s+/g, ' ').trim();
        if (text.length < 40) return;
        if ($p.find('a').text().length / text.length > 0.5) return;   // menu / related links

        if (!anchor) {
            const key = norm(text);
            if (hints.some((h) => key.startsWith(h))) anchor = el;
        }
        const parent = el.parent;
        if (!parent) return;
        scores.set(parent, (scores.get(parent) || 0) + text.length);
        if (parent.parent) scores.set(parent.parent, (scores.get(parent.parent) || 0) + text.length / 2);
    });

    let best = null;
    let bestScore = 0;
    scores.forEach((score, node) => {
        if (anchor && !isInside(anchor, node)) return;
        if (score > bestScore) { best = node; bestScore = score; }
    });
    return best ? $(best) : null;
}

function absoluteUrl(src, base) {
    if (!src || /^data:/i.test(src)) return null;
    try { return new URL(src, base).href; } catch (e) { return null; }
}

// og:image එක MB ගණන් ලොකු original එක. Card එකට page එකේම තියෙන 1024px version එක (සැහැල්ලුයි) තෝරනවා
function pickCardImage($, ogImage, base) {
    if (!ogImage) return null;
    const stem = ogImage.replace(/\.[a-z0-9]+(\?.*)?$/i, '');
    let best = null;
    let bestW = 0;
    $('img').each((_, el) => {
        const $img = $(el);
        const cands = [$img.attr('src'), $img.attr('data-src')]
            .concat(($img.attr('srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0]));
        cands.forEach((c) => {
            const abs = absoluteUrl(c, base);
            const m = abs && abs.indexOf(stem + '-') === 0 && abs.match(/-(\d+)x(\d+)\.[a-z0-9]+$/i);
            if (m && +m[1] <= 1280 && +m[1] > bestW) { best = abs; bestW = +m[1]; }
        });
    });
    return best || ogImage;
}

// page එකේ meta tags වලින් author නම (RSS එකේ නැති වුණොත්)
function metaAuthor($) {
    const label = String($('meta[name="twitter:label1"]').attr('content') || '').toLowerCase();
    const data = $('meta[name="twitter:data1"]').attr('content');
    if (data && /written by|author/.test(label)) return String(data).trim();
    return String($('meta[name="author"]').attr('content') || '').trim();
}

/* ═══════════════ 🌐 Article scrape (full text + ප්‍රධාන පින්තූරය) ═══════════════ */

async function getFullArticleData(url, excerpt, author) {
    const result = { paragraphs: [], image: null, cardImage: null, author: '', tags: [] };
    if (!url) return result;

    try {
        const { data } = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 20000 });
        const $ = cheerio.load(data);

        // RSS excerpt / og:description එකෙන් article එක පටන් ගන්න තැන හොයාගන්නවා
        const hints = [excerpt, $('meta[property="og:description"]').attr('content')]
            .map((h) => norm(decodeText(h)).slice(0, 30))
            .filter((h) => h.length >= 15);

        const candidates = [];
        const auto = findArticleRoot($, hints);
        if (auto) candidates.push({ name: 'auto-detect', $el: auto });
        KNOWN_ROOTS.forEach((sel) => {
            const $el = $(sel).first();
            if ($el.length) candidates.push({ name: sel, $el });
        });

        for (const c of candidates) {
            const paras = extractParagraphs($, c.$el, norm(author));
            if (totalLen(paras) >= 40) {
                result.paragraphs = paras;
                console.log(`📄 Article body (${c.name}): ${paras.length} block(s), ${totalLen(paras)} chars`);
                break;
            }
        }
        if (!result.paragraphs.length) console.log('⚠️ Article body හොයාගන්න බැරි වුණා — RSS excerpt එක පාවිච්චි කරනවා');

        let image = $('meta[property="og:image"]').attr('content')
            || $('meta[name="twitter:image"]').attr('content');
        if (!image && candidates[0]) {
            const $img = candidates[0].$el.find('img').first();
            image = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src');
        }
        result.image = absoluteUrl(image, url);
        result.cardImage = pickCardImage($, result.image, url);

        result.author = metaAuthor($);
        $('meta[property="article:tag"], meta[property="article:section"]').each((_, el) => {
            const v = $(el).attr('content');
            if (v) result.tags.push(String(v));
        });
    } catch (e) {
        console.error('Scrape error:', e.message);
    }
    return result;
}

async function downloadImage(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 15 * 1024 * 1024,
            headers: Object.assign({}, BROWSER_HEADERS, { Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5' })
        });
        if (!String(res.headers['content-type'] || '').startsWith('image/')) return null;
        return Buffer.from(res.data);
    } catch (e) {
        console.error('Image download error:', e.message);
        return null;
    }
}

/* ═══════════════ 📅 date / ✍️ author / 🏷️ hashtags ═══════════════ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "31 Oct 2026 • 4:30 PM" (TZ_OFFSET_MIN කලාපයෙන්)
function formatDate(value) {
    const t = Date.parse(value || '');
    if (!t) return '';
    const d = new Date(t + TZ_OFFSET_MIN * 60000);
    const h24 = d.getUTCHours();
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} • ${h24 % 12 || 12}:${mm} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

const SKIP_TAGS = new Set(['uncategorized', 'news', 'featured', 'misc', 'other']);

function toHashtag(s) {
    const words = String(s || '').replace(/&/g, ' and ').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
    if (!words.length) return '';
    const tag = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return (/^\d+$/.test(tag) || tag.length > 30) ? '' : tag;
}

// #Anime #AnimeNews + feed එකේ categories / tags
function makeHashtags(names) {
    const out = [];
    const seen = new Set();
    ['Anime', 'AnimeNews'].concat(names || []).forEach((n) => {
        const t = toHashtag(n);
        const k = t.toLowerCase();
        if (!t || seen.has(k) || SKIP_TAGS.has(k) || out.length >= MAX_TAGS) return;
        seen.add(k);
        out.push('#' + t);
    });
    return out.join(' ');
}

const cleanName = (s) => String(s || '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();

/* ═══════════════ 🤖 AI summary (මිනිහෙක් type කළා වගේ) ═══════════════ */

// API එකෙන් ආපු response එකේ (JSON / plain text) අදාළ text එක හොයාගන්නවා
const AI_TEXT_KEYS = ['result', 'response', 'answer', 'text', 'output', 'reply', 'content', 'message', 'data', 'candidates', 'parts', 'choices'];
const AI_SKIP_KEYS = /^(status|success|ok|code|error|errors|creator|author|model|usage|time|timestamp|id|type|role)$/i;

function pickAiText(data, depth) {
    depth = depth || 0;
    if (data === null || data === undefined || depth > 8) return '';
    if (typeof data === 'string') return data.trim().length >= 20 ? data : '';
    if (Array.isArray(data)) {
        for (const x of data) {
            const t = pickAiText(x, depth + 1);
            if (t) return t;
        }
        return '';
    }
    if (typeof data === 'object') {
        // error response එකක් නම් ඒකේ message එක summary එකක් විදිහට ගන්නේ නැහැ
        if (data.error || data.success === false || data.status === false) return '';
        if (typeof data.status === 'string' && /error|fail/i.test(data.status)) return '';
        if (typeof data.status === 'number' && data.status >= 400) return '';
        for (const k of AI_TEXT_KEYS) {
            if (k in data) {
                const t = pickAiText(data[k], depth + 1);
                if (t) return t;
            }
        }
        for (const k of Object.keys(data)) {
            if (AI_TEXT_KEYS.includes(k) || AI_SKIP_KEYS.test(k)) continue;
            const t = pickAiText(data[k], depth + 1);
            if (t) return t;
        }
    }
    return '';
}

// AI text එක → මිනිහෙක් type කළා වගේ සරල text එකක් (markdown, "Here is..." intro, em-dash, links අයින් කරනවා)
function cleanSummary(raw, maxChars) {
    let t = String(raw || '').replace(/\r/g, '');
    if (/<\/?(html|body|head|div|script|span|p)\b/i.test(t)) return '';          // error page (HTML) එකක්
    t = t
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')                                      // markdown headings
        .replace(/^\s*(?:[-*•▪]\uFE0F?|\d+[.)])\s+/gm, '')                       // bullets / numbering
        .replace(/[*_~`]+/g, '')                                                 // bold / italic / code markers
        .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'")
        .replace(/\s*[—–]\s*/g, ' - ');                                          // AI වල දැනෙන em-dash එක අයින්
    // "Sure! Here's a quick summary:" වගේ intro line එක
    t = t.replace(/^\s*(?:sure|okay|ok|certainly|of course|here(?:'s| is| are)|summary|tl;?dr|in short|quick take)\b[^\n:]{0,60}:\s*/i, '');
    t = t.replace(/^\s*(?:[-*•▪]\uFE0F?|\d+[.)])\s+/gm, '');                    // intro අයින් කළාම මුලට එන bullet එකත්
    t = t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
    if (/^"[^"]*"$/.test(t)) t = t.slice(1, -1).trim();                          // මුළු text එකම quotes ඇතුළේ නම් විතරයි අයින් කරන්නේ

    // AI එක ප්‍රතික්ෂේප කළ / error text එකක් (මුලින්ම). "I can't wait" වගේ සාමාන්‍ය වාක්‍ය වලට අහුවෙන්නේ නැහැ
    if (/\b(as an ai|ai language model|large language model)\b/i.test(t)) return '';
    if (/^(?:i(?:'m| am) sorry|sorry[,.! ]|i apologi[sz]e|unfortunately,? i|i (?:can(?:'|no)t|cannot|am unable to|'m unable to) (?:access|browse|open|read|view|summari[sz]e|help|assist|provide|fulfil|complete))/i.test(t)) return '';
    if (t.length < 25) return '';

    if (t.length > maxChars) {                                                   // වාක්‍යයක් ඉවර වෙන තැනින් කපනවා
        const cut = t.slice(0, maxChars);
        const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        t = at > maxChars * 0.5 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '') + '…';
    }
    return t;
}

function buildSummaryPrompt(title, text) {
    const lang = /sinhala|සිංහල/i.test(SUMMARY_LANG)
        ? 'Sinhala (use Sinhala script, the way a Sri Lankan anime fan would casually type it)'
        : SUMMARY_LANG;
    return [
        'You are an anime fan typing a quick WhatsApp message to your friends about a news article.',
        `Write a short summary of the news below in ${lang}.`,
        'Rules:',
        '- Maximum 3 short sentences (about 250 characters in total).',
        '- Sound like a real person typing casually: simple natural words and a relaxed tone. Do NOT sound like an AI, a press release or a news anchor.',
        '- Plain text only: no markdown, no asterisks, no bullet points, no headings, no hashtags, no links.',
        '- At most one emoji, and only if it feels natural.',
        '- Use only facts from the article. Do not invent anything. Keep anime, studio and character names exactly as they are.',
        '- Do NOT start with "Here is", "Sure", "Summary" or "This article". Output only the summary text itself.',
        '',
        `Title: ${title}`,
        `Article: ${text}`
    ].join('\n');
}

const safeSlice = (s, n) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '');          // surrogate pair එකක් මැදින් කැපෙන්නේ නැහැ
const wellFormed = (s) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');   // අඩකට කැඩුණු emoji අයින් (encodeURIComponent error වළක්වන්න)
const aiShape = (d) => (d && typeof d === 'object')
    ? 'keys: ' + Object.keys(d).slice(0, 8).join(', ')
    : `${typeof d}: ${String(d).slice(0, 80)}`;

async function fetchSummary(title, paragraphs) {
    if (!SUMMARY_ENABLED || !AI_API_URL) return '';

    const text = wellFormed(paragraphs.join(' ')).replace(/[*_~❝❞🔸▪\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
    if (text.length < 80) return '';

    let url;
    try {
        let take = AI_INPUT_CHARS;
        const build = () => AI_API_URL + encodeURIComponent(buildSummaryPrompt(title, safeSlice(text, take)));
        url = build();
        while (url.length > AI_MAX_URL_LEN && take > 300) { take = Math.floor(take * 0.8); url = build(); }
    } catch (e) {
        console.error('⚠️ AI summary: prompt එක හදන්න බැරි වුණා:', e.message);
        return '';
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await axios.get(url, {
                timeout: AI_TIMEOUT_MS,
                headers: Object.assign({}, BROWSER_HEADERS, { Accept: 'application/json, text/plain, */*' })
            });
            const summary = cleanSummary(pickAiText(res.data), SUMMARY_MAX_CHARS);
            if (summary) {
                console.log(`🤖 AI summary ready (${summary.length} chars)`);
                return summary;
            }
            console.log(`⚠️ AI summary: response එකෙන් text එකක් ගන්න බැරි වුණා (${aiShape(res.data)})`);
        } catch (e) {
            console.error(`⚠️ AI summary (try ${attempt}) failed: ${e.message}`);
        }
        if (attempt < 2) await sleep(2500);
    }
    return '';
}

/* ═══════════════ ✨ Post එක ලස්සනට හදන කොටස ═══════════════ */

function buildHeader(a) {
    const lines = [BANNER, DIVIDER];
    if (SHOW_TITLE) lines.push('', `✦ *${a.title}* ✦`);
    const info = [];
    if (a.dateText) info.push(`📅 *Date:* ${a.dateText}`);
    if (a.author)   info.push(`✍️ *Author:* ${a.author}`);
    if (a.hashtags) info.push(`🏷️ ${a.hashtags}`);
    if (info.length) lines.push('', info.join('\n'));
    if (SHOW_TITLE || info.length) lines.push('', DIVIDER);
    return lines.join('\n');
}

const buildFooter = () => `${DIVIDER}\n${FOOTER}\n\n${NO_COPY}`;     // "Don't Copy" line එක හැමවිටම අන්තිමට

// කොටස් limit එක යටතේ එකතු කරනවා
function packPieces(pieces, limit, sep) {
    const out = [];
    let cur = '';
    pieces.forEach((p) => {
        if (cur && (cur + sep + p).length > limit) { out.push(cur); cur = p; }
        else cur = cur ? cur + sep + p : p;
    });
    if (cur) out.push(cur);
    return out;
}

// දිග ඡේදයක් / list එකක් — මුලින් lines අනුව, ඊට පස්සේ වාක්‍ය අනුව, අන්තිමට අකුරු ගණනින් කඩනවා
function splitLong(text, limit) {
    if (text.length <= limit) return [text];
    const hasLines = text.includes('\n');
    const pieces = hasLines ? text.split('\n') : text.split(/(?<=[.!?…。])\s+/);
    if (pieces.length < 2) return text.match(new RegExp('[\\s\\S]{1,' + limit + '}', 'g'));
    return packPieces(pieces, limit, hasLines ? '\n' : ' ')
        .reduce((all, p) => all.concat(p.length > limit ? splitLong(p, limit) : [p]), []);
}

// ඡේද නොකැඩී message කොටස් වලට බෙදනවා
function chunkParagraphs(paragraphs, limit) {
    const chunks = [];
    let current = '';
    paragraphs.forEach((p) => {
        splitLong(p, limit).forEach((piece) => {
            const next = current ? current + '\n\n' + piece : piece;
            if (current && next.length > limit) { chunks.push(current); current = piece; }
            else current = next;
        });
    });
    if (current) chunks.push(current);
    return chunks;
}

// article → { first (පළවෙනි message එකේ text/caption), parts (ඉතිරි normal messages) }
// 'card' style එකේදී full news එකම පළවෙනි message එකට යනවා (TEXT_LIMIT එකට ගැලපෙනවා නම්).
// ගැලපෙන්නේ නැත්නම් ගැලපෙන තරම් පළවෙනි message එකේ, ඉතිරිය normal messages විදිහට
function composePost(a, style) {
    const header = buildHeader(a);
    const footer = buildFooter();
    const limit = style === 'card' ? TEXT_LIMIT : CAPTION_LIMIT;

    const blocks = [];
    if (a.summary) blocks.push(`${SUMMARY_LABEL}\n${a.summary}\n\n${DIVIDER}`);
    const body = a.paragraphs.slice();
    if (body.length) body[0] = `${BODY_LABEL}\n\n${body[0]}`;
    const paras = blocks.concat(body);

    // 1) හැමදේම එක message එකකට ගැලපෙනවා නම් — එකම post එකයි
    const whole = [header].concat(paras, [footer]).join('\n\n');
    if (whole.length <= limit) return { first: whole, parts: [] };

    // 2) header + ගැලපෙන තරම් ඡේද පළවෙනි message එකට
    let first = header;
    let used = 0;
    while (used < paras.length && (first + '\n\n' + paras[used]).length <= limit) {
        first += '\n\n' + paras[used++];
    }

    // 3) ඉතිරි ඡේද → normal text messages
    const parts = chunkParagraphs(paras.slice(used), TEXT_LIMIT);

    // 4) footer + "Don't Copy" line එක අන්තිම message එකට
    if (!parts.length) {
        if ((first + '\n\n' + footer).length <= limit) first += '\n\n' + footer;
        else parts.push(footer);
    } else if ((parts[parts.length - 1] + '\n\n' + footer).length <= TEXT_LIMIT) {
        parts[parts.length - 1] += '\n\n' + footer;
    } else {
        parts.push(footer);
    }
    return { first, parts };
}

// RSS item එකකින් post එකට ඕන දේවල් ඔක්කොම හදනවා
async function prepareArticle(item, needBuffer) {
    const link = item.link || '';
    const excerpt = decodeText(item.content || item.contentSnippet || '');

    console.log(`🔗 Scraping full article: ${link}`);
    const scraped = await getFullArticleData(link, excerpt, item.creator);

    let paragraphs = scraped.paragraphs;
    if (!paragraphs.length && excerpt) paragraphs = [excerpt];

    // ඉතා දිග article එකක් නම් කපනවා
    const limited = [];
    let total = 0;
    for (const p of paragraphs) {
        if (total + p.length > MAX_ARTICLE_CHARS) { limited.push('…'); break; }
        limited.push(p);
        total += p.length + 2;
    }

    const title = String(item.title || 'No title').replace(/\*/g, '').trim();
    const summary = await fetchSummary(title, limited);

    const imageUrl = (item.enclosure && item.enclosure.url) || scraped.image;
    const buffer = needBuffer ? await downloadImage(imageUrl) : null;

    return {
        title,
        link,
        author: cleanName(item.creator || scraped.author),
        dateText: formatDate(item.isoDate || item.pubDate),
        hashtags: makeHashtags((item.categories || []).concat(scraped.tags)),
        summary,
        paragraphs: limited,
        cardImage: scraped.cardImage || imageUrl || null,        // 'card' style එකට (සැහැල්ලු version එක)
        image: buffer || (imageUrl ? { url: imageUrl } : null)   // 'image' style එකට
    };
}

/* ═══════════════ 📢 View channel ═══════════════ */

// VIEW_CHANNEL_JID එක (හෝ VIEW_CHANNEL_LINK එකෙන් හොයාගත්ත JID එක) → { jid, name } | null
async function resolveChannel(sock) {
    if (G.channel) return G.channel;
    let jid = VIEW_CHANNEL_JID;
    let name = VIEW_CHANNEL_NAME;

    if (jid && !CHANNEL_OK) return null;                     // JID එක වැරදි (@newsletter නැහැ) — load වෙද්දීම warn කළා

    if (!jid) {
        const m = VIEW_CHANNEL_LINK.match(/whatsapp\.com\/channel\/([\w-]+)/i);
        if (!m || typeof sock.newsletterMetadata !== 'function') return null;
        try {
            const meta = await sock.newsletterMetadata('invite', m[1]);
            const id = meta && (meta.id || meta.jid);
            if (id && isNewsletter(id)) {
                jid = id;
                if (!CFG.VIEW_CHANNEL_NAME) {
                    let n = meta.name || (meta.thread_metadata && meta.thread_metadata.name);
                    if (n && typeof n === 'object') n = n.text;
                    if (n) name = String(n);
                }
                console.log(`📢 Anime news: channel link එකෙන් JID එක හොයාගත්තා → ${jid}`);
            }
        } catch (e) {
            console.error('⚠️ Anime news: channel link එකෙන් JID එක ගන්න බැරි වුණා:', e.message);
        }
    }
    if (!jid) return null;
    G.channel = { jid, name };
    return G.channel;
}

/* ═══════════════ 📤 යවන කොටස (Reply style + View channel + Anti-Ban typing simulation) ═══════════════ */

// "View channel" button එකයි card එකයි හදන contextInfo
function buildContext(a, style, channel) {
    const ctx = {};

    if (channel) {
        // channel එකකින් forward කරපු message එකක් විදිහට පේනවා → උඩින් channel නම, යටින් "View channel" button
        ctx.forwardingScore = 999;
        ctx.isForwarded = true;
        ctx.forwardedNewsletterMessageInfo = {
            newsletterJid: channel.jid,
            newsletterName: channel.name,
            serverMessageId: NEWSLETTER_MSG_ID
        };
    }

    if (style === 'card' && a.cardImage) {
        ctx.externalAdReply = {
            title: a.title,
            body: CARD_BODY,
            mediaType: 1,
            renderLargerThumbnail: true,
            showAdAttribution: false,
            thumbnailUrl: a.cardImage,
            // card එක tap කළාම යන තැන: channel link එක (දාලා නැත්නම් SHOW_SOURCE=true නම් article එක, නැත්නම් whatsapp.com)
            sourceUrl: VIEW_CHANNEL_LINK || (SHOW_SOURCE ? a.link : 'https://whatsapp.com')
        };
    }
    return Object.keys(ctx).length ? ctx : null;
}

// Reply style: නමක් (QUOTE_NAME) තියෙන contact card එකකට reply කළා වගේ පේන්න
function buildQuoted() {
    const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:;${QUOTE_NAME};;;`,
        `FN:${QUOTE_NAME}`,
        'item1.TEL;waid=0:0',
        'item1.X-ABLabel:Mobile',
        'END:VCARD'
    ].join('\n');
    return {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
            id: '3EB0' + Math.random().toString(16).slice(2, 18).toUpperCase()
        },
        message: { contactMessage: { displayName: QUOTE_NAME, vcard } }
    };
}

const withCtx = (content, ctx) => (ctx ? Object.assign({}, content, { contextInfo: ctx }) : content);

async function typing(sock, jid, text) {
    try {
        if (isNewsletter(jid)) { await sleep(1500); return; }
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(Math.min(4000, text.length * 20 + 1000));
        await sock.sendPresenceUpdate('paused', jid);
        await sleep(500 + Math.random() * 1000);
    } catch (e) { /* presence error එකකින් post එක නවතින්න ඕන නැහැ */ }
}

// send error එකක් මොන වර්ගයද:
//   'unsure' → timeout වගේ (message එක ගිහින් තියෙන්නත් පුළුවන්) → ආයේ යවන්නේ නැහැ
//   'closed' → connection නැහැ (නොගියා ෂුවර්) → ඊළඟ check එකේදී ආයේ try
//   'build'  → message එක හදද්දී වුණු error එකක් → සරල format එකකින් ආයේ try කරනවා
function classifyError(e) {
    const msg = String((e && e.message) || e || '');
    const code = e && e.output && e.output.statusCode;
    if (code === 408 || /time(d)?[ -]?out|ETIMEDOUT|ECONNRESET|socket hang up|connection lost/i.test(msg)) return 'unsure';
    if (code === 428 || /connection closed|not connected|stream errored/i.test(msg)) return 'closed';
    return 'build';
}

const describeSend = (c, o) => [
    c.image ? 'image' : 'text',
    c.contextInfo && c.contextInfo.externalAdReply ? 'card' : '',
    c.contextInfo && c.contextInfo.forwardedNewsletterMessageInfo ? 'View channel' : '',
    o.quoted ? 'reply' : ''
].filter(Boolean).join(' + ');

// පළවෙනි message එක (reply + card / image + View channel), ඒක අසාර්ථක වුණොත් සරල format වලින්. ඉතිරි කොටස් normal messages.
// return: 'sent' (ගියා) | 'unsure' (ගියාද කියලා දන්නේ නැහැ) | 'failed' (නොගියා)
async function sendPost(sock, jid, article, post, style, channel) {
    const isChannel = isNewsletter(jid);
    const ctx = isChannel ? null : buildContext(article, style, channel);   // channel එකේ ඇතුළටම "View channel" / reply ඕන නැහැ
    const quoted = (isChannel || !QUOTE_ENABLED) ? null : buildQuoted();

    const base = (style === 'image' && article.image)
        ? { image: article.image, caption: post.first }
        : { text: post.first };
    const rich = withCtx(base, ctx);

    const attempts = [];
    const add = (content, opts) => {
        const sig = [!!content.image, !!content.contextInfo, !!opts.quoted].join('|');
        if (!attempts.some((a) => a.sig === sig)) attempts.push({ sig, content, opts });
    };
    add(rich, quoted ? { quoted } : {});     // 1) reply + View channel + card / image
    if (quoted) add(rich, {});               // 2) reply නැතුව
    add({ text: post.first }, {});           // 3) අන්තිම ආරක්ෂාව: සාමාන්‍ය text (full news normal විදිහට)

    await typing(sock, jid, post.first);

    let kind = null;
    for (const at of attempts) {
        const label = describeSend(at.content, at.opts);
        try {
            await sock.sendMessage(jid, at.content, at.opts);
            kind = label;
            break;
        } catch (e) {
            console.error(`⚠️ Send failed (${label}) → ${jid}: ${e.message}`);
            const type = classifyError(e);
            if (type === 'unsure') return 'unsure';
            if (type === 'closed') return 'failed';
        }
    }
    if (!kind) {
        console.error(`❌ Failed to send anime news → ${jid}`);
        return 'failed';
    }

    try {
        for (const part of post.parts) {
            await sleep(1500 + Math.random() * 1500);
            await typing(sock, jid, part);
            await sock.sendMessage(jid, { text: part });
        }
    } catch (e) {
        console.error(`⚠️ Follow-up message failed → ${jid}:`, e.message);
    }
    console.log(`✅ Anime news sent → ${jid} (${kind}, ${1 + post.parts.length} message(s))`);
    return 'sent';
}

/* ═══════════════ 🔍 Feed එක check කරන කොටස ═══════════════ */

function socketReady(sock) {
    try {
        if (!sock || typeof sock.sendMessage !== 'function') return false;
        const ws = sock.ws;
        if (ws) {
            if (typeof ws.isOpen === 'boolean') return ws.isOpen;
            if (typeof ws.readyState === 'number') return ws.readyState === 1;
            if (ws.socket && typeof ws.socket.readyState === 'number') return ws.socket.readyState === 1;
        }
        return true;
    } catch (e) { return true; }
}

const pickSocket = () => Object.values(global.activeSockets || {}).filter(Boolean).find(socketReady) || null;

async function runCheck() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    const targets = (config.ANIME_NEWS.TARGET_JIDS || []).map((j) => String(j || '').trim()).filter(Boolean);
    if (targets.length === 0) return;

    const sock = pickSocket();
    if (!sock) return 'no-socket';                           // bot connect වෙලා නැහැ

    try {
        console.log('🔍 Anime news: checking Anime Corner feed...');
        const feed = await parser.parseURL(FEED_URL);
        const items = (feed.items || []).filter((i) => itemKeys(i).length);

        mergeDisk();                                         // වෙන process එකක් ලියපු දේවල් බලාගන්නවා

        // පළවෙනි run එක: feed එකේ දැනට තියෙන news "යවලා ඉවරයි" කියලා mark කරනවා.
        // (restart වුණාම පරණ news ආයේ යන්නේ නැති වෙන්න — මෙතැන් පටන් අලුත් news විතරක් යනවා)
        if (G.fresh) {
            G.fresh = false;
            const skip = POST_LATEST_ON_FIRST_RUN ? items.slice(MAX_PER_CHECK) : items;
            skip.forEach(markSeen);
            saveState();
            console.log(`📰 Anime news: පළවෙනි run එක — දැනට තියෙන news ${skip.length}ක් skip කළා. මෙතැන් පටන් අලුත් news විතරක් යවනවා.`);
        }

        const unseen = items.filter((i) => !isSeen(i));
        const stale = unseen.filter(isTooOld);
        if (stale.length) {
            stale.forEach(markSeen);
            saveState();
        }

        // පරණම එක මුලින් — chronological order එකෙන් යවන්න
        const pending = unseen.filter((i) => !isTooOld(i)).reverse();
        if (pending.length === 0) return;

        console.log(`📰 Anime news: ${pending.length} new article(s) found.`);

        const channel = await resolveChannel(sock);
        const needBuffer = POST_STYLE === 'image' || targets.some(isNewsletter);

        let handled = 0;
        for (const item of pending) {
            if (handled >= MAX_PER_CHECK) break;
            // යවන්න කලින්ම file එකේ "claim" කරනවා — restart / crash වුණත්, වෙන process එකක් දුවනවා නම් ඒකටත් ආයේ යන්නේ නැහැ
            if (!claim(item)) continue;
            handled++;

            let article;
            try {
                article = await prepareArticle(item, needBuffer);
            } catch (e) {
                giveBack(item, 'article එක හදන්න බැරි වුණා: ' + e.message);
                continue;
            }

            const posts = {};
            const results = [];
            for (let i = 0; i < targets.length; i++) {
                const jid = targets[i];
                const style = isNewsletter(jid) ? 'image' : POST_STYLE;
                if (!posts[style]) posts[style] = composePost(article, style);
                results.push(await sendPost(sock, jid, article, posts[style], style, channel));
                if (i < targets.length - 1) await sleep(2000 + Math.random() * 3000);
            }

            // කිසිම JID එකකට යන්න බැරි වුණොත් (connection නැතිව) ඊළඟ check එකේදී ආයේ try කරන්න
            if (results.every((r) => r === 'failed')) giveBack(item, 'send failed');
        }
    } catch (e) {
        console.error('❌ Anime news check error:', e.message);
    }
}

// check එකක් ඉවර වෙන්න කලින් ඊළඟ එක පටන් ගන්නේ නැහැ
async function checkAnimeNews() {
    if (G.running) return;
    G.running = true;
    try {
        const r = await runCheck();
        if (r === 'no-socket') {
            // bot තාම connect වෙලා නැත්නම් විනාඩියකට පස්සේ ආයේ බලනවා (උපරිම 5 පාරක්)
            G.socketRetries = (G.socketRetries || 0) + 1;
            if (G.socketRetries <= 5) {
                clearTimeout(G.retryTimer);
                G.retryTimer = setTimeout(checkAnimeNews, 60 * 1000);
            } else {
                G.socketRetries = 0;
            }
        } else {
            G.socketRetries = 0;
        }
    } finally { G.running = false; }
}

if (config.ANIME_NEWS && config.ANIME_NEWS.ENABLED) {
    // plugin එක reload / reconnect වෙලා දෙපාරක් load වුණත් timer එකක් විතරක් දුවන්න
    clearTimeout(G.startTimer);
    clearTimeout(G.retryTimer);
    clearInterval(G.timer);

    const intervalMs = (config.ANIME_NEWS.INTERVAL_MINUTES || 30) * 60 * 1000;
    G.startTimer = setTimeout(() => {
        checkAnimeNews();
        G.timer = setInterval(checkAnimeNews, intervalMs);
    }, START_DELAY_SEC * 1000);

    console.log('📰 Anime News Auto-Poster loaded. Interval:', config.ANIME_NEWS.INTERVAL_MINUTES, 'min | style:', POST_STYLE,
        '| reply:', QUOTE_ENABLED ? QUOTE_NAME : 'off', '| AI summary:', SUMMARY_ENABLED ? SUMMARY_LANG : 'off');
    if (!VIEW_CHANNEL_JID && !VIEW_CHANNEL_LINK) console.log('ℹ️ Anime news: VIEW_CHANNEL_JID දාලා නැහැ — "View channel" button එක වැටෙන්නේ නැහැ.');
    else if (VIEW_CHANNEL_JID && !CHANNEL_OK) console.log('⚠️ Anime news: VIEW_CHANNEL_JID එක "@newsletter" වලින් ඉවර වෙන්න ඕන — button එක වැටෙන්නේ නැහැ.');
}
