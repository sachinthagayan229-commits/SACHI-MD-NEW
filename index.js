import pkg from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = pkg;

import pino from 'pino'
import express from 'express'
import fs from 'fs'
import path from 'path'
import config from './config.js'

// ===== SESSION_ID එකෙන් Session එක Load කරන්න =====
if (process.env.SESSION_ID) {
  try {
    const sessionDir = './session';
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    let raw = process.env.SESSION_ID.trim();
    // SACHI-MD~ Prefix එක අයින් කරන්න
    if (raw.startsWith('SACHI-MD~')) {
      raw = raw.replace('SACHI-MD~', '');
    }

    // Base64 Decode කරන්න
    let decoded = Buffer.from(raw, 'base64').toString('utf8');
    // JSON එකක්ද බලන්න
    JSON.parse(decoded);
    fs.writeFileSync(path.join(sessionDir, 'creds.json'), decoded);
    console.log('✅ SESSION_ID එකෙන් Session එක Load වුනා!');
  } catch (err) {
    console.error('❌ Session Load Error:', err);
  }
}

const app = express()
app.use(express.json())

global.botStatus = 'Starting...'
let reconnecting = false

app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <meta name="viewport" content="width=device-width">
      <title>SACHI-MD V2</title>
      <style>
        body{background:#0b1020;color:white;font-family:Arial;padding:20px}
        .card{background:#182238;padding:20px;border-radius:14px;margin:15px 0}
        h1{color:#63e6be}
      </style>
    </head>
    <body>
      <h1>🔥 SACHI-MD V2</h1>
      <div class="card">
        <h3>Bot Status</h3>
        <h2 id="status">Loading...</h2>
      </div>
      <script>
        async function load(){
          const r=await fetch('/api/stats')
          const d=await r.json()
          document.getElementById('status').innerText=d.status
        }
        load()
        setInterval(load,5000)
      </script>
    </body>
    </html>
  `)
})

app.get('/api/stats', (req, res) => {
  res.json({ status: global.botStatus })
})

app.listen(config.dashboardPort, () => {
  console.log('Dashboard started on port', config.dashboardPort)
})

function getText(message) {
  let msg = message

  for (let i = 0; i < 5 && msg; i++) {
    if (msg.conversation) return msg.conversation
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text
    if (msg.imageMessage?.caption) return msg.imageMessage.caption
    if (msg.videoMessage?.caption) return msg.videoMessage.caption

    msg =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message
  }

  return ''
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./session')

  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['SACHI-MD', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'connecting') {
      global.botStatus = 'Connecting...'
    }

    if (connection === 'open') {
      global.botStatus = 'Online 🟢'
      reconnecting = false
      console.log('SACHI-MD Connected!')
    }

    if (connection === 'close') {
      global.botStatus = 'Disconnected 🔴'

      const code = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        console.log('Session logged out. New pairing required.')
        return
      }

      if (!reconnecting) {
        reconnecting = true
        setTimeout(() => {
          reconnecting = false
          startBot().catch(console.error)
        }, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message || !msg.key.remoteJid) continue

        const jid = msg.key.remoteJid
        const sender = msg.key.participant || msg.key.remoteJid
        const ownerJid = (config.ownerNumber || '').replace(/\D/g, '') + '@s.whatsapp.net'

        // ===== ONE VIEW PHOTO - Owner ට යවන්න =====
        if (msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage) {
          try {
            const vm = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage.message;
            if (vm.image) {
              await sock.sendMessage(ownerJid, {
                image: vm.image,
                caption: `👀 *One View Photo*\nFrom: @${sender.split('@')[0]}\nTime: ${new Date().toLocaleString()}`,
                mentions: [sender]
              });
              console.log('[ONE VIEW] Photo sent to owner');
            }
          } catch (e) { console.error('One View Error:', e); }
        }

        // ===== ANTI DELETE - Owner ට යවන්න =====
        if (msg.message.protocolMessage?.type === 0) {
          try {
            const del = msg.message.protocolMessage;
            await sock.sendMessage(ownerJid, {
              text: `🗑️ *Anti-Delete*\nFrom: @${sender.split('@')[0]}\nMessage deleted!\nID: ${del.key?.id || 'N/A'}`,
              mentions: [sender]
            });
            console.log('[ANTI DELETE] Detected');
          } catch (e) { console.error('Anti Delete Error:', e); }
        }

        // ===== ANTI EDIT - Owner ට යවන්න =====
        if (msg.message.protocolMessage?.editedMessage) {
          try {
            const edit = msg.message.protocolMessage.editedMessage;
            await sock.sendMessage(ownerJid, {
              text: `✏️ *Anti-Edit*\nFrom: @${sender.split('@')[0]}\nEdited: ${edit.conversation || edit.extendedTextMessage?.text || 'Media'}`,
              mentions: [sender]
            });
            console.log('[ANTI EDIT] Detected');
          } catch (e) { console.error('Anti Edit Error:', e); }
        }

        const text = getText(msg.message).trim()

        console.log('[MESSAGE]', jid, text || '[Media]')

        if (!text.startsWith(config.prefix)) continue

        const parts = text.slice(config.prefix.length).trim().split(/\s+/)
        const cmd = (parts.shift() || '').toLowerCase()
        const args = parts

        if (cmd === 'ping') {
          await sock.sendMessage(
            jid,
            { text: 'Pong! SACHI-MD Online 🟢' },
            { quoted: msg }
          )
        }

        else if (cmd === 'menu') {
          await sock.sendMessage(jid, {
            text:
              `🔥 *${config.botName} MENU*\n\n` +
              '• .ping\n' +
              '• .menu\n' +
              '• .tagall\n' +
              '• .kick @mention'
          }, { quoted: msg })
        }

        else if (cmd === 'tagall') {
          if (!jid.endsWith('@g.us')) {
            await sock.sendMessage(jid, {
              text: 'මේ command එක group එකක භාවිතා කරන්න.'
            })
            continue
          }

          const metadata = await sock.groupMetadata(jid)
          const participants = metadata.participants

          const mentions = participants.map(p => p.id)
          const message = participants
            .map(p => '@' + p.id.split('@')[0])
            .join(' ')

          await sock.sendMessage(jid, {
            text: '*SACHI TAG ALL*\n\n' + message,
            mentions
          })
        }

        else if (cmd === 'kick') {
          if (!jid.endsWith('@g.us')) continue

          const mentioned =
            msg.message.extendedTextMessage?.contextInfo?.mentionedJid || []

          if (!mentioned.length) {
            await sock.sendMessage(jid, {
              text: 'User කෙනෙක් mention කරන්න.'
            })
            continue
          }

          const metadata = await sock.groupMetadata(jid)
          const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net'
          const botAdmin = metadata.participants.some(
            p => p.id === botId && (p.admin === 'admin' || p.admin === 'superadmin')
          )

          if (!botAdmin) {
            await sock.sendMessage(jid, {
              text: 'Bot එක group admin විය යුතුයි.'
            })
            continue
          }

          await sock.groupParticipantsUpdate(
            jid,
            [mentioned[0]],
            'remove'
          )
        }
      } catch (error) {
        console.error('Command error:', error.message)
      }
    }
  })
}

startBot().catch(error => {
  global.botStatus = 'Error 🔴'
  console.error('Startup error:', error)
})
