import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import readline from 'readline'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

async function getPair(){
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: state, logger: pino({level:'silent'}), printQRInTerminal: false, browser: ['SACHI-MD','Chrome','1.0'] })
  sock.ev.on('creds.update', saveCreds)
  if(!sock.authState.creds.registered){
    const num = await question('Enter Number 947XXXXXXXX: ')
    const code = await sock.requestPairingCode(num.trim())
    console.log(`\n✅ CODE: ${code}\n`)
  } else { console.log('Already Paired!') }
  rl.close()
}
getPair()
