import config from '../config.js';

export async function handleCommand(sock, msg, command, args) {
  const sender = msg.key.remoteJid;
  const senderNumber = sender.split('@')[0].split(':')[0];
  
  switch (command) {
    case 'ping':
      await sock.sendMessage(sender, { text: '🏓 Pong! Bot එක Online!' });
      break;
    case 'menu':
      const menu = `
╭─「 SACHI-MD 」─
│
│ ✦ !ping - Bot එක Test කරන්න
│ ✦ !menu - Menu එක බලන්න
│ ✦ !owner - Owner ගැන දැනගන්න
│ ✦ !help - උදව් ගන්න
│
╰─「 SACHI-MD 」─
      `;
      await sock.sendMessage(sender, { text: menu });
      break;
    case 'owner':
      await sock.sendMessage(sender, { text: `👤 Owner: ${config.ownerNumber}` });
      break;
    case 'help':
      await sock.sendMessage(sender, { text: '📖 !menu එකෙන් Commands බලන්න' });
      break;
    default:
      await sock.sendMessage(sender, { text: `❌ Command එකක් නෙවෙයි: ${command}` });
      break;
  }
}
