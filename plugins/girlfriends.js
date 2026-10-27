// girlfriends.js — 13 GF Chat Commands
// All 13 GFs use the central handler in lib/gf-handler.js
// Prompts are in lib/gf-constants.js

const { cmd } = require('../command');
const { handleGFChat } = require('../lib/gf-handler');

// ═══════════════════════════════════════════════════════════
// 😤 Taiga (Tsundere)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "taiga",
    alias: ["tsundere"],
    desc: "Tsundere GF",
    category: "gf",
    react: "😤",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'taiga');
});

// ═══════════════════════════════════════════════════════════
// 🔪 Kurumi (Yandere)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "kurumi",
    alias: ["yandere"],
    desc: "Yandere GF",
    category: "gf",
    react: "🔪",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'kurumi');
});

// ═══════════════════════════════════════════════════════════
// ❄️ Yukino (Kuudere)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "yukino",
    alias: ["kuudere"],
    desc: "Kuudere GF",
    category: "gf",
    react: "❄️",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'yukino');
});

// ═══════════════════════════════════════════════════════════
// ✨ Chika (Deredere)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "chika",
    alias: ["deredere"],
    desc: "Deredere GF",
    category: "gf",
    react: "✨",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'chika');
});

// ═══════════════════════════════════════════════════════════
// 🌸 Yor (Onee-san)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "yor",
    alias: ["oneesan"],
    desc: "Onee-san GF",
    category: "gf",
    react: "🌸",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'yor');
});

// ═══════════════════════════════════════════════════════════
// 🤱 Mitsuri (Mommy)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "mitsuri",
    alias: ["mommy"],
    desc: "Mommy GF",
    category: "gf",
    react: "🤱",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'mitsuri');
});

// ═══════════════════════════════════════════════════════════
// 🔥 Akeno (Milf)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "akeno",
    alias: ["milf"],
    desc: "Milf GF",
    category: "gf",
    react: "🔥",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'akeno');
});

// ═══════════════════════════════════════════════════════════
// 🖤 Albedo (Goth)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "albedo",
    alias: ["succubus"],
    desc: "Goth GF",
    category: "gf",
    react: "🖤",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'albedo');
});

// ═══════════════════════════════════════════════════════════
// 👻 Ougi (Ghost/Mysterious)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "ougi",
    alias: ["ghost"],
    desc: "Mysterious GF",
    category: "gf",
    react: "👻",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'ougi');
});

// ═══════════════════════════════════════════════════════════
// 🦇 Shinobu (Vampire)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "shinobu",
    alias: ["vampire"],
    desc: "Vampire GF",
    category: "gf",
    react: "🦇",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'shinobu');
});

// ═══════════════════════════════════════════════════════════
// 🪶 Jibril (Fallen Angel)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "jibril",
    alias: ["fallenangel"],
    desc: "Arrogant GF",
    category: "gf",
    react: "🪶",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'jibril');
});

// ═══════════════════════════════════════════════════════════
// 🧝‍♀️ Frieren (Elf)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "frieren",
    alias: ["elf"],
    desc: "Elf GF",
    category: "gf",
    react: "🧝‍♀️",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'frieren');
});

// ═══════════════════════════════════════════════════════════
// 💜 Emilia (Sweet Elf)
// ═══════════════════════════════════════════════════════════
cmd({
    pattern: "emilia",
    alias: ["elf2"],
    desc: "Sweet Elf GF",
    category: "gf",
    react: "💜",
    filename: __filename,
},
async (conn, mek, m, { from, reply, q, sender }) => {
    await handleGFChat(conn, mek, from, reply, sender, q, 'emilia');
});