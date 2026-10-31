// plugins/anime-news.js — Auto Anime News Broadcaster
// (Full Article + Image/Card + "View channel" button + No-duplicates + Anti-Ban)
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const CFG = config.ANIME_NEWS || {};

/* ═══════════════ ⚙️ SETTINGS — මෙතනින් වෙනස් කරන්න පුළුවන් ═══════════════ */
const FEED_URL      = 'https://animecorner.me/feed/';
const MAX_PER_CHECK = 2;      // එක check එකකදී යවන උපරිම news ගණන
const MAX_AGE_HOURS = 36;     // මීට පරණ news යවන්නේ නැහැ
const POST_LATEST_ON_FIRST_RUN = true;   // true කළොත් පළවෙනි run එකේදීම අලුත්ම news යවනවා (test කරන්න)

// 📢 "View channel" button — මේක config.js එකේ ANIME_NEWS ඇතුළේ දැම්මත් හරි, මෙතන quotes ඇතුළේ දැම්මත් හරි
const VIEW_CHANNEL_JID  = CFG.VIEW_CHANNEL_JID  || '';              // උදා: '120363XXXXXXXXXXXXXX@newsletter'
const VIEW_CHANNEL_NAME = CFG.VIEW_CHANNEL_NAME || 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ';     // post එකේ උඩින් පේන channel නම
const VIEW_CHANNEL_LINK = CFG.VIEW_CHANNEL_LINK || '';              // (optional) https://whatsapp.com/channel/XXXX — card එක tap කළාම යන තැන

// 🖼️ Post style:
//   'card'  → පින්තූරය ලොකු card එකක් විදිහට + full news එකම message එකේ (ගැලපෙන තරම්)
//   'image' → සාමාන්‍ය image message (caption එකට ගැලපෙන ටික, ඉතුරු normal messages)
const POST_STYLE = (CFG.POST_STYLE === 'image') ? 'image' : 'card';
const CARD_BODY  = '📰 Anime News Update';   // card එකේ title යට පේන පොඩි text එක
const SHOW_TITLE = false;                    // true කළොත් news title එක post එකේ text එකටත් වැටෙනවා

const CAPTION_LIMIT     = 1000;    // 'image' style: caption එකට අකුරු ගණන (WhatsApp limit එක 1024)
const TEXT_LIMIT        = 4000;    // එක message එකකට උපරිම අකුරු ගණන
const MAX_ARTICLE_CHARS = 15000;   // මීට වඩා දිග article එකක් කපනවා (spam / ban වළක්වන්න)

const BANNER  = '📰 *ANIME NEWS* 📰';
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const BT      = String.fromCharCode(96);
const FOOTER  = BT + 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ©↠ᴵⁿᵒˢᵘᵏᵉ' + BT;
const NO_COPY = "> *🚫 Don't Copy This Article/Post  🚫*";
/* ═══════════════════════════════════════════════════════════════════════ */

const CHANNEL_OK = /@newsletter$/.test(VIEW_CHANNEL_JID);

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

const parser = new Parser({ timeout: 20000, headers: BROWSER_HEADERS });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const totalLen = (arr) => arr.reduce((n, s) => n + s.length, 0);

/* ═══════════════ 🔁 Duplicate වළක්වන කොටස ═══════════════
   • යවපු news ලැයිස්තුව file එකක save වෙනවා → bot restart වුණත් ආයේ යන්නේ නැහැ
   • state එක global එකේත් තියෙනවා → plugin එක reload / reconnect එකකදී දෙපාරක් load වුණත්
     timers දෙකක් හැදිලා එකම news දෙපාරක් යන්නේ නැහැ                                          */
const STATE_FILE = path.join(__dirname, '..', 'anime-news-sent.json');
const G = global.__animeNews || (global.__animeNews = {});

function loadState() {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return { sent: new Set(Array.isArray(data.guids) ? data.guids : []), fresh: false };
    } catch (e) {
        return { sent: new Set(), fresh: true };            // file එක නැත්නම් = පළවෙනි run එක
    }
}

function saveState() {
    try {
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ guids: Array.from(G.sent).slice(-300) }));
        fs.renameSync(tmp, STATE_FILE);                      // අඩක් ලියවුණු file එකක් ඉතුරු වෙන්නේ නැහැ
    } catch (e) {
        console.error('⚠️ Anime news: යවපු list එක save කරන්න බැරි වුණා:', e.message);
    }
}

if (!G.sent) Object.assign(G, loadState());

const itemKey = (item) => String(item.guid || item.link || item.title || '').trim();

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

