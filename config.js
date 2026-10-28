module.exports = {
    PREFIX: "/",
    MODE: "private", // 👈 'private' දාලා තියෙන නිසා ඔයාට විතරයි වැඩ කරන්නේ (sudo ලාටත් පුළුවන්)

    // Bot info
    BOT_NAME: 'SHIRO MD',
    DESCRIPTION: 'Powered by SHIRO MD',
    OWNER_NAME: 'ᴵⁿᵒˢᵘᵏᵉ 𝙓 ᴷⁱⁿᵍᴾᵒᵈᵈᵃᴹᵒᵈᶻ',
    
    // 👇 Owner විස්තර (මේක තමයි වැදගත්ම තැන) 👇
    OWNER_NUMBER: '94760036688', // ඔයාගේ ඇත්ත WhatsApp අංකය
    OWNER_LID: '6271289786544',  // ඔයාගේ WhatsApp LID අංකය (මේක නැතුව ඔයාව අඳුරගන්නේ නෑ)
    OWNER_WEBSITE: 'https://inosuke.hashibira.workers.dev/',

    // Images
    MENU_IMAGE_URL: 'https://files.catbox.moe/lubh1p.jpg',
    ALIVE_IMG: 'https://files.catbox.moe/lubh1p.jpg',

    // Behavior
    AUTO_READ_STATUS: false,
    AUTO_REACT: false,
    AUTO_TYPING: false,
    REACT_EMOJIS: ['❤','💕','😻','🧡','💛','💚','💙','💜','🎉','👋'],

    // 👇 මේවා ගහන්න පුළුවන් ඔයාට (Owner) විතරයි 👇
    OWNER_ONLY_COMMANDS: [
        'shh', 'mute', 'unmute', 'addsudo', 'delsudo', 
        'eval', 'ev', 'restart', 'update', 
        'kick', 'add', 'promote', 'demote'
    ],

    // Anime News Settings
    ANIME_NEWS: {
        ENABLED: true,
        INTERVAL_MINUTES: 15,
        RSS_URL: 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss',
        TARGET_JIDS: [
            '120363432680694902@newsletter', // ඔයාගේ channel එකේ JID එක
        ],
    },
};