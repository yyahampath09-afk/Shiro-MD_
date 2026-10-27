module.exports = {
    PREFIX: "/",

 // Bot info
    BOT_NAME: 'SHIRO MD V1',
    DESCRIPTION: 'Powered by SHIRO MD V1',
    OWNER_NAME: 'Inosuke',

    // Images
    MENU_IMAGE_URL: 'https://files.catbox.moe/lubh1p.jpg',
    ALIVE_IMG: 'https://files.catbox.moe/lubh1p.jpg',

    // Behavior
    AUTO_READ_STATUS: true,
    AUTO_REACT: false,
    AUTO_TYPING: false,
    REACT_EMOJIS: ['❤','💕','😻','🧡','💛','💚','💙','💜','🎉','👋'],

    // Anime News Auto-Post
    ANIME_NEWS: {
        ENABLED: true,
        INTERVAL_MINUTES: 30,
        RSS_URL: 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss',
        TARGET_JIDS: [
            // ඔයාගේ channel/group JIDs මෙතන දාන්න
            // '120363400734168271@newsletter',
            // '123456789-123345@g.us',
        ],
    },
};