const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const https = require('https');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GEO_FILE = 'pings.geojson';
const GIST_ID = process.env.GIST_ID; // z.B. abc123def456
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

let geoData = {
  type: 'FeatureCollection',
  features: []
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('clientReady', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  loadGeoData();
});

client.on('messageCreate', (message) => {
  console.log(`📨 Message in ${message.channel.name}: "${message.content}" by ${message.author.username}`);
  
  if (message.channel.name !== PING_CHANNEL) return;
  if (message.author.bot) return;

  const match = message.content.match(/Player:\s*(.+?),\s*Lat:\s*([\d.-]+),\s*Lon:\s*([\d.-]+),\s*Time:\s*(.+)/i);
  
  if (!match) {
    console.log(`❌ Format nicht erkannt`);
    return;
  }

  const [, player, lat, lon, time] = match;
  console.log(`✅ Parsed: ${player} @ ${lat}, ${lon}`);
  
  addPing(player, parseFloat(lat), parseFloat(lon), time);
  saveGeoData();
  pushToGist();
  
  message.reply(`✅ Ping: ${player} @ ${time}`);
});

function addPing(player, lat, lon, time) {
  geoData.features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { player, time, timestamp: new Date().toISOString() }
  });
}

function saveGeoData() {
  fs.writeFileSync(GEO_FILE, JSON.stringify(geoData, null, 2));
  console.log(`💾 GeoJSON: ${geoData.features.length} features`);
}

function loadGeoData() {
  if (fs.existsSync(GEO_FILE)) {
    geoData = JSON.parse(fs.readFileSync(GEO_FILE));
  }
}

function pushToGist() {
  if (!GIST_ID || !GITHUB_TOKEN) {
    console.log(`⚠️ GIST_ID oder GITHUB_TOKEN nicht gesetzt`);
    return;
  }

  const data = JSON.stringify({
    files: {
      'pings.geojson': {
        content: JSON.stringify(geoData, null, 2)
      }
    }
  });

  const options = {
    hostname: 'api.github.com',
    path: `/gists/${GIST_ID}`,
    method: 'PATCH',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'User-Agent': 'Hunt-Game-Bot'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`✅ Gist updated (${res.statusCode})`);
  });

  req.on('error', (e) => {
    console.error(`❌ Gist push failed: ${e.message}`);
  });

  req.write(data);
  req.end();
}

client.login(process.env.DISCORD_TOKEN);
