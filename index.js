import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import express from 'express'
import fetch from 'node-fetch'
import config from './config.js'

const msgStore = new Map()
const app = express()
app.use(express.json())
global.botStatus = 'Starting...'

app.get('/', (req,res) => {
  res.send(`<html><head><meta name="viewport" content="width=device-width"><style>body{background:#0f0f0f;color:#fff;font-family:sans-serif;padding:15px} .card{background:#1e1e1e;padding:20px;border-radius:15px;margin:15px 0;border:1px solid #333} input,button{width:100%;padding:15px;border-radius:10px;border:none;margin:10px 0;font-size:16px} input{background:#2a2a2a;color:#fff} button{background:#25D366;color:#000;font-weight:bold} .code{font-size:28px;letter-spacing:6px;text-align:center;background:#000;padding:20px;border-radius:10px;color:#25D366;font-weight:bold} h1{color:#25D366}</style></head><body><h1>🔥 SACHI-MD V2</h1><div class="card"><h2>📱 Pair Code</h2><input id="num" placeholder="947XXXXXXXX"/><button onclick="getCode()">GET PAIR CODE</button><div id="codeArea" style="display:none"><div class="code" id="code"></div><p>WhatsApp > Linked Devices > Link with phone number</p></div></div><div class="card"><h3>Status: <span id="s">Loading</span> | Msgs: <span id="c">0</span></h3></div><div class="card"><h3>🗑️ Deleted</h3><div id="m">Loading...</div></div><script>async function getCode(){let n=document.getElementById('num').value;if(!n)return alert('Number!');let r=await fetch('/pair?number='+n).then(r=>r.json());if(r.code){document.getElementById('codeArea').style.display='block';document.getElementById('code').innerText=r.code}else alert(r.error)}async function load(){let a=await fetch('/api/stats').then(r=>r.json());document.getElementById('s').innerText=a.status;document.getElementById('c').innerText=a.total;let b=await fetch('/api/messages').then(r=>r.json());document.getElementById('m').innerHTML=b.map(x=>'<div style=border-bottom:1px solid #333;padding:8px 0><b>'+x.from+'</b>: '+x.text+'<br><small style=color:#888>'+x.time+'</small></div>').join('')||'None'}load();setInterval(load,3000)</script></body></html>`)
})
app.get('/api/stats', (req,res) => res.json({ status: global.botStatus, total: msgStore.size }))
app.get('/api/messages', (req,res) => res.json([...msgStore.values()].slice(-100).reverse()))
app.get('/pair', async (req,res) => {
  try{
    const number = req.query.number
    if(!number) return res.json({ error: 'Number needed' })
    if(global.sock && !global.sock.authState.creds.registered){
      const code = await global.sock.requestPairingCode(number.trim())
      return res.json({ code })
    } else { return res.json({ error: 'Bot already paired. Delete session folder and restart.' }) }
  }catch(e){ res.json({ error: e.message }) }
})
app.listen(config.dashboardPort, () => console.log('Dashboard running'))

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: state, logger: pino({level:'silent'}), printQRInTerminal: true, browser: ['SACHI-MD','Chrome','1.0'] })
  global.sock = sock
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', (u) => {
    if(u.connection === 'open'){ global.botStatus='Online 🟢'; console.log('SACHI-MD Connected!') }
    if(u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot()
  })
  sock.ev.on('messages.upsert', async ({messages}) => {
    for(let msg of messages){
      if(!msg.message) continue
      const jid = msg.key.remoteJid
      const pushName = msg.pushName || 'User'
      let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || ''
      if(!msg.key.fromMe) msgStore.set(msg.key.id, { id: msg.key.id, jid, text: text || '[Media]', from: pushName, time: new Date().toLocaleString() })
      let viewOnce = msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage
      if(viewOnce && config.antiViewOnce){
        try{
          let media = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({level:'silent'}) })
          let cap = viewOnce.message?.imageMessage?.caption || viewOnce.message?.videoMessage?.caption || ''
          await sock.sendMessage(jid, { image: media, caption: `*🔒 ANTI VIEWONCE*\n*From:* ${pushName}\n${cap}` })
        }catch{}
      }
      if(!text.startsWith(config.prefix)) continue
      const args = text.slice(config.prefix.length).trim().split(/ +/)
      const cmd = args.shift().toLowerCase()
      if(cmd === 'menu'){ await sock.sendMessage(jid, { text: `*SACHI-MD MENU*\n\n.menu\n.ping\n.tagall\n.kick @\n.fb link\n.tiktok link\n.ig link\n.ytmp3 link\n.ytmp4 link\n.antidelete on/off\n.antiviewonce on/off` }, { quoted: msg }) }
      if(cmd === 'ping'){ await sock.sendMessage(jid, { text: `Pong! Online 🟢` }, { quoted: msg }) }
      if(cmd === 'tagall'){
        if(!jid.endsWith('@g.us')) return
        let meta = await sock.groupMetadata(jid)
        let txt = `*SACHI TAGALL* (${meta.participants.length})\n\n`
        for(let p of meta.participants) txt+=`@${p.id.split('@')[0]} `
        await sock.sendMessage(jid, { text: txt, mentions: meta.participants.map(p=>p.id) })
      }
      if(cmd === 'kick'){
        let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        if(user) await sock.groupParticipantsUpdate(jid, [user], 'remove')
      }
      if(['fb','fbdl','tiktok','tt','ig','igdl','twitter','x'].includes(cmd)){
        let url = args[0]
        if(!url) return sock.sendMessage(jid, { text: `Link දාන්න! .${cmd} https://...` }, { quoted: msg })
        try{
          await sock.sendMessage(jid, { text: `⏳ Downloading ${cmd}...` }, { quoted: msg })
          let dl = ''
          if(cmd.includes('tiktok')||cmd==='tt'){ let r=await fetch(`https://tikwm.com/api/?url=${url}`).then(r=>r.json()); dl=r.data?.play }
          else { let r=await fetch(`https://api-aswin-sparky.koyeb.app/api/downloader/fb?url=${url}`).then(r=>r.json()); dl=r.data?.hd||r.data?.sd||r.data?.[0]?.url }
          if(dl) await sock.sendMessage(jid, { video: { url: dl }, caption: `*SACHI-MD ${cmd.toUpperCase()}* ✅` }, { quoted: msg })
          else await sock.sendMessage(jid, { text: `❌ Failed` })
        }catch(e){ await sock.sendMessage(jid, { text: `Error: ${e.message}` }) }
      }
      if(cmd === 'ytmp3' || cmd === 'ytmp4'){
        let url=args[0]; if(!url) return
        try{
          await sock.sendMessage(jid, { text: `⏳ YT Downloading...` })
          let r=await fetch(`https://api-aswin-sparky.koyeb.app/api/downloader/yt?url=${url}&type=${cmd==='ytmp3'?'mp3':'mp4'}`).then(r=>r.json())
          let dl=r.data?.download
          if(dl) await sock.sendMessage(jid, { [cmd==='ytmp3'?'audio':'video']: { url: dl }, mimetype: cmd==='ytmp3'?'audio/mpeg':'video/mp4' }, { quoted: msg })
        }catch{}
      }
    }
  })
  sock.ev.on('messages.delete', async (item) => {
    if(!config.antiDelete) return
    for(let k of item.keys){
      let old = msgStore.get(k.id)
      if(old) await sock.sendMessage(k.remoteJid, { text: `*🚨 ANTI DELETE*\n*From:* ${old.from}\n*Deleted:* ${old.text}` })
    }
  })
}
startBot()
