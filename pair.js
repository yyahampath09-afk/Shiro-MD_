require('dotenv').config();

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const config = require('./config');
const axios = require('axios');
const mongoose = require('mongoose');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    generateForwardMessageContent,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

const { getBuffer, getGroupAdmins, runtime } = require('./lib/functions');
const { sms } = require('./lib/msg');
const NodeCache = require('node-cache');
const util = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_BASE_PATH = './sessions';
const msgRetryCounterCache = new NodeCache();

require('events').EventEmitter.defaultMaxListeners = 500;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI missing in .env — exiting.');
    process.exit(1);
}

mongoose.connect(MONGODB_URI)
    .then(() => console.log('𝐌ᴏɴɢᴏ𝐃𝐁 𝐂ᴏɴɴᴇᴄᴛᴇᴅ ✅'))
    .catch(err => console.log('❌ 𝐌ᴏɴɢᴏ𝐃𝐁 ᴇʀʀᴏ:', err));

const SessionSchema = new mongoose.Schema({
    sessionId: String,
    data: Object
});
const Session = mongoose.model('Session', SessionSchema);

// Load plugins
fs.readdirSync("./plugins/").forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() == ".js") {
        require("./plugins/" + plugin);
    }
});
console.log('𝐀ʟʟ 𝐏ʟᴜɢɪɴꜱ 𝐈ɴꜱᴛᴀʟʟᴇ𝐃 ⚡');

const events = require('./command');

const commandMap = new Map();
for (const cmd of events.commands) {
    if (cmd.pattern) commandMap.set(cmd.pattern, cmd);
    if (cmd.alias) {
        for (const alias of cmd.alias) {
            if (!commandMap.has(alias)) commandMap.set(alias, cmd);
        }
    }
}

app.use(express.static(path.join(__dirname, 'public')));

const activeSockets = {};
global.activeSockets = activeSockets;
const keepAliveTimers = {};
const reconnectTimers = {};
const fileCache = {};
const saveDebounceTimers = {};