// අකුරු/ඉලක්කම් විතරක් — paragraph දෙකක් සසඳන්න
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

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
            // "Source:" line එකෙන් පස්සේ (© line එක හැර) තියෙන්නේ article එකට අයිති නැති දේවල්
            if (sourceSeen && !/^(©|\(c\)|copyright)/i.test(plain)) { stop = true; return false; }
            if (isSkippable(plain) || (!li && isLinkOnly($el, plain))) return;

            if (isHeading) {
                out.push('🔸 *' + plain.replace(/\*/g, '') + '*');
                lastKind = 'other';
                return;
            }

            const raw = tidy((el.children || []).map((n) => nodeToText(n, tag === 'li' ? LIST_TAGS : NO_TAGS)).join(''));
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

            if (!li && /^sources?\s*[:：]/i.test(plain)) sourceSeen = true;
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

/* ═══════════════ 🌐 Article scrape (full text + ප්‍රධාන පින්තූරය) ═══════════════ */

async function getFullArticleData(url, excerpt, author) {
    const result = { paragraphs: [], image: null, cardImage: null };
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

/* ═══════════════ ✨ Post එක ලස්සනට හදන කොටස ═══════════════ */

function buildHeader(a) {
    let h = `${BANNER}\n${DIVIDER}`;
    if (SHOW_TITLE) h += `\n\n✦ *${a.title}* ✦\n\n${DIVIDER}`;
    return h;
}

const buildFooter = () => `${DIVIDER}\n${FOOTER}\n\n${NO_COPY}`;

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
// 'card' style එකේදී full news එකම පළවෙනි message එකට යනවා (TEXT_LIMIT එකට ගැලපෙනවා නම්)
function composePost(a, style) {
    const header = buildHeader(a);
    const footer = buildFooter();
    const paras = a.paragraphs;
    const limit = style === 'card' ? TEXT_LIMIT : CAPTION_LIMIT;

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

    const imageUrl = (item.enclosure && item.enclosure.url) || scraped.image;
    const buffer = needBuffer ? await downloadImage(imageUrl) : null;

    return {
        title: String(item.title || 'No title').replace(/\*/g, '').trim(),
        link,
        paragraphs: limited,
        cardImage: scraped.cardImage || imageUrl || null,        // 'card' style එකට (සැහැල්ලු version එක)
        image: buffer || (imageUrl ? { url: imageUrl } : null)   // 'image' style එකට
    };
}

/* ═══════════════ 📤 යවන කොටස (View channel + Anti-Ban typing simulation) ═══════════════ */

// "View channel" button එකයි card එකයි හදන contextInfo
function buildContext(a, style) {
    const ctx = {};

    if (VIEW_CHANNEL_JID && CHANNEL_OK) {
        // channel එකකින් forward කරපු message එකක් විදිහට පේනවා → උඩින් channel නම, යටින් "View channel" button
        ctx.forwardingScore = 999;
        ctx.isForwarded = true;
        ctx.forwardedNewsletterMessageInfo = {
            newsletterJid: VIEW_CHANNEL_JID,
            newsletterName: VIEW_CHANNEL_NAME,
            serverMessageId: 143
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
            sourceUrl: VIEW_CHANNEL_LINK || a.link
        };
    }
    return Object.keys(ctx).length ? ctx : null;
}

const withCtx = (content, ctx) => (ctx ? Object.assign({}, content, { contextInfo: ctx }) : content);

async function typing(sock, jid, text) {
    try {
        if (jid.endsWith('@newsletter')) { await sleep(1500); return; }
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(Math.min(4000, text.length * 20 + 1000));
        await sock.sendPresenceUpdate('paused', jid);
        await sleep(500 + Math.random() * 1000);
    } catch (e) { /* presence error එකකින් post එක නවතින්න ඕන නැහැ */ }
}

// පළවෙනි message එක (card / image + View channel), ඒක අසාර්ථක වුණොත් සාමාන්‍ය text. ඉතිරි කොටස් normal messages.
// post එක (අඩුම තරමින් පළවෙනි message එක) ගියා නම් true
async function sendPost(sock, jid, article, post, style) {
    const isChannel = jid.endsWith('@newsletter');
    const ctx = isChannel ? null : buildContext(article, style);   // channel එකේ ඇතුළටම "View channel" ඕන නැහැ

    const attempts = [];
    if (style === 'card') attempts.push(withCtx({ text: post.first }, ctx));
    else if (article.image) attempts.push(withCtx({ image: article.image, caption: post.first }, ctx));
    attempts.push({ text: post.first });                           // අන්තිම ආරක්ෂාව: සාමාන්‍ය text

    await typing(sock, jid, post.first);

    let kind = null;
    for (const content of attempts) {
        try {
            await sock.sendMessage(jid, content);
            kind = content.image ? 'image' : (content.contextInfo && content.contextInfo.externalAdReply ? 'card' : 'text');
            break;
        } catch (e) {
            console.error(`⚠️ Rich message send failed → ${jid}: ${e.message}`);
        }
    }
    if (!kind) {
        console.error(`❌ Failed to send anime news → ${jid}`);
        return false;
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
    console.log(`✅ Anime news sent → ${jid} (${kind}${ctx && ctx.forwardedNewsletterMessageInfo ? ' + View channel' : ''}, ${1 + post.parts.length} message(s))`);
    return true;
}

/* ═══════════════ 🔍 Feed එක check කරන කොටස ═══════════════ */

async function runCheck() {
    if (!config.ANIME_NEWS || !config.ANIME_NEWS.ENABLED) return;
    const targets = config.ANIME_NEWS.TARGET_JIDS;
    if (!targets || targets.length === 0) return;

    const sockets = Object.values(global.activeSockets || {});
    if (sockets.length === 0) return;

    const sock = sockets[0];

    try {
        console.log('🔍 Anime news: checking Anime Corner feed...');
        const feed = await parser.parseURL(FEED_URL);
        const items = (feed.items || []).filter((i) => itemKey(i));

        // පළවෙනි run එක: feed එකේ දැනට තියෙන news "යවලා ඉවරයි" කියලා mark කරනවා.
        // (restart වුණාම පරණ news ආයේ යන්නේ නැති වෙන්න — මෙතැන් පටන් අලුත් news විතරක් යනවා)
        if (G.fresh) {
            G.fresh = false;
            const skip = POST_LATEST_ON_FIRST_RUN ? items.slice(MAX_PER_CHECK) : items;
            skip.forEach((i) => G.sent.add(itemKey(i)));
            saveState();
            console.log(`📰 Anime news: පළවෙනි run එක — දැනට තියෙන news ${skip.length}ක් skip කළා. මෙතැන් පටන් අලුත් news විතරක් යවනවා.`);
        }

        const unseen = items.filter((i) => !G.sent.has(itemKey(i)));
        const stale = unseen.filter(isTooOld);
        if (stale.length) {
            stale.forEach((i) => G.sent.add(itemKey(i)));
            saveState();
        }

        // පරණම එක මුලින් — chronological order එකෙන් යවන්න
        const pending = unseen.filter((i) => !isTooOld(i)).reverse();
        if (pending.length === 0) return;

        console.log(`📰 Anime news: ${pending.length} new article(s) found.`);

        const needBuffer = POST_STYLE === 'image' || targets.some((j) => j.endsWith('@newsletter'));

        for (const item of pending.slice(0, MAX_PER_CHECK)) {
            const key = itemKey(item);
            // restart / crash වුණත් ආයේ යන්නේ නැති වෙන්න යවන්න කලින්ම mark කරනවා
            G.sent.add(key);
            saveState();

            const article = await prepareArticle(item, needBuffer);
            const posts = {};
            let delivered = false;

            for (const jid of targets) {
                const style = jid.endsWith('@newsletter') ? 'image' : POST_STYLE;
                if (!posts[style]) posts[style] = composePost(article, style);
                if (await sendPost(sock, jid, article, posts[style], style)) delivered = true;
                await sleep(2000 + Math.random() * 3000);
            }

            // කිසිම JID එකකට යන්න බැරි වුණොත් ඊළඟ check එකේදී ආයේ try කරන්න
            if (!delivered) {
                G.sent.delete(key);
                saveState();
            }
        }
    } catch (e) {
        console.error('❌ Anime news check error:', e.message);
    }
}

// check එකක් ඉවර වෙන්න කලින් ඊළඟ එක පටන් ගන්නේ නැහැ
async function checkAnimeNews() {
    if (G.running) return;
    G.running = true;
    try { await runCheck(); }
    finally { G.running = false; }
}

if (config.ANIME_NEWS && config.ANIME_NEWS.ENABLED) {
    // plugin එක reload / reconnect වෙලා දෙපාරක් load වුණත් timer එකක් විතරක් දුවන්න
    clearTimeout(G.startTimer);
    clearInterval(G.timer);

    const intervalMs = (config.ANIME_NEWS.INTERVAL_MINUTES || 30) * 60 * 1000;
    G.startTimer = setTimeout(() => {
        checkAnimeNews();
        G.timer = setInterval(checkAnimeNews, intervalMs);
    }, 15000);

    console.log('📰 Anime News Auto-Poster loaded. Interval:', config.ANIME_NEWS.INTERVAL_MINUTES, 'min | style:', POST_STYLE);
    if (!VIEW_CHANNEL_JID) console.log('ℹ️ Anime news: VIEW_CHANNEL_JID දාලා නැහැ — "View channel" button එක වැටෙන්නේ නැහැ.');
    else if (!CHANNEL_OK) console.log('⚠️ Anime news: VIEW_CHANNEL_JID එක "@newsletter" වලින් ඉවර වෙන්න ඕන — button එක වැටෙන්නේ නැහැ.');
}
