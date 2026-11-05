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
  const sessionId = process.env.SESSION_ID;
  const sessionDir = './session';
  
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  // SESSION_ID එකෙන් Session එක Load කරන්න
  if (sessionId) {
    try {
      console.log('🔄 SESSION_ID එකෙන් Session එක Load කරනවා...');
      
      let cleanId = sessionId.trim();
      // SACHI-MD~ තියෙනවා නම් අයින් කරන්න
      if (cleanId.includes('~')) {
        cleanId = cleanId.split('~')[1];
      } else if (cleanId.includes(':')) {
        cleanId = cleanId.split(':')[1];
      }
      
      // Base64 Decode කරන්න
      const decoded = Buffer.from(cleanId, 'base64').toString('utf-8');
      const credsData = JSON.parse(decoded);
      
      fs.writeFileSync(
        path.join(sessionDir, 'creds.json'),
        JSON.stringify(credsData, BufferJSON.replacer, 2)
      );
      console.log('✅ SESSION_ID එකෙන් Session එක Load වුනා!');
    } catch (error) {
      console.log('❌ Session Load වුනේ නෑ:', error.message);
    }
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using Baileys v${version.join('.')}`);
  
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
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
      const msg = await state.keys.getMessage(key);
      return msg || {};
    }
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('📱 QR Code එක Scan කරන්න!');
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
  
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      if (!msg.key.remoteJid) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      if (isGroup && !config.allowGroup) continue;
      if (msg.key.fromMe && !config.allowSelf) continue;
      
      let text = '';
      if (msg.message.conversation) text = msg.message.conversation;
      else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
      else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption;
      else if (msg.message.videoMessage?.caption) text = msg.message.videoMessage.caption;
      
      if (!text) continue;
      text = text.trim();
      if (!text.startsWith(config.prefix)) continue;
      
      const args = text.slice(config.prefix.length).trim().split(/\s+/);
      const command = args[0].toLowerCase();
      await handleCommand(sock, msg, command, args.slice(1));
    }
  });
}

startBot().catch(err => {
  console.error('❌ Bot Start වුනේ නෑ:', err);
  process.exit(1);
});
