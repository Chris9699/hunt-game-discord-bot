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

client.on('clientReady', async () => {
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
    
    await ensureDataSheet();
  } catch (error) {
    console.error(`❌ Google init error: ${error.message}`);
  }
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== PING_CHANNEL) return;
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
      range: `${player}!A2:C`,
      valueInputOption: 'RAW',
      requestBody: { values: [[lat, lon, time]] }
    });
    
    console.log(`✅ Ping added to ${player}`);
    
    // Generate player KML
    const playerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A1:C`
    });
    
    const playerRows = playerResponse.data.values?.slice(1) || [];
    const playerKml = generateKML(player, playerRows);
    
    // Generate latest.kml
    const latestPlacemarks = [];
    for (const sheetName of sheetNames) {
      if (sheetName === 'Data') continue;
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A1:C`
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
    console.log(`✅ KMLs generated`);
    
    const kmlChannel = message.guild.channels.cache.find(ch => ch.name === KML_CHANNEL);
    if (!kmlChannel) {
      message.reply(`❌ #${KML_CHANNEL} not found`);
      return;
    }
    
    // Update player KML
    const oldPlayerMsgId = await getMsgId(player, 'player');
    if (oldPlayerMsgId) {
      try {
        const oldMsg = await kmlChannel.messages.fetch(oldPlayerMsgId);
        await oldMsg.delete();
        console.log(`🗑️ Deleted old ${player} message`);
      } catch (e) {
        console.log(`⚠️ Could not delete old message`);
      }
    }
    
    const playerMessage = await kmlChannel.send({
      content: `📍 **${player}** (${playerRows.length} pings)`,
      files: [playerKmlFile]
    });
    
    await saveMsgId(player, playerMessage.id, 'player');
    console.log(`✅ Player KML sent`);
    
    // Update latest KML
    const oldLatestMsgId = await getMsgId('latest', 'latest');
    if (oldLatestMsgId) {
      try {
        const oldMsg = await kmlChannel.messages.fetch(oldLatestMsgId);
        await oldMsg.delete();
        console.log(`🗑️ Deleted old latest message`);
      } catch (e) {
        console.log(`⚠️ Could not delete old latest message`);
      }
    }
    
    const latestMessage = await kmlChannel.send({
      content: `🗺️ **Latest Pings** (${latestPlacemarks.length} players)`,
      files: [latestKmlFile]
    });
    
    await saveMsgId('latest', latestMessage.id, 'latest');
    console.log(`✅ Latest KML sent`);
    
    message.reply(`✅ ${player} gespeichert (${playerRows.length} pings)`);
    
    fs.unlinkSync(playerKmlFile);
    fs.unlinkSync(latestKmlFile);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    message.reply(`❌ ${error.message}`);
  }
});

async function ensureDataSheet() {
  try {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetNames = metadata.data.sheets.map(s => s.properties.title);
    
    if (!sheetNames.includes('Data')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: 'Data' } }
          }]
        }
      });
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'Data!A1:C1',
        valueInputOption: 'RAW',
        requestBody: { values: [['player', 'msg_id', 'type']] }
      });
      console.log(`✅ Data sheet created`);
    }
  } catch (error) {
    console.error(`❌ Error ensuring Data sheet: ${error.message}`);
  }
}

async function getMsgId(player, type = 'player') {
  try {
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Data!A1:C'
    });
    
    const data = rows.data.values || [];
    const row = data.find(r => r[0] === player && r[2] === type);
    return row ? row[1] : null;
  } catch (e) {
    console.log(`⚠️ Could not get msg ID: ${e.message}`);
    return null;
  }
}

async function saveMsgId(player, msgId, type = 'player') {
  try {
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Data!A1:C'
    });
    
    const data = rows.data.values || [];
    const playerRowIndex = data.findIndex(r => r[0] === player && r[2] === type);
    
    if (playerRowIndex >= 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `Data!B${playerRowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[msgId]] }
      });
      console.log(`✅ Updated ${type} msg ID for ${player}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'Data!A2:C',
        valueInputOption: 'RAW',
        requestBody: { values: [[player, msgId, type]] }
      });
      console.log(`✅ Saved new ${type} msg ID for ${player}`);
    }
  } catch (e) {
    console.error(`❌ Could not save msg ID: ${e.message}`);
  }
}

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


