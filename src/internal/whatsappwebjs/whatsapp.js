import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

let client;

export const initializeClient = () => {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "woy-session" }), // reuses same session
    puppeteer: {
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        `--user-data-dir=${process.cwd()}/.wwebjs_profile` // custom Chrome profile
      ],
    },
  });

  // Show QR only first time
  client.on("qr", (qr) => {
    console.log("QR RECEIVED");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("✅ WhatsApp client is ready!");
  });

  client.on("disconnected", (reason) => {
    console.error("❌ Client disconnected:", reason);
    console.log("🔄 Reconnecting...");
    client.initialize(); // re-init without losing session
  });

  client.on("auth_failure", (msg) => {
    console.error("⚠️ AUTH FAILURE:", msg);
  });

  client.initialize();
};

export const getClient = () => client;
export const sendMessage = async (chatId, message) => {
    try {
        await client.sendMessage(chatId, message);
        return { success: true, message: 'Message sent successfully' };
    } catch (error) {
        console.error('Error sending message:', error.message, error.stack);
        return { success: false, message: 'Failed to send message' };
    }
};

export const sendMedia = async (chatId, media, caption = '') => {
    try {
        await client.sendMessage(chatId, media, { caption });
        return { success: true, message: 'Media sent successfully' };
    } catch (error) {
        console.error('Error sending media:', error);
        return { success: false, message: 'Failed to send media' };
    }
};


export const sendReadReceipt = async (chatId, messageIds) => {
    try {
        const chat = await client.getChatById(chatId);
        await chat.sendSeen();
        // For specific messages, you might need to iterate and mark them as seen
        // This functionality might vary based on whatsapp-web.js updates
        return { success: true, message: 'Read receipt sent successfully' };
    } catch (error) {
        console.error('Error sending read receipt:', error);
        return { success: false, message: 'Failed to send read receipt' };
    }
};
export const getAllGroups = async () => {
    try {
        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(group => ({
                name: group.name,
                id: group.id._serialized
            }));

        return { success: true, groups };
    } catch (error) {
        console.error('Error fetching groups:', error);
        return { success: false, message: 'Failed to fetch groups' };
    }
};


export const sendTypingStatus = async (chatId) => {
    try {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        return { success: true, message: 'Typing status sent successfully' };
    } catch (error) {
        console.error('Error sending typing status:', error);
        return { success: false, message: 'Failed to send typing status' };
    }
};

export const markAsUnread = async (message) => {
    try {
        await message.markUnread();
        return { success: true, message: 'Message marked as unread' };
    } catch (error) {
        console.error('Error marking message as unread:', error);
        return { success: false, message: 'Failed to mark message as unread' };
    }
};

export { client }; // Export client to allow direct access if needed