const { Client, GatewayIntentBits } = require('discord.js');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('clientReady', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.channel.name === PING_CHANNEL) {
    console.log(`[${message.author.username}] ${message.content}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
