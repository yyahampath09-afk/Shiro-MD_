// lib/gf-db.js — Local JSON Storage for GF System
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data', 'gf');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
    users: path.join(DATA_DIR, 'users.json'),
    relationships: path.join(DATA_DIR, 'relationships.json'),
    otps: path.join(DATA_DIR, 'otps.json'),
    waitlist: path.join(DATA_DIR, 'waitlist.json')
};

// ═══ HELPERS ═══
function readDB(file) {
    try {
        if (!fs.existsSync(FILES[file])) return [];
        return JSON.parse(fs.readFileSync(FILES[file], 'utf8'));
    } catch (e) {
        return [];
    }
}

function writeDB(file, data) {
    fs.writeFileSync(FILES[file], JSON.stringify(data, null, 2), 'utf8');
}

// ═══ USERS ═══
async function getUser(phone) {
    const users = readDB('users');
    return users.find(u => u.phone === String(phone)) || null;
}

async function saveUser(phone, data) {
    const users = readDB('users');
    const index = users.findIndex(u => u.phone === String(phone));

    if (index > -1) {
        users[index] = { ...users[index], ...data, phone: String(phone) };
    } else {
        users.push({ ...data, phone: String(phone) });
    }
    writeDB('users', users);
    return await getUser(phone);
}

async function updateUser(phone, updates) {
    return await saveUser(phone, updates);
}

async function deleteUser(phone) {
    let users = readDB('users');
    users = users.filter(u => u.phone !== String(phone));
    writeDB('users', users);

    let rels = readDB('relationships');
    rels = rels.filter(r => r.phone !== String(phone));
    writeDB('relationships', rels);
}

async function getUserCount(status = null) {
    const users = readDB('users');
    if (status) return users.filter(u => u.status === status).length;
    return users.length;
}

async function getUsersByStatus(status) {
    const users = readDB('users');
    return users.filter(u => u.status === status);
}

// ═══ RELATIONSHIPS ═══
async function getRelationship(phone, gfName) {
    const rels = readDB('relationships');
    return rels.find(r =>
        r.phone === String(phone) &&
        r.gfName === String(gfName).toLowerCase()
    ) || null;
}

async function getAllRelationships(phone) {
    const rels = readDB('relationships');
    return rels.filter(r => r.phone === String(phone));
}

async function createRelationship(phone, gfName) {
    const rels = readDB('relationships');
    const now = new Date().toISOString();
    const doc = {
        phone: String(phone),
        gfName: String(gfName).toLowerCase(),
        level: 1,
        xp: 0,
        mood: 'neutral',
        moodUpdatedAt: now,
        chatCount: 0,
        memories: [],
        chatHistory: [],
        lastChatAt: now,
        createdAt: now,
    };
    rels.push(doc);
    writeDB('relationships', rels);
    return doc;
}

async function updateRelationship(phone, gfName, updates) {
    const rels = readDB('relationships');
    const index = rels.findIndex(r =>
        r.phone === String(phone) &&
        r.gfName === String(gfName).toLowerCase()
    );
    if (index > -1) {
        rels[index] = { ...rels[index], ...updates };
        writeDB('relationships', rels);
    }
    return await getRelationship(phone, gfName);
}

async function deleteRelationship(phone, gfName) {
    let rels = readDB('relationships');
    rels = rels.filter(r => !(
        r.phone === String(phone) &&
        r.gfName === String(gfName).toLowerCase()
    ));
    writeDB('relationships', rels);
}

// ═══ OTPs ═══
async function saveOTP(phone, code, purpose) {
    let otps = readDB('otps');
    otps = otps.filter(o => !(o.phone === String(phone) && o.purpose === purpose));

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    otps.push({
        phone: String(phone), code, purpose, attempts: 0,
        createdAt: new Date().toISOString(), expiresAt,
    });
    writeDB('otps', otps);
}

async function getOTP(phone, purpose) {
    const otps = readDB('otps');
    const otp = otps.find(o => o.phone === String(phone) && o.purpose === purpose);
    if (!otp) return null;
    if (new Date(otp.expiresAt) < new Date()) return null;
    return otp;
}

async function incrementOTPAttempts(phone, purpose) {
    const otps = readDB('otps');
    const index = otps.findIndex(o => o.phone === String(phone) && o.purpose === purpose);
    if (index > -1) {
        otps[index].attempts += 1;
        writeDB('otps', otps);
    }
}

async function deleteOTP(phone, purpose) {
    let otps = readDB('otps');
    otps = otps.filter(o => !(o.phone === String(phone) && o.purpose === purpose));
    writeDB('otps', otps);
}

// ═══ WAITLIST ═══
async function addToWaitlist(phone, name) {
    const waitlist = readDB('waitlist');
    waitlist.push({
        phone: String(phone), name: name || 'User',
        position: waitlist.length + 1, joinedAt: new Date().toISOString(),
    });
    writeDB('waitlist', waitlist);
}

async function getWaitlist() {
    return readDB('waitlist');
}

async function getNextWaitlist() {
    const waitlist = readDB('waitlist');
    return waitlist.length > 0 ? waitlist[0] : null;
}

async function removeFromWaitlist(phone) {
    let waitlist = readDB('waitlist');
    waitlist = waitlist.filter(w => w.phone !== String(phone));
    writeDB('waitlist', waitlist);
}

// ═══ DANGER ═══
async function recordDangerAttempt(phone, command) {
    const user = await getUser(phone);
    const attempts = (user && user.blockedAttempts) || {};

    const entry = attempts[command] || { count: 0, lastAttempt: null };
    const lastAttempt = entry.lastAttempt ? new Date(entry.lastAttempt) : null;
    const now = new Date();

    if (lastAttempt && (now - lastAttempt) > 24 * 60 * 60 * 1000) {
        entry.count = 0;
    }
    entry.count += 1;
    entry.lastAttempt = now.toISOString();
    attempts[command] = entry;

    await updateUser(phone, { blockedAttempts: attempts });
    return entry.count;
}

module.exports = {
    getUser, saveUser, updateUser, deleteUser,
    getUserCount, getUsersByStatus,
    getRelationship, getAllRelationships,
    createRelationship, updateRelationship, deleteRelationship,
    saveOTP, getOTP, incrementOTPAttempts, deleteOTP,
    addToWaitlist, getWaitlist, getNextWaitlist, removeFromWaitlist,
    recordDangerAttempt,
};