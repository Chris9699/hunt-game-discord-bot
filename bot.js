const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_CREDENTIALS_B64 = process.env.GOOGLE_CREDENTIALS_B64;

let sheets;
let drive;
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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });
    
    sheets = google.sheets({ version: 'v4', auth });
    drive = google.drive({ version: 'v3', auth });
    console.log(`✅ Google APIs initialized`);
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
    
    console.log(`✅ Row added to sheet`);
    
    // Create test.kml
    const testKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test</name>
    <Placemark>
      <name>${time}</name>
      <description>${player}</description>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    
    fs.writeFileSync('test.kml', testKml);
    console.log(`✅ test.kml created`);
    
    // Upload to Drive
    const fileMetadata = {
      name: 'test.kml',
      parents: [GOOGLE_DRIVE_FOLDER_ID]
    };
    
    const media = {
      mimeType: 'application/vnd.google-earth.kml+xml',
      body: fs.createReadStream('test.kml')
    };
    
    await drive.files.create({
      resource: fileMetadata,
      media
    });
    
    console.log(`✅ test.kml uploaded to Drive`);
    message.reply(`✅ Ping gespeichert & KML uploaded`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
