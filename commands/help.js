const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../handles/sendMessage');

module.exports = {
  name: 'help',
  description: 'Show available commands',
  usage: 'help\nhelp [command name]',
  author: 'System',

  execute(senderId, args, pageAccessToken) {
    const commandsDir = path.join(__dirname, '../commands');
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

    const loadCommand = file => {
      try {
        return require(path.join(commandsDir, file));
      } catch {
        return null;
      }
    };

    if (args.length) {
      const name = args[0].toLowerCase();
      const command = commandFiles.map(loadCommand).find(c => c?.name.toLowerCase() === name);

      return sendMessage(
        senderId,
        { text: command
          ? `━━━━━━━━━━━━━━
𝙲𝚘𝚖𝚖𝚊𝚗𝚍 𝙽𝚊𝚖𝚎: ${command.name}
𝙳𝚎𝚜𝚌𝚛𝚒𝚙𝚝𝚒𝚘𝚗: ${command.description}
𝚄𝚜𝚊𝚐𝚎: ${command.usage}
━━━━━━━━━━━━━━`
          : `Command "${name}" not found.` },
        pageAccessToken
      );
    }

    const commandsList = commandFiles
      .map(loadCommand)
      .filter(c => c && c.name !== 'test')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `│ - ${c.name}`)
      .join('\n');

    sendMessage(
      senderId,
      { text: `━━━━━━━━━━━━━━
OWNER: JAY AR

𝙰𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝙲𝚘𝚖𝚖𝚊𝚗𝚍𝚜:
╭─╼━━━━━━━━╾─╮
${commandsList}
╰─━━━━━━━━━╾─╯
Chat -help [name] 
to see command details.

•|Type " gagstock on • gagstock off •|
° IF YOU COUNTER A MISS STOCK PLEASE CONTACT THIS USER
: m.me/61552691907450
━━━━━━━━━━━━━━` },
      pageAccessToken
    );
  }
};
