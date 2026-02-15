const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const PING_CHANNEL = process.env.PING_CHANNEL || 'pings';
const GEO_FILE = 'pings.geojson';
const GIST_URL = process.env.GIST_RAW_URL; // z.B. https://gist.githubusercontent.com/...

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
  console.log(`Bot logged in as ${client.user.tag}`);
  loadGeoData();
});

client.on('messageCreate', (message) => {
  if (message.channel.name !== PING_CHANNEL) return;
  if (message.author.bot) return;

  const match = message.content.match(/Player:\s*(\w+),\s*Lat:\s*([\d.-]+),\s*Lon:\s*([\d.-]+),\s*Time:\s*(.+)/i);
  
  if (!match) return;

  const [, player, lat, lon, time] = match;
  
  addPing(player, parseFloat(lat), parseFloat(lon), time);
  saveGeoData();
  
  console.log(`[${player}] Lat: ${lat}, Lon: ${lon}`);
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
}

function loadGeoData() {
  if (fs.existsSync(GEO_FILE)) {
    geoData = JSON.parse(fs.readFileSync(GEO_FILE));
  }
}

client.login(process.env.DISCORD_TOKEN);
