import config from '../config.js';

export async function handleCommand(sock, msg, command, args) {
  const from = msg.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? msg.key.participant : from;
  const senderNumber = sender.split('@')[0];
  const ownerNumber = config.ownerNumber.replace(/\D/g, '');
  
  // Owner Only Commands
  const ownerOnlyCommands = ['restart', 'shutdown', 'eval'];
  
  if (ownerOnlyCommands.includes(command) && senderNumber !== ownerNumber) {
    return sock.sendMessage(from, { text: '❌ මේ Command එක Owner කෙනාට විතරයි!' }, { quoted: msg });
  }
  
  switch(command) {
    case 'ping':
      await sock.sendMessage(from, { text: `🏓 Pong! ${Math.floor(Math.random() * 100) + 1}ms` }, { quoted: msg });
      break;
      
    case 'menu':
      await sock.sendMessage(from, { 
        text: `🤖 *${config.botName}*\n\n` +
              `📌 *Commands:*\n` +
              `.ping - Bot එක වැඩ කරනවාද බලන්න\n` +
              `.menu - මේ Menu එක\n` +
              `.help - උදව්ව\n` +
              `.about - Bot ගැන\n\n` +
              `👑 Owner: ${config.ownerNumber}`
      }, { quoted: msg });
      break;
      
    case 'help':
      await sock.sendMessage(from, { 
        text: `📖 *Help Menu*\n\n` +
              `.ping - Pong Reply\n` +
              `.menu - Main Menu\n` +
              `.about - Bot Info`
      }, { quoted: msg });
      break;
      
    case 'about':
      await sock.sendMessage(from, { 
        text: `ℹ️ *About ${config.botName}*\n\n` +
              `Version: 2.1.0\n` +
              `Prefix: ${config.prefix}\n` +
              `Owner: ${config.ownerNumber}`
      }, { quoted: msg });
      break;
      
    default:
      await sock.sendMessage(from, { text: `❓ Command එකක් නැති: *${command}*\n.menu දෙන්න` }, { quoted: msg });
      break;
  }
}
