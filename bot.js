const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDENTIALS_B64 = process.env.GOOGLE_CREDENTIALS_B64;

let sheets;
let auth;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('clientReady', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  try {
    const credentialsJson = Buffer.from(GOOGLE_CREDENTIALS_B64, 'base64').toString();
    const credentials = JSON.parse(credentialsJson);
    
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    sheets = google.sheets({ version: 'v4', auth });
    console.log(`✅ Google Sheets initialized`);
  } catch (error) {
    console.error(`❌ Google init failed: ${error.message}`);
  }
});

client.on('messageCreate', async (message) => {
  console.log(`📨 ${message.channel.name}: "${message.content}" by ${message.author.username}`);
  
  if (message.channel.name !== PING_CHANNEL) return;
  if (message.author.bot) return;

  // Parse: "NEUER PING - Spieler 1 (03.04. 13:00): Lat48.123 Lon11.456"
  const match = message.content.match(/NEUER PING - (.+?) \((.+?)\): Lat([\d.-]+) Lon([\d.-]+)/i);
  
  if (!match) {
    console.log(`❌ Format failed`);
    return;
  }

  const [, player, time, lat, lon] = match;
  console.log(`✅ Parsed: ${player}, ${time}, ${lat}, ${lon}`);
  
  try {
    // Sheet append
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `Sheet1!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[player, lat, lon, time]]
      }
    });
    
    console.log(`✅ Row added to Google Sheet`);
    message.reply(`✅ Daten gespeichert: ${player}`);
  } catch (error) {
    console.error(`❌ Sheet error: ${error.message}`);
    message.reply(`❌ Error: ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);

