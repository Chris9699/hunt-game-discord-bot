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
  
  if (!message.content.startsWith('NEUER PING')) return;

  const match = message.content.match(/NEUER PING - (.+?) \((.+?)\): Lat([\d.-]+) Lon([\d.-]+)/i);
  
  if (!match) {
    message.reply(`❌ Format: NEUER PING - Spieler X (dd.mm. HH:MM): LatXX.XXX LonXX.XXX`);
    return;
  }

  const [, player, time, lat, lon] = match;
  console.log(`✅ Parsed: ${player}, ${time}, ${lat}, ${lon}`);
  
  try {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetNames = metadata.data.sheets.map(s => s.properties.title);
    console.log(`📂 Sheets: ${sheetNames.join(', ')}`);
    
    if (!sheetNames.includes(player)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: player } }
          }]
        }
      });
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${player}!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Lat', 'Lon', 'Time']] }
      });
      console.log(`✅ Sheet created: ${player}`);
    }
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`,
      valueInputOption: 'RAW',
      requestBody: { values: [[lat, lon, time]] }
    });
    
    console.log(`✅ Ping added`);
    
    // Generate player KML
    const playerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`
    });
    
    const playerRows = playerResponse.data.values?.slice(1) || [];
    const playerKml = generateKML(player, playerRows);
    
    // Generate latest.kml with all players' latest pings
    const latestPlacemarks = [];
    
    for (const sheetName of sheetNames) {
      if (sheetName === sheetNames[0]) continue; // Skip first sheet
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A:C`
      });
      
      const rows = response.data.values?.slice(1) || [];
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        const [lastLat, lastLon, lastTime] = lastRow;
        latestPlacemarks.push({
          name: `${sheetName} - ${lastTime}`,
          description: sheetName,
          lon: lastLon,
          lat: lastLat
        });
      }
    }
    
    const latestKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Latest Pings</name>
${latestPlacemarks.map(p => `
    <Placemark>
      <name>${p.name}</name>
      <description>${p.description}</description>
      <Point>
        <coordinates>${p.lon},${p.lat},0</coordinates>
      </Point>
    </Placemark>`).join('')}
  </Document>
</kml>`;
    
    const playerKmlFile = `${player}.kml`;
    const latestKmlFile = 'latest.kml';
    
    fs.writeFileSync(playerKmlFile, playerKml);
    fs.writeFileSync(latestKmlFile, latestKml);
    
    console.log(`✅ KMLs generated: ${playerKmlFile}, ${latestKmlFile}`);
    
    const kmlChannel = message.guild.channels.cache.find(ch => ch.name === KML_CHANNEL);
    if (!kmlChannel) {
      message.reply(`❌ #${KML_CHANNEL} not found`);
      return;
    }
    
    await kmlChannel.send({
      content: `📍 **${player}** (${playerRows.length} pings)`,
      files: [playerKmlFile, latestKmlFile]
    });
    
    console.log(`✅ KMLs sent`);
    message.reply(`✅ ${player} gespeichert (${playerRows.length} pings)`);
    
    fs.unlinkSync(playerKmlFile);
    fs.unlinkSync(latestKmlFile);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

function generateKML(player, rows) {
  let placemarks = '';
  let coordinates = [];
  
  rows.forEach(row => {
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
  
  if (coordinates.length > 1) {
    placemarks += `
    <Placemark>
      <name>${player} Bewegung</name>
      <LineString>
        <coordinates>
          ${coordinates.join('\n          ')}
        </coordinates>
      </LineString>
    </Placemark>`;
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${player}</name>${placemarks}
  </Document>
</kml>`;
}

client.login(process.env.DISCORD_TOKEN);
