const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_CREDENTIALS = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString());

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
  initializeGoogle();
});

function initializeGoogle() {
  auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  
  sheets = google.sheets({ version: 'v4', auth });
  drive = google.drive({ version: 'v3', auth });
  console.log(`✅ Google APIs initialized`);
}

client.on('messageCreate', async (message) => {
  console.log(`📨 Message in ${message.channel.name}: "${message.content}" by ${message.author.username}`);
  
  if (message.channel.name !== PING_CHANNEL) return;
  if (message.author.bot) return;

  // Parse: "NEUER PING - Spieler 1 (03.04. 13:00): Lat48.123 Lon11.456"
  const match = message.content.match(/NEUER PING - (.+?) \((.+?)\): Lat([\d.-]+) Lon([\d.-]+)/i);
  
  if (!match) {
    console.log(`❌ Format nicht erkannt`);
    return;
  }

  const [, player, time, lat, lon] = match;
  console.log(`✅ Parsed: Player=${player}, Time=${time}, Lat=${lat}, Lon=${lon}`);
  
  try {
    await addPingToSheet(player, lat, lon, time);
    const kmlPath = await generateKML(player);
    await uploadToGoogleDrive(player, kmlPath);
    
    const driveUrl = `https://drive.google.com/drive/folders/${GOOGLE_DRIVE_FOLDER_ID}`;
    message.reply(`✅ Ping gespeichert: ${player} @ ${time}\n📍 KML in Drive: ${driveUrl}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    message.reply(`❌ Fehler beim Speichern: ${error.message}`);
  }
});

async function addPingToSheet(player, lat, lon, time) {
  try {
    // Blatt-Namen abrufen
    const sheetMetadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    const sheetNames = sheetMetadata.data.sheets.map(s => s.properties.title);
    console.log(`📂 Existing sheets: ${sheetNames.join(', ')}`);
    
    let sheetName = player;
    
    // Falls Blatt nicht existiert, erstellen
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
      
      // Header-Zeile hinzufügen
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${player}!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Lat', 'Lon', 'Time']]
        }
      });
    }
    
    // Daten hinzufügen
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[lat, lon, time]]
      }
    });
    
    console.log(`✅ Row added to sheet: ${player}`);
  } catch (error) {
    console.error(`❌ Sheet error: ${error.message}`);
    throw error;
  }
}

async function generateKML(player) {
  try {
    // Daten aus Sheet abrufen
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${player}!A:C`
    });
    
    const rows = response.data.values || [];
    if (rows.length < 2) {
      console.log(`⚠️ No data for ${player}`);
      return;
    }
    
    // Header überspringen
    const data = rows.slice(1);
    
    // KML generieren
    let placemarks = '';
    let coordinates = [];
    
    data.forEach((row, index) => {
      const [lat, lon, time] = row;
      placemarks += `
    <Placemark>
      <name>${time}</name>
      <description>${player}</description>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>`;
      coordinates.push(`${lon},${lat},0`);
    });
    
    // Linie hinzufügen
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
    
    const kmlPath = `${player}.kml`;
    fs.writeFileSync(kmlPath, kml);
    console.log(`✅ KML generated: ${kmlPath}`);
    return kmlPath;
  } catch (error) {
    console.error(`❌ KML error: ${error.message}`);
    throw error;
  }
}

async function uploadToGoogleDrive(player, kmlPath) {
  try {
    // Prüfe ob Datei existiert
    const listResponse = await drive.files.list({
      q: `name='${player}.kml' and parents='${GOOGLE_DRIVE_FOLDER_ID}' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id)'
    });
    
    const fileMetadata = {
      name: `${player}.kml`,
      parents: [GOOGLE_DRIVE_FOLDER_ID]
    };
    
    const media = {
      mimeType: 'application/vnd.google-earth.kml+xml',
      body: fs.createReadStream(kmlPath)
    };
    
    if (listResponse.data.files.length > 0) {
      // Update existierende Datei
      await drive.files.update({
        fileId: listResponse.data.files[0].id,
        media
      });
      console.log(`✅ Drive file updated: ${player}.kml`);
    } else {
      // Neue Datei erstellen
      await drive.files.create({
        resource: fileMetadata,
        media
      });
      console.log(`✅ Drive file created: ${player}.kml`);
    }
    
    fs.unlinkSync(kmlPath); // Lokale Datei löschen
  } catch (error) {
    console.error(`❌ Drive error: ${error.message}`);
    throw error;
  }
}

client.login(process.env.DISCORD_TOKEN);

