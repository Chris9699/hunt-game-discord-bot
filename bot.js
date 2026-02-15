const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

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

  const match = message.content.match(/NEUER PING - (.+?) \((.+?)\): Lat([\d.-]+) Lon([\d.-]+)/i);
  
  if (!match) return;

  const [, player, time, lat, lon] = match;
  console.log(`✅ Parsed: ${player}, ${time}, ${lat}, ${lon}`);
  
  try {
    // Add to sheet
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetName = metadata.data.sheets[0].properties.title;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A:D`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[player, lat, lon, time]]
      }
    });
    
    console.log(`✅ Row added`);
    
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
    console.log(`✅ ${kmlFile} created`);
    
    // Send as Discord attachment
    await message.channel.send({
      files: [kmlFile]
    });
    
    console.log(`✅ KML sent to Discord`);
    message.reply(`✅ Ping gespeichert: ${player}`);
    
    // Cleanup
    fs.unlinkSync(kmlFile);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
