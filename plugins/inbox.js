const fs = require('fs-extra');
const path = require('path');
const { cmd } = require('../command');

const INBOX_FILE = path.join(__dirname, '..', 'data', 'inbox.json');

cmd({
    pattern: "inbox",
    alias: ["inboxlist", "allinbox"],
    desc: "Show all saved inbox numbers",
    category: "owner",
    react: "📥",
    filename: __filename
},
async (conn, mek, m, { from, reply }) => {
    console.log("🔍 Inbox command triggered!"); // Terminal එකේ පේන්න
    
    try {
        console.log("📂 Looking for file at:", INBOX_FILE); // Path එක හරිද බලන්න

        if (!fs.existsSync(INBOX_FILE)) {
            console.log("❌ File not found!");
            return reply("📭 Inbox එක හිස්. (File එක හැදිලා නෑ)\n\nපළවෙනි පාරට bot එකට msg එකක් එවලා බලන්න.");
        }

        const inbox = await fs.readJson(INBOX_FILE);
        console.log("📊 Data loaded:", inbox.length, "contacts.");

        if (inbox.length === 0) {
            return reply("📭 Inbox එක හිස්. (Data නෑ)\n\nඔයාගේ තව number එකකින් bot එකට msg එකක් එවලා බලන්න.");
        }

        let text = `*📥 INBOX CONTACTS (${inbox.length})*\n\n`;
        inbox.slice(-50).forEach((item, i) => { 
            text += `*${i + 1}.* ${item.number}\n`;
            text += `   👤 Name: ${item.name || 'Unknown'}\n`;
            text += `   🕒 Date: ${new Date(item.date).toLocaleString()}\n\n`;
        });

        if (inbox.length > 50) {
            text += `_...සහ තවත් ${inbox.length - 50}ක් තියෙනවා._`;
        }

        await reply(text);
        console.log("✅ Inbox reply sent successfully!");

    } catch (e) {
        console.error('❌ Inbox Error:', e);
        reply(`❌ Error: ${e.message}`);
    }
});