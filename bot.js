const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const KML_CHANNEL = process.env.KML_CHANNEL || 'kml-export';
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
    console.log(`✅ Google Sheets API initialized`);
  } catch (error) {
    console.error(`❌ Google init error: ${error.message}`);
  }
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== PING_CHANNEL) {
    console.log(`⏭️  Message in ${message.channel.name}, ignoring`);
    return;
  }
  
  console.log(`📨 Message in #${message.channel.name}: "${message.content}" by ${message.author.username}`);
  
  if (message.author.bot) {
    console.log(`⏭️  Bot message, ignoring`);
    return;
  }
  
  // Only process messages starting with "NEUER PING"
  if (!message.content.startsWith('NEUER PING')) {
    console.log(`⏭️  Message doesn't start with 'NEUER PING', ignoring`);
    return;
  }

  const match = message.content.match(/NEUER PING - (.+?) \((.+?)\): Lat([\d.-]+) Lon([\d.-]+)/i);
  
  if (!match) {
    console.log(`❌ Format not recognized`);
    message.reply(`❌ Format: NEUER PING - Spieler X (dd.mm. HH:MM): LatXX.XXX LonXX.XXX`);
    return;
  }

  const [, player, time, lat, lon] = match;
  console.log(`✅ Parsed: Player=${player}, Time=${time}, Lat=${lat}, Lon=${lon}`);
  
  try {
    // Get sheet name
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetName = metadata.data.sheets[0].properties.title;
    console.log(`📂 Using sheet: ${sheetName}`);
    
    // Append to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A:D`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[player, lat, lon, time]]
      }
    });
    
    console.log(`✅ Row added to Google Sheet`);
    
    // Create KML
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${player}</name>
    <Placemark>
      <name>${time}</name>
      <description>${player}</description>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    
    const kmlFile = `${player}.kml`;
    fs.writeFileSync(kmlFile, kml);
    console.log(`✅ KML created: ${kmlFile}`);
    
    // Find KML channel
    const kmlChannel = message.guild.channels.cache.find(ch => ch.name === KML_CHANNEL);
    if (!kmlChannel) {
      console.error(`❌ Channel #${KML_CHANNEL} not found`);
      message.reply(`❌ Channel #${KML_CHANNEL} nicht gefunden`);
      return;
    }
    
    // Send KML to KML channel
    await kmlChannel.send({
      files: [kmlFile]
    });
    
    console.log(`✅ KML sent to #${KML_CHANNEL}`);
    message.reply(`✅ Ping gespeichert: ${player} @ ${time} → KML zu #${KML_CHANNEL}`);
    
    // Cleanup
    fs.unlinkSync(kmlFile);
    console.log(`✅ Temp file deleted`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
