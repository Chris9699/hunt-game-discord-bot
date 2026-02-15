const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GEO_FILE = 'pings.geojson';

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
  
  if (message.channel.name !== PING_CHANNEL) {
    console.log(`❌ Channel ${message.channel.name} ≠ ${PING_CHANNEL}`);
    return;
  }
  
  if (message.author.bot) {
    console.log(`❌ Bot message ignored`);
    return;
  }

  const match = message.content.match(/Player:\s*(\w+),\s*Lat:\s*([\d.-]+),\s*Lon:\s*([\d.-]+),\s*Time:\s*(.+)/i);
  
  if (!match) {
    console.log(`❌ Format nicht erkannt`);
    return;
  }

  const [, player, lat, lon, time] = match;
  console.log(`✅ Parsed: Player=${player}, Lat=${lat}, Lon=${lon}, Time=${time}`);
  
  addPing(player, parseFloat(lat), parseFloat(lon), time);
  saveGeoData();
  console.log(`✅ GeoJSON gespeichert. Features: ${geoData.features.length}`);
  
  message.reply(`✅ Ping: ${player} @ ${time}`);
});

function addPing(player, lat, lon, time) {
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      player,
      time,
      timestamp: new Date().toISOString()
    }
  };
  geoData.features.push(feature);
}

function saveGeoData() {
  fs.writeFileSync(GEO_FILE, JSON.stringify(geoData, null, 2));
  console.log(`💾 ${GEO_FILE} aktualisiert`);
}

function loadGeoData() {
  if (fs.existsSync(GEO_FILE)) {
    geoData = JSON.parse(fs.readFileSync(GEO_FILE));
    console.log(`📂 GeoJSON geladen: ${geoData.features.length} features`);
  } else {
    console.log(`📂 Neue GeoJSON erstellt`);
  }
}

client.login(process.env.DISCORD_TOKEN);
