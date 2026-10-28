module.exports = {
    PREFIX: "/",
    MODE: "private", // 👈 'public' හෝ 'private' ලෙස වෙනස් කරන්න

    BOT_NAME: 'SHIRO MD',
    DESCRIPTION: 'Powered by SHIRO MD',
    OWNER_NAME: '𝙸𝙽𝙾𝚂𝚄𝙺𝙴 ',
      OWNER_NUMBER: '94760036688', // 👈 ඔයාගේ අංකය මෙතන දාන්න (රට කේතයත් එක්ක, + නැතුව)
    OWNER_WEBSITE: 'https://inosuke.hashibira.workers.dev/', // 👈 ඔයාගේ website එකේ link එක මෙතන දාන්න

    MENU_IMAGE_URL: 'https://files.catbox.moe/lubh1p.jpg',
    ALIVE_IMG: 'https://files.catbox.moe/lubh1p.jpg',

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

    ANIME_NEWS: {
        ENABLED: true,
        INTERVAL_MINUTES: 15,
        RSS_URL: 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss',
        TARGET_JIDS: [
             '120363432680694902@newsletter',
        ],
    },
};