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

// SESSION_ID එකෙන් Session එක Load කරන්න
const sessionDir = './session';

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

const sessionId = process.env.SESSION_ID;
if (sessionId) {
  try {
    console.log('🔄 SESSION_ID එකෙන් Session එක Load කරනවා...');
    
    let cleanId = sessionId.trim();
    if (cleanId.includes('~')) {
      cleanId = cleanId.split('~')[1];
    } else if (cleanId.includes(':')) {
      cleanId = cleanId.split(':')[1];
    }
    
    const decoded = Buffer.from(cleanId, 'base64').toString('utf-8');
    const credsData = JSON.parse(decoded, BufferJSON.reviver);
    
    if (!credsData.me || !credsData.me.id) {
      console.log('⚠️ Creds එකේ me.id එකක් නෑ! SESSION_ID එක Invalid!');
      throw new Error('Invalid creds format');
    }
    
    fs.writeFileSync(
      path.join(sessionDir, 'creds.json'),
      JSON.stringify(credsData, BufferJSON.replacer, 2)
    );
    console.log('✅ SESSION_ID එකෙන් Session එක Load වුනා!');
    console.log(`📱 Account: ${credsData.me.id}`);
  } catch (error) {
    console.log('❌ Session Load වුනේ නෑ:', error.message);
  }
}

async function startBot() {
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
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const error = lastDisconnect?.error;
      console.log(`Connection closed. Status: ${statusCode}`);
      console.log(`Error:`, error?.message || error);
      
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Session එක Expired! අලුත් SESSION_ID එකක් ඕනේ!');
        console.log('🔄 10 Seconds වලින් Reconnect කරනවා...');
        setTimeout(startBot, 10000);
      } else if (statusCode === DisconnectReason.badSession) {
        console.log('❌ Bad Session! Session එක Delete කරන්න ඕනේ!');
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          fs.mkdirSync(sessionDir, { recursive: true });
        } catch(e) {}
        setTimeout(startBot, 5000);
      } else if (!statusCode) {
        console.log('❌ Unknown Error! Session එක Invalid වෙන්න පුළුවන්!');
        console.log('🔄 5 Seconds වලින් Reconnect කරනවා...');
        setTimeout(startBot, 5000);
      } else {
        console.log('🔄 Reconnecting in 5 seconds...');
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
