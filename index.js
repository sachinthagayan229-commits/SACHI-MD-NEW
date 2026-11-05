import { 
  makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  BufferJSON
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import config from './config.js';
import { handleCommand } from './commands/index.js';

// Dashboard Server
import express from 'express';
const app = express();
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    bot: config.botName, 
    time: new Date().toISOString() 
  });
});
app.listen(10000, () => {
  console.log('Dashboard started on port 10000');
});

async function startBot() {
  // SESSION_ID එකෙන් Session එක Load කරන්න
  const sessionId = process.env.SESSION_ID;
  let authState;
  
  if (sessionId) {
    try {
      console.log('🔄 SESSION_ID එකෙන් Session එක Load කරනවා...');
      // Session ID එක Decode කරලා Auth State එකක් හදන්න
      // මේක Simple Method එකක් - ඔයාගේ Pair Site එකෙන් ලැබෙන Session ID එක
      // Baileys Session එකක් විදියට Use කරන්න පුළුවන්
      const sessionDir = './session';
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      // SESSION_ID එක File එකක් විදියට Save කරන්න
      fs.writeFileSync(path.join(sessionDir, 'session_id.txt'), sessionId);
      console.log('✅ SESSION_ID එකෙන් Session එක Load වුනා!');
    } catch (error) {
      console.log('❌ Session Load වුනේ නෑ:', error.message);
    }
  }
  
  // Normal Auth State එක
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  authState = { state, saveCreds };
  
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using Baileys v${version.join('.')}`);
  
  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.state.creds,
      keys: makeCacheableSignalKeyStore(authState.state.keys, pino({ level: 'silent' }))
    },
    logger: pino({ level: 'silent' }),
    browser: Browsers.windows('Chrome'),
    printQRInTerminal: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: async (key) => {
      if (authState) {
        const msg = await authState.state.keys.getMessage(key);
        return msg || {};
      }
      return {};
    }
  });
  
  sock.ev.on('creds.update', authState.saveCreds);
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('📱 QR Code එක Scan කරන්න!');
      console.log(qr);
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`Connection closed. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      }
    } else if (connection === 'open') {
      console.log('✅ SACHI-MD Connected!');
    }
  });
  
  // Messages ලැබුණු විට
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[UPsert Type] ${type} Count: ${messages.length}`);
    
    for (const msg of messages) {
      console.log('[RAW MSG]', JSON.stringify({
        remoteJid: msg.key.remoteJid,
        fromMe: msg.key.fromMe,
        id: msg.key.id,
        participant: msg.key.participant
      }));
      
      // Message එකක් නැත්නම් Skip කරන්න
      if (!msg.message) {
        console.log('[SKIP] No message content');
        continue;
      }
      
      // RemoteJid එකක් නැත්නම් Skip කරන්න
      if (!msg.key.remoteJid) {
        console.log('[SKIP] No remoteJid');
        continue;
      }
      
      // Status Broadcast Skip කරන්න
      if (msg.key.remoteJid === 'status@broadcast') {
        console.log('[SKIP] Status broadcast');
        continue;
      }
      
      // Group Messages Allow කරන්න
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      
      // Group එකක් නම් සහ allowGroup false නම් Skip කරන්න
      if (isGroup && !config.allowGroup) {
        console.log('[SKIP] Group messages not allowed');
        continue;
      }
      
      // Self Messages Allow කරන්න
      if (msg.key.fromMe && !config.allowSelf) {
        console.log('[SKIP] Self messages not allowed');
        continue;
      }
      
      console.log('[MESSAGE]', msg.key.remoteJid);
      
      // Message Text එක Extract කරන්න
      let text = '';
      
      // Conversation Message
      if (msg.message.conversation) {
        text = msg.message.conversation;
      }
      // Extended Text Message (Reply/Forward)
      else if (msg.message.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      }
      // Image Message Caption
      else if (msg.message.imageMessage?.caption) {
        text = msg.message.imageMessage.caption;
      }
      // Video Message Caption
      else if (msg.message.videoMessage?.caption) {
        text = msg.message.videoMessage.caption;
      }
      // Document Message Caption
      else if (msg.message.documentMessage?.caption) {
        text = msg.message.documentMessage.caption;
      }
      // Buttons Response
      else if (msg.message.buttonsResponseMessage?.selectedButtonId) {
        text = msg.message.buttonsResponseMessage.selectedButtonId;
      }
      // List Response
      else if (msg.message.listResponseMessage?.singleSelectReply?.selectedRowId) {
        text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
      }
      
      if (!text) {
        console.log('[SKIP] No text content');
        continue;
      }
      
      text = text.trim();
      console.log('[TEXT]', text);
      
      // Prefix Check කරන්න
      if (!text.startsWith(config.prefix)) {
        console.log('[SKIP] No prefix');
        continue;
      }
      
      // Command එක Extract කරන්න
      const args = text.slice(config.prefix.length).trim().split(/\s+/);
      const command = args[0].toLowerCase();
      
      console.log('[COMMAND]', command);
      
      // Command එක Handle කරන්න
      await handleCommand(sock, msg, command, args.slice(1));
    }
  });
}

startBot().catch(err => {
  console.error('❌ Bot Start වුනේ නෑ:', err);
  process.exit(1);
});