// 👇 Fake Quote Object එක 👇
const adhimini = { 
    key: { 
        remoteJid: "status@broadcast", 
        fromMe: false, 
        id: 'FAKE_META_ID_001', 
        participant: '13135550002@s.whatsapp.net' 
    }, 
    message: { 
        contactMessage: { 
            displayName: '@𝙰𝙽𝙶𝙻𝙴 𝙼𝙸𝙽𝙸✨', 
            vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
    } 
};

function cleanupSession(sessionId) {
    if (keepAliveTimers[sessionId]) {
        clearInterval(keepAliveTimers[sessionId]);
        delete keepAliveTimers[sessionId];
    }
    if (reconnectTimers[sessionId]) {
        clearTimeout(reconnectTimers[sessionId]);
        delete reconnectTimers[sessionId];
    }
    if (saveDebounceTimers[sessionId]) {
        clearTimeout(saveDebounceTimers[sessionId]);
        delete saveDebounceTimers[sessionId];
    }
    const sock = activeSockets[sessionId];
    if (sock) {
        try {
            sock.ev.removeAllListeners();
            sock.ws?.terminate?.();
        } catch (e) {}
        delete activeSockets[sessionId];
    }
}

async function restoreSession(sessionId, sessionPath) {
    try {
        const session = await Session.findOne({ sessionId });
        if (!session) return false;
        await fs.ensureDir(sessionPath);
        for (const file in session.data) {
            await fs.writeFile(path.join(sessionPath, file), session.data[file]);
        }
        console.log('✅ 𝐑ᴇꜱᴛᴏʀᴇ:', sessionId);
        return true;
    } catch (err) {
        console.error('𝐑ᴇꜱᴛᴏʀᴇ error:', err);
        return false;
    }
}

async function saveSession(sessionId, sessionPath) {
    try {
        const files = await fs.readdir(sessionPath);
        let data = {};
        let hasChanges = false;

        for (const file of files) {
            try {
                const content = await fs.readFile(path.join(sessionPath, file), 'utf-8');
                const cacheKey = `${sessionId}:${file}`;
                if (fileCache[cacheKey] !== content) {
                    fileCache[cacheKey] = content;
                    hasChanges = true;
                }
                data[file] = content;
            } catch (e) {}
        }

        if (!hasChanges) {
            console.log('No changes, skipping DB write:', sessionId);
            return;
        }

        await Session.findOneAndUpdate({ sessionId }, { data }, { upsert: true });
        console.log('💾 𝐒aved:', sessionId);
    } catch (err) {
        console.error('𝐒ave𝐒ession error:', err);
    }
}

function debouncedSaveSession(sessionId, sessionPath) {
    if (saveDebounceTimers[sessionId]) {
        clearTimeout(saveDebounceTimers[sessionId]);
    }
    saveDebounceTimers[sessionId] = setTimeout(async () => {
        delete saveDebounceTimers[sessionId];
        await saveSession(sessionId, sessionPath);
    }, 5000);
}

async function Pair(number, res = null) {
    const xnumber = number.replace(/[^0-9]/g, '');
    const sessionId = `dina_${xnumber}`;
    const sessionPath = path.join(SESSION_BASE_PATH, sessionId);

    if (activeSockets[sessionId]) {
        console.log('𝐒ocket already active for:', sessionId);
        if (res && !res.headersSent) res.json({ error: 'Session already active. Please wait.' });
        return;
    }

    try {
        await restoreSession(sessionId, sessionPath);
        await fs.ensureDir(sessionPath);

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        const logger = pino({ level: 'silent' });

        const sock = makeWASocket({
            version,
            logger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            msgRetryCounterCache
        });

        activeSockets[sessionId] = sock;

        sock.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
            const r = await axios.head(url);
            const mime = r.headers['content-type'];
            if (mime.split("/")[1] === "gif")
                return sock.sendMessage(jid, { video: await getBuffer(url), caption, gifPlayback: true, ...options }, { quoted });
            if (mime === "application/pdf")
                return sock.sendMessage(jid, { document: await getBuffer(url), mimetype: 'application/pdf', caption, ...options }, { quoted });
            if (mime.split("/")[0] === "image")
                return sock.sendMessage(jid, { image: await getBuffer(url), caption, ...options }, { quoted });
            if (mime.split("/")[0] === "video")
                return sock.sendMessage(jid, { video: await getBuffer(url), caption, mimetype: 'video/mp4', ...options }, { quoted });
            if (mime.split("/")[0] === "audio")
                return sock.sendMessage(jid, { audio: await getBuffer(url), caption, mimetype: 'audio/mpeg', ...options }, { quoted });
        };

        sock.edite = async (gg, newmg, from) => {
            await sock.relayMessage(from, {
                protocolMessage: { key: gg.key, type: 14, editedMessage: { conversation: newmg } }
            }, {});
        };

        sock.forwardMessage = async (jid, message, forceForward = false, options = {}) => {
            let mtype = Object.keys(message.message)[0];
            let content = await generateForwardMessageContent(message, forceForward);
            let ctype = Object.keys(content)[0];
            let context = mtype !== "conversation" ? message.message[mtype].contextInfo : {};
            content[ctype].contextInfo = { ...context, ...content[ctype].contextInfo };
            const waMessage = await generateWAMessageFromContent(jid, content, options ? {
                ...content[ctype], ...options,
                ...(options.contextInfo ? { contextInfo: { ...content[ctype].contextInfo, ...options.contextInfo } } : {})
            } : {});
            await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
            return waMessage;
        };

        let pairingCode = null;
        let responded = false;

        if (!sock.authState.creds.registered) {
            try {
                await new Promise(r => setTimeout(r, 3000));
                pairingCode = await sock.requestPairingCode(xnumber);
                console.log('🔑 Pairing Code:', pairingCode);
                if (res && !res.headersSent) { res.json({ code: pairingCode }); responded = true; }
            } catch (pairErr) {
                console.error('Pairing code request failed:', pairErr);
                if (res && !res.headersSent) { res.json({ error: 'Failed to generate pairing code. Try again.' }); responded = true; }
                cleanupSession(sessionId);
                return;
            }
        } else {
            console.log('Already registered:', sessionId);
            if (res && !res.headersSent) { res.json({ error: 'This number is already paired.' }); responded = true; }
        }

        if (res && !responded) {
            setTimeout(() => {
                if (!res.headersSent) res.json({ error: 'Pairing timed out. Try again.' });
            }, 15000);
        }

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            debouncedSaveSession(sessionId, sessionPath);
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                console.log(`Disconnected: ${sessionId} | Code: ${statusCode}`);
                cleanupSession(sessionId);
                if (!isLoggedOut) {
                    console.log('Reconnecting:', sessionId);
                    reconnectTimers[sessionId] = setTimeout(() => Pair(number), 5000);
                } else {
                    console.log('Logged out:', sessionId);
                    await Session.findOneAndDelete({ sessionId });
                    await fs.remove(sessionPath);
                }
            } else if (connection === 'open') {
                console.log('✅ 𝐂onnected:', sessionId);

                keepAliveTimers[sessionId] = setInterval(async () => {
                    if (!activeSockets[sessionId]) {
                        clearInterval(keepAliveTimers[sessionId]);
                        delete keepAliveTimers[sessionId];
                        return;
                    }
                    sock.sendPresenceUpdate('available', sock.user.id).catch(() => {
                        console.log('Keep-alive failed:', sessionId);
                        cleanupSession(sessionId);
                        reconnectTimers[sessionId] = setTimeout(() => Pair(number), 3000);
                    });
                }, 30000);

                try {
                    const jid = xnumber + '@s.whatsapp.net';
                    await sock.sendMessage(jid, {
                        text: `*Bot Active!*\n\nYour bot is now connected successfully.\nPairing code used: *${pairingCode ?? 'Already registered'}*`
                    });
                } catch (e) {
                    console.error('Welcome message failed:', e);
                }
            }
        });

        sock.ev.on('messages.upsert', async (event) => {
            try {
                if (event.type !== 'notify') return;
                
                for (const mek of event.messages) {
                    if (!mek.message) continue;
                    if (mek.key && mek.key.remoteJid === 'status@broadcast') continue;
                    if (mek.key.fromMe) continue;

                    mek.message = (getContentType(mek.message) === 'ephemeralMessage')
                        ? mek.message.ephemeralMessage.message
                        : mek.message;

                    const m = sms(sock, mek);
                    const type = getContentType(mek.message);
                    const from = mek.key.remoteJid;

                    const body =
                        type === 'conversation' ? mek.message.conversation :
                        type === 'extendedTextMessage' ? mek.message.extendedTextMessage.text :
                        type === 'imageMessage' && mek.message.imageMessage?.caption ? mek.message.imageMessage.caption :
                        type === 'videoMessage' && mek.message.videoMessage?.caption ? mek.message.videoMessage.caption :
                        type === 'interactiveResponseMessage' ? (() => {
                            try { return JSON.parse(mek.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson)?.id || ''; }
                            catch { return ''; }
                        })() :
                        type === 'templateButtonReplyMessage' ? mek.message.templateButtonReplyMessage?.selectedId :
                        m.msg?.text || m.msg?.conversation || m.msg?.caption || '';

                    const prefix = config.PREFIX;
                    const isCmd = body.startsWith(prefix);
                    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
                    const args = body.trim().split(/ +/).slice(1);
                    const q = args.join(' ');
                    
                    const isGroup = from.endsWith('@g.us');
                    const sender = mek.key.fromMe
                        ? (sock.user.id.split(':')[0] + '@s.whatsapp.net')
                        : (mek.key.participant || mek.key.remoteJid);
                    const senderNumber = sender.split('@')[0];
                    const botNumber = sock.user.id.split(':')[0];
                    const botNumber2 = await jidNormalizedUser(sock.user.id);
                    const pushname = mek.pushName || 'User';
                    const isMe = botNumber.includes(senderNumber);
                    const isOwner = isMe || (xnumber === senderNumber);

                    let groupMetadata = null;
                    let groupName = '';
                    let participants = [];
                    let groupAdmins = [];
                    let isBotAdmins = false;
                    let isAdmins = false;

                    if (isGroup) {
                        try {
                            groupMetadata = await sock.groupMetadata(from);
                            groupName = groupMetadata.subject || '';
                            participants = groupMetadata.participants || [];
                            groupAdmins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
                            
                            const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                            isBotAdmins = groupAdmins.includes(botId) || groupAdmins.includes(botNumber2);
                            isAdmins = groupAdmins.includes(sender);
                        } catch (err) {
                            console.log("Group Metadata Error:", err.message);
                        }
                    }

                    // 👇 SHH AUTO DELETE LOGIC 👇
                    if (isGroup && !isMe && isBotAdmins && global.shhList && global.shhList[from]) {
                        try {
                            const shhTargets = global.shhList[from];
                            if (Array.isArray(shhTargets) && (shhTargets.includes('ALL') || shhTargets.includes(sender))) {
                                await sock.sendMessage(from, { delete: mek.key });
                                continue; 
                            }
                        } catch (err) {
                            console.log("Shh delete error:", err.message);
                        }
                    }
                    // 👆 --------------------- 👆

                    const reply = async (teks) =>
                        await sock.sendMessage(from, { text: teks }, { quoted: adhimini });

                    if (isCmd) {
                        await sock.readMessages([mek.key]);

                        const cmd = commandMap.get(command);
                        if (cmd) {
                            if (cmd.react) sock.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
                            try {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isCmd, command, args, q,
                                    isGroup, sender, senderNumber, botNumber2, botNumber,
                                    pushname, isMe, isOwner, groupMetadata, groupName,
                                    participants, groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } catch (e) {
                                console.error('[PLUGIN ERROR]', e);
                            }
                        }
                    }

                    for (const cmd of events.commands) {
                        try {
                            if (body && cmd.on === 'body') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isSudo: false, isCmd,
                                    command, args, q, isPre: false, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (mek.q && cmd.on === 'text') {
                                await cmd.function(sock, mek, m, {
                                    from, quoted: [], body, isSudo: false, isCmd, isPre: false,
                                    command, args, q, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if ((cmd.on === 'image' || cmd.on === 'photo') && mek.type === 'imageMessage') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], isSudo: false, body, isCmd,
                                    command, isPre: false, args, q, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (cmd.on === 'sticker' && mek.type === 'stickerMessage') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], isSudo: false, body, isCmd,
                                    command, args, isPre: false, q, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            }
                        } catch (e) {
                            console.error('[CMD MAP ERROR]', e);
                        }
                    }

                    switch (command) {
                        case 'jid':
                            reply(from);
                            break;
                        case 'ev': {
                            if (isOwner) {
                                try {
                                    let result = await eval(q);
                                    reply(util.format(result));
                                } catch (err) {
                                    reply(util.format(err));
                                }
                            }
                            break;
                        }
                        default:
                            break;
                    }

                } // 👈 for loop එක වහන තැන
            } catch (e) {
                console.error('[MESSAGE ERROR]', String(e));
            }
        });

    } catch (err) {
        console.error('Pair Error:', err);
        cleanupSession(sessionId);
        if (res && !res.headersSent) res.json({ error: 'Pair failed: ' + err.message });
    }
}

async function restoreAllSessions() {
    try {
        const sessions = await Session.find();
        console.log(`Restoring ${sessions.length} session(s)...`);

        await Promise.all(
            sessions
                .filter(s => {
                    if (!s.sessionId) { console.warn('Skipping session without sessionId:', s); return false; }
                    return true;
                })
                .map(async (s, index) => {
                    const number = s.sessionId.replace('dina_', '');
                    try {
                        await new Promise(r => setTimeout(r, index * 500));
                        await Pair(number);
                    } catch (err) {
                        console.error('Failed to restore session', s.sessionId, err);
                    }
                })
        );
    } catch (err) {
        console.error('restoreAllSessions error:', err);
    }
}

app.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: 'Number required' });
    res.setTimeout(30000, () => {
        if (!res.headersSent) res.json({ error: 'Request timed out. Try again.' });
    });
    await Pair(number, res);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await fs.ensureDir(SESSION_BASE_PATH);
    await restoreAllSessions();
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('Socket connection timeout')) return;
    if (e.includes('rate-overlimit')) return;
    if (e.includes('Connection Closed')) return;
    if (e.includes('Value not found')) return;
    console.log('Caught exception:', err);
});