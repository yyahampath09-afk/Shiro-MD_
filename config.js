module.exports = {
    PREFIX: "/",
    MODE: "private", 

    BOT_NAME: 'SHIRO MD',
    DESCRIPTION: 'Powered by SHIRO MD',
    OWNER_NAME: 'ᴵⁿᵒˢᵘᵏᵉ 𝙓 ',
    OWNER_NUMBER: '94760036688', 
    OWNER_LID: '6271289786544',
    OWNER_WEBSITE: 'https://inosuke.hashibira.workers.dev/',
    OWNER_GITHUB: 'https://github.com/yyahampath09-afk',
    OWNER_CHANNEL: 'https://whatsapp.com/channel/120363432680694902',

    MENU_IMAGE_URL: 'https://files.catbox.moe/lubh1p.jpg',
    ALIVE_IMG: 'https://files.catbox.moe/lubh1p.jpg',

    AUTO_READ_STATUS: false,
    AUTO_REACT: false,
    AUTO_TYPING: false,
    REACT_EMOJIS: ['❤','💕','😻','🧡','💛','💚','💙','💜','🎉','👋'],

    // 👇 ස්ථිර sudo ලැයිස්තුව (Trusted numbers - auto react + sudo) 👇
    TRUSTED_NUMBERS: [
        { number: '94711945686', react: '😘' },
        { number: '94769895314', react: '😘' },
        { number: '94723268506', react: '😽' },
        { number: '94752460283', react: '🖕🏿' }
    ],

    // 👇 Anti-Link සහ Anti-Bot සක්‍රීය කිරීම 👇
    ANTI_LINK: true,
    ANTI_BOT: true,
    ANTI_COMMAND_DELETE: true, // Private mode එකේදී non-sudo commands delete කරනවා

    // 👇 Known Bot Signatures (හඳුනාගැනීමට) 👇
    BOT_SIGNATURES: [
        'BAILEYS', 'WhiskeySockets', 'Baileys', 
        'SHIRO-MD', 'SHIRO MD'
    ],

    OWNER_ONLY_COMMANDS: [
        'shh', 'mute', 'unmute', 'addsudo', 'delsudo', 'boom',
        'eval', 'ev', 'restart', 'update', 
        'kick', 'add', 'promote', 'demote'
    ],
        ANIME_NEWS: {
    ENABLED: true,
    TARGET_JIDS: [ /* ... */ '120363432680694902@newsletter' ],
    INTERVAL_MINUTES: 15,
    VIEW_CHANNEL_JID: '120363432680694902@newsletter',   // View channel button එක යන channel එක
    VIEW_CHANNEL_NAME: 'ᴍɪᴢᴛʏ ᴀɴɪᴍᴇ',                       // (optional)
    VIEW_CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbE79hZBadmXSbahq33R'  // (optional) card එක tap කළාම යන තැන
            }
    },
