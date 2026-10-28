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
} = require('@dnuzi/baileys');

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
    .then(async () => {
        console.log('Mongo db Connected පකෝ ✅');
        
        // 👇 Load Sudo Users from DB 👇
        try {
            const SudoModel = mongoose.models.Sudo || mongoose.model('Sudo', new mongoose.Schema({ number: String }));
            const sudos = await SudoModel.find();
            global.sudoList = sudos.map(s => s.number);
            console.log(`✅ Loaded ${global.sudoList.length} sudo users.`);
        } catch (e) {
            console.log('Sudo load error:', e.message);
            global.sudoList = [];
        }
        // 👆 ------------------------- 👆
    })
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
console.log('plugings ඔක්කොම හරි පකෝ  ⚡');

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
const userCooldowns = new Map();

global.groupCache = new Map();

function cleanupSession(sessionId) {
    if (keepAliveTimers[sessionId]) {
        clearInterval(keepAliveTimers[sessionId]);
        delete keepAliveTimers[sessionId];
    }
    if (keepAliveTimers[`presence_${sessionId}`]) {
        clearInterval(keepAliveTimers[`presence_${sessionId}`]);
        delete keepAliveTimers[`presence_${sessionId}`];
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
            browser: ["Ubuntu", "Chrome", "110.0.5481.77"], 
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
                console.log('🛡️ Custom Anti-Ban System Activated!');

                keepAliveTimers[`presence_${sessionId}`] = setInterval(async () => {
                    try {
                        await sock.sendPresenceUpdate('available', sock.user.id);
                        setTimeout(() => {
                            sock.sendPresenceUpdate('unavailable', sock.user.id).catch(() => {});
                        }, 20000 + Math.random() * 30000); 
                    } catch (e) {}
                }, 2 * 60 * 1000); 

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
                for (const mek of event.messages) {
                    if (!mek.message) continue;
                    if (mek.key && mek.key.remoteJid === 'status@broadcast') continue;
                    if (mek.key.fromMe) continue;

                    // 👇 Auto React for Specific Numbers 👇
                    const autoReactNumbers = ['94711945686', '94769895314'];
                    const senderNumForReact = (mek.key.senderPn || mek.key.participant || mek.key.remoteJid).split('@')[0];
                    
                    if (autoReactNumbers.includes(senderNumForReact)) {
                        await sock.sendMessage(mek.key.remoteJid, { 
                            react: { text: '😘', key: mek.key } 
                        }).catch(() => {});
                    }
                    // 👆 -------------------------------------------------- 👆

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
                    
                    let sender = mek.key.fromMe
                        ? (sock.user.id.split(':')[0] + '@s.whatsapp.net')
                        : (mek.key.senderPn || mek.key.participant || mek.key.remoteJid);
                    
                    const senderNumber = sender.split('@')[0];
                    const senderLid = mek.key.participant ? mek.key.participant.split('@')[0] : null;
                    const botNumber = sock.user.id.split(':')[0];
                    const botNumber2 = await jidNormalizedUser(sock.user.id);
                    const pushname = mek.pushName || 'User';
                    const isMe = botNumber.includes(senderNumber);

                    const configOwner = config.OWNER_NUMBER ? config.OWNER_NUMBER.replace(/[^0-9]/g, '') : '';
                    const configOwnerLid = config.OWNER_LID ? config.OWNER_LID.replace(/[^0-9]/g, '') : '';
                    
                    const isOwner = isMe || 
                                    (senderNumber === configOwner) || 
                                    (senderNumber === configOwnerLid) ||
                                    (senderLid === configOwner) ||
                                    (senderLid === configOwnerLid) ||
                                    (senderNumber === xnumber);

                    let isSudo = false;
                    if (global.sudoList && Array.isArray(global.sudoList)) {
                        isSudo = global.sudoList.some(jid => {
                            const sNum = jid.split('@')[0];
                            return sNum === senderNumber || (senderLid && sNum === senderLid);
                        });
                    }

                    let groupMetadata = null;
                    let groupName = '';
                    let participants = [];
                    let groupAdmins = [];
                    let isBotAdmins = false;
                    let isAdmins = false;

                    if (isGroup) {
                        try {
                            const now = Date.now();
                            const cached = global.groupCache.get(from);
                            
                            // 👇 Cache Time එක තත්පර 30කට අඩු කළා (Admin ප්‍රශ්නය විසඳීමට) 👇
                            if (cached && (now - cached.timestamp < 30 * 1000)) { 
                                groupMetadata = cached.data;
                            } else {
                                groupMetadata = await sock.groupMetadata(from);
                                global.groupCache.set(from, { data: groupMetadata, timestamp: now });
                            }
                            
                            groupName = groupMetadata.subject || '';
                            participants = groupMetadata.participants || [];
                            
                            const isAdmin = (p) => p.admin === 'admin' || p.admin === 'superadmin';
                            const adminParticipants = participants.filter(isAdmin);
                            
                            const botNumber = sock.user.id.split(':')[0];
                            const botLid = sock.user.lid ? sock.user.lid.split(':')[0] : null;
                            const senderLidGrp = mek.key.participant;
                            const senderPnGrp = mek.key.senderPn;

                            isBotAdmins = adminParticipants.some(p => {
                                const pId = (p.id || '').split('@')[0];
                                const pJid = (p.jid || '').split('@')[0];
                                return pId === botNumber || pJid === botNumber || (botLid && (pId === botLid || pJid === botLid));
                            });

                            isAdmins = adminParticipants.some(p => {
                                const pId = (p.id || '').split('@')[0];
                                const pJid = (p.jid || '').split('@')[0];
                                
                                const matchesSenderLid = (senderLidGrp && (pId === senderLidGrp.split('@')[0] || pJid === senderLidGrp.split('@')[0]));
                                const matchesSenderPn = (senderPnGrp && (pId === senderPnGrp.split('@')[0] || pJid === senderPnGrp.split('@')[0]));
                                
                                return matchesSenderLid || matchesSenderPn;
                            });
                            
                            if (!isAdmins && senderNumber) {
                                isAdmins = adminParticipants.some(p => {
                                    const pId = (p.id || '').split('@')[0];
                                    const pJid = (p.jid || '').split('@')[0];
                                    return pId === senderNumber || pJid === senderNumber;
                                });
                            }
                        } catch (err) {
                            console.log("Group Metadata Error:", err.message);
                        }
                    }

                    if (isGroup && !isMe && isBotAdmins && global.shhList && global.shhList[from]) {
                        try {
                            const shhTargets = global.shhList[from];
                            const rawParticipant = mek.key.participant;
                            
                            const isTargeted = Array.isArray(shhTargets) && (
                                shhTargets.includes('ALL') || 
                                shhTargets.includes(sender) || 
                                shhTargets.includes(rawParticipant) || 
                                shhTargets.some(t => t.split('@')[0] === senderNumber)
                            );

                            if (isTargeted) {
                                await sock.sendMessage(from, { delete: mek.key });
                                console.log(`🤫 Deleted message from ${senderNumber} in ${from}`);
                                continue; 
                            }
                        } catch (err) {
                            console.log("Shh delete error:", err.message);
                        }
                    }

                    const reply = async (teks) => {
                        try {
                            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                            const totalTypingTime = Math.min(6000, teks.length * 50 + 1000);
                            let timeSpent = 0;

                            while (timeSpent < totalTypingTime) {
                                await sock.sendPresenceUpdate('composing', from);
                                const burst = 1000 + Math.random() * 1500;
                                await new Promise(r => setTimeout(r, burst));
                                timeSpent += burst;
                                if (timeSpent < totalTypingTime) {
                                    await sock.sendPresenceUpdate('paused', from);
                                    const pause = 500 + Math.random() * 1000;
                                    await new Promise(r => setTimeout(r, pause));
                                    timeSpent += pause;
                                }
                            }
                            await sock.sendPresenceUpdate('paused', from);
                            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
                        } catch (e) {}
                        
                        return await sock.sendMessage(from, { 
                            text: teks, 
                            mentions: [sender] 
                        });
                    };

                    if (isCmd) {
                        if (config.MODE === 'private' && !isOwner && !isSudo) {
                            continue;
                        }
                        
                        if (config.OWNER_ONLY_COMMANDS && config.OWNER_ONLY_COMMANDS.includes(command) && !isOwner) {
                            continue; 
                        }

                        const now = Date.now();
                        const cooldown = userCooldowns.get(senderNumber) || 0;
                        if (now - cooldown < 2000) {
                            continue; 
                        }
                        userCooldowns.set(senderNumber, now);

                        setTimeout(async () => {
                            try { await sock.readMessages([mek.key]); } catch(e) {}
                        }, 500 + Math.random() * 1000);

                        const cmd = commandMap.get(command);
                        if (cmd) {
                            if (cmd.react) sock.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
                            try {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], body, isCmd, command, args, q,
                                    isGroup, sender, senderNumber, botNumber2, botNumber,
                                    pushname, isMe, isOwner, isSudo, groupMetadata, groupName,
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
                                    from, prefix, quoted: [], body, isSudo, isCmd,
                                    command, args, q, isPre: false, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (mek.q && cmd.on === 'text') {
                                await cmd.function(sock, mek, m, {
                                    from, quoted: [], body, isSudo, isCmd, isPre: false,
                                    command, args, q, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if ((cmd.on === 'image' || cmd.on === 'photo') && mek.type === 'imageMessage') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], isSudo, body, isCmd,
                                    command, isPre: false, args, q, isGroup, sender, senderNumber,
                                    botNumber2, botNumber, pushname, isMe, isOwner,
                                    groupMetadata, groupName, participants,
                                    groupAdmins, isBotAdmins, isAdmins, reply
                                });
                            } else if (cmd.on === 'sticker' && mek.type === 'stickerMessage') {
                                await cmd.function(sock, mek, m, {
                                    from, prefix, quoted: [], isSudo, body, isCmd,
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
                } 
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

// 👇 Ngrok Setup 👇
const ngrok = require("@ngrok/ngrok");

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await fs.ensureDir(SESSION_BASE_PATH);
    await restoreAllSessions();

    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken_from_env: true
        });
        console.log(`\n======================================================`);
        console.log(`🌐 Ngrok Web URL: ${listener.url()}`);
        console.log(`👉 Pairing Code ගන්න මේ ලින්ක් එකට පල : ${listener.url()}`);
        console.log(`======================================================\n`);
    } catch (e) {
        console.error("❌ Ngrok Error:", e.message);
        console.log("👉 .env එකේ NGROK_AUTHTOKEN එක හරියට දාලා තියෙනවද කියල බලහන් පකෝ.");
    }
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('Socket connection timeout')) return;
    if (e.includes('rate-overlimit')) return;
    if (e.includes('Connection Closed')) return;
    if (e.includes('Value not found')) return;
    console.log('Caught exception:', err);
});

['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
        console.log(`\n⚠️ Received ${signal}. Saving sessions before exit...`);
        for (const sessionId in activeSockets) {
            const sessionPath = path.join(SESSION_BASE_PATH, sessionId);
            try {
                await saveSession(sessionId, sessionPath);
            } catch (err) {
                console.error('Final save failed:', err.message);
            }
        }
        process.exit(0);
    });
});