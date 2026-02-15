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
  if (message.channel.name !== PING_CHANNEL) return;
  if (message.author.bot) return;
  
  if (!message.content.startsWith('NEUER PING')) {
    console.log(`⏭️  Message doesn't start with 'NEUER PING'`);
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
    // Get all sheet names
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetNames = metadata.data.sheets.map(s => s.properties.title);
    console.log(`📂 Existing sheets: ${sheetNames.join(', ')}`);
    
    // Create sheet if doesn't exist
    if (!sheetNames.includes(player)) {
      console.log(`📝 Creating new sheet: ${player}`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: player }
            }
          }]
        }
      });
      
      // Add header
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${player}!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Lat', 'Lon', 'Time']]
        }
      });
      console.log(`✅ Sheet created with headers`);
    }
    
    // Append ping to player sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[lat, lon, time]]
      }
    });
    
    console.log(`✅ Ping added to sheet: ${player}`);
    
    // Get all data from player sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`
    });
    
    const rows = response.data.values || [];
    console.log(`📊 Sheet ${player} has ${rows.length} rows (including header)`);
    
    // Generate KML from all pings (skip header)
    const dataRows = rows.slice(1);
    let placemarks = '';
    let coordinates = [];
    
    dataRows.forEach((row) => {
      const [rowLat, rowLon, rowTime] = row;
      placemarks += `
    <Placemark>
      <name>${rowTime}</name>
      <description>${player}</description>
      <Point>
        <coordinates>${rowLon},${rowLat},0</coordinates>
      </Point>
    </Placemark>`;
      coordinates.push(`${rowLon},${rowLat},0`);
    });
    
    // Add line if multiple pings
    if (coordinates.length > 1) {
      placemarks += `
    <Placemark>
      <name>${player} Bewegung</name>
      <description>Bewegungsverlauf</description>
      <LineString>
        <coordinates>
          ${coordinates.join('\n          ')}
        </coordinates>
      </LineString>
    </Placemark>`;
    }
    
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${player}</name>${placemarks}
  </Document>
</kml>`;
    
    const kmlFile = `${player}.kml`;
    fs.writeFileSync(kmlFile, kml);
    console.log(`✅ KML generated: ${kmlFile} (${dataRows.length} pings)`);
    
    // Send to KML channel
    const kmlChannel = message.guild.channels.cache.find(ch => ch.name === KML_CHANNEL);
    if (!kmlChannel) {
      console.error(`❌ Channel #${KML_CHANNEL} not found`);
      message.reply(`❌ Channel #${KML_CHANNEL} not found`);
      return;
    }
    
    await kmlChannel.send({
      content: `📍 **${player}** (${dataRows.length} pings)`,
      files: [kmlFile]
    });
    
    console.log(`✅ KML sent to #${KML_CHANNEL}`);
    message.reply(`✅ ${player} gespeichert (${dataRows.length} pings total)`);
    
    fs.unlinkSync(kmlFile);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
