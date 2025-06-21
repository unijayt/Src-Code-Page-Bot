const { sendMessage } = require("../handles/sendMessage");
const WebSocket = require("ws");
const axios = require("axios");

const activeSessions = new Map();
const lastSentCache = new Map();
const PH_TIMEZONE = "Asia/Manila";

function pad(n) {
  return n < 10 ? "0" + n : n;
}

function getPHTime() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: PH_TIMEZONE }));
}

function getCountdown(target) {
  const now = getPHTime();
  const msLeft = target - now;
  if (msLeft <= 0) return "00h 00m 00s";
  const h = Math.floor(msLeft / 3.6e6);
  const m = Math.floor((msLeft % 3.6e6) / 6e4);
  const s = Math.floor((msLeft % 6e4) / 1000);
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function getNextRestocks() {
  const now = getPHTime();
  const timers = {};

  const nextEgg = new Date(now);
  nextEgg.setMinutes(now.getMinutes() < 30 ? 30 : 0);
  if (now.getMinutes() >= 30) nextEgg.setHours(now.getHours() + 1);
  nextEgg.setSeconds(0, 0);
  timers.egg = getCountdown(nextEgg);

  const next5 = new Date(now);
  const nextM = Math.ceil((now.getMinutes() + (now.getSeconds() > 0 ? 1 : 0)) / 5) * 5;
  next5.setMinutes(nextM === 60 ? 0 : nextM, 0, 0);
  if (nextM === 60) next5.setHours(now.getHours() + 1);
  timers.gear = timers.seed = getCountdown(next5);

  const nextHoney = new Date(now);
  nextHoney.setMinutes(now.getMinutes() < 30 ? 30 : 0);
  if (now.getMinutes() >= 30) nextHoney.setHours(now.getHours() + 1);
  nextHoney.setSeconds(0, 0);
  timers.honey = getCountdown(nextHoney);

  const next7 = new Date(now);
  const totalHours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const next7h = Math.ceil(totalHours / 7) * 7;
  next7.setHours(next7h, 0, 0, 0);
  timers.cosmetics = getCountdown(next7);

  return timers;
}

function formatValue(val) {
  if (val >= 1_000_000) return `x${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `x${(val / 1_000).toFixed(1)}K`;
  return `x${val}`;
}

function addEmoji(name) {
  const emojis = {
    "Common Egg": "🥚", "Uncommon Egg": "🐣", "Rare Egg": "🍳", "Legendary Egg": "🪺", "Mythical Egg": "🔮",
    "Bug Egg": "🪲", "Cleaning Spray": "🧴", "Friendship Pot": "🪴", "Watering Can": "🚿", "Trowel": "🛠️",
    "Recall Wrench": "🔧", "Basic Sprinkler": "💧", "Advanced Sprinkler": "💦", "Godly Sprinkler": "⛲",
    "Lightning Rod": "⚡", "Master Sprinkler": "🌊", "Favorite Tool": "❤️", "Harvest Tool": "🌾", "Carrot": "🥕",
    "Strawberry": "🍓", "Blueberry": "🫐", "Orange Tulip": "🌷", "Tomato": "🍅", "Corn": "🌽", "Daffodil": "🌼",
    "Watermelon": "🍉", "Pumpkin": "🎃", "Apple": "🍎", "Bamboo": "🎍", "Coconut": "🥥", "Cactus": "🌵",
    "Dragon Fruit": "🍈", "Mango": "🥭", "Grape": "🍇", "Mushroom": "🍄", "Pepper": "🌶️", "Cacao": "🍫",
    "Beanstalk": "🌱", "Ember Lily": "🏵️", "Sugar Apple": "🍏"
  };
  return `${emojis[name] || ""} ${name}`;
}

module.exports = {
  name: "gagstock",
  description: "Track Grow A Garden stock using WebSocket live updates.",
  usage: "gagstock on | gagstock on Sunflower | Watering Can | gagstock off",
  category: "Tools ⚒️",

  async execute(senderId, args, pageAccessToken) {
    const action = args[0]?.toLowerCase();
    const filters = args.slice(1).join(" ").split("|").map(f => f.trim().toLowerCase()).filter(Boolean);

    if (action === "off") {
      const session = activeSessions.get(senderId);
      if (session) {
        clearInterval(session.keepAlive);
        session.closed = true;
        session.ws?.terminate();
        activeSessions.delete(senderId);
        lastSentCache.delete(senderId);
        return await sendMessage(senderId, { text: "🛑 Gagstock tracking stopped." }, pageAccessToken);
      } else {
        return await sendMessage(senderId, { text: "⚠️ You don't have an active gagstock session." }, pageAccessToken);
      }
    }

    if (action !== "on") {
      return await sendMessage(senderId, {
        text: "📌 Usage:\n• gagstock on\n• gagstock on Sunflower | Watering Can\n• gagstock off"
      }, pageAccessToken);
    }

    if (activeSessions.has(senderId)) {
      return await sendMessage(senderId, {
        text: "📡 You're already tracking Gagstock. Use gagstock off to stop."
      }, pageAccessToken);
    }

    await sendMessage(senderId, { text: "✅ Gagstock tracking started via WebJay!" }, pageAccessToken);

    let ws;
    let keepAliveInterval;

    function connectWebSocket() {
      ws = new WebSocket("wss://gagstock.gleeze.com");

      ws.on("open", () => {
        keepAliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 10000);
      });

      ws.on("message", async (data) => {
        try {
          const payload = JSON.parse(data);
          if (payload.status !== "success") return;

          const backup = payload.data;
          const stockData = {
            gearStock: backup.gear.items.map(i => ({ name: i.name, value: Number(i.quantity) })),
            seedsStock: backup.seed.items.map(i => ({ name: i.name, value: Number(i.quantity) })),
            eggStock: backup.egg.items.map(i => ({ name: i.name, value: Number(i.quantity) })),
            cosmeticsStock: backup.cosmetics.items.map(i => ({ name: i.name, value: Number(i.quantity) })),
            honeyStock: backup.honey.items.map(i => ({ name: i.name, value: Number(i.quantity) }))
          };

          const currentKey = JSON.stringify({
            gearStock: stockData.gearStock,
            seedsStock: stockData.seedsStock
          });

          const lastSent = lastSentCache.get(senderId);
          if (lastSent === currentKey) return;
          lastSentCache.set(senderId, currentKey);

          const restocks = getNextRestocks();
          const formatList = (arr) => arr.map(i => `- ${addEmoji(i.name)}: ${formatValue(i.value)}`).join("\n");

          let filteredContent = "";
          let matched = 0;

          const addSection = (label, items, restock) => {
            const filtered = filters.length ? items.filter(i => filters.some(f => i.name.toLowerCase().includes(f))) : items;
            if (label === "🛠️ 𝗚𝗲𝗮𝗿" || label === "🌱 𝗦𝗲𝗲𝗱𝘀") {
              if (filtered.length > 0) {
                matched += filtered.length;
                filteredContent += `${label}:\n${formatList(filtered)}\n⏳ Restock In: ${restock}\n\n`;
              }
            } else {
              filteredContent += `${label}:\n${formatList(items)}\n⏳ Restock In: ${restock}\n\n`;
            }
          };

          addSection("🛠️ 𝗚𝗲𝗮𝗿", stockData.gearStock, restocks.gear);
          addSection("🌱 𝗦𝗲𝗲𝗱𝘀", stockData.seedsStock, restocks.seed);
          addSection("🥚 𝗘𝗴𝗴𝘀", stockData.eggStock, restocks.egg);
          addSection("🎨 𝗖𝗼𝘀𝗺𝗲𝘁𝗶𝗰𝘀", stockData.cosmeticsStock, restocks.cosmetics);
          addSection("🍯 𝗛𝗼𝗻𝗲𝘆", stockData.honeyStock, restocks.honey);

          if (matched === 0 && filters.length > 0) return;

          const updatedAtPH = getPHTime().toLocaleString("en-PH", {
            hour: "numeric", minute: "numeric", second: "numeric",
            hour12: true, day: "2-digit", month: "short", year: "numeric"
          });

          const weather = await axios.get("https://growagardenstock.com/api/stock/weather").then(res => res.data).catch(() => null);
          const weatherInfo = weather ? `🌤️ 𝗪𝗲𝗮𝘁𝗵𝗲𝗿: ${weather.icon} ${weather.weatherType}\n📋 ${weather.description}\n🎯 ${weather.cropBonuses}\n` : "";

          const message = `🌾 𝗚𝗿𝗼𝘄 𝗔 𝗚𝗮𝗿𝗱𝗲𝗻 — 𝗧𝗿𝗮𝗰𝗸𝗲𝗿 By : Jay Ar\n\n${filteredContent}${weatherInfo}📅 Updated at (PH): ${updatedAtPH}`;

          if (!activeSessions.has(senderId)) return;
          await sendMessage(senderId, { text: message }, pageAccessToken);
        } catch (e) {}
      });

      ws.on("close", () => {
        clearInterval(keepAliveInterval);
        const session = activeSessions.get(senderId);
        if (session && !session.closed) setTimeout(connectWebSocket, 3000);
      });

      ws.on("error", () => {
        ws.close();
      });

      activeSessions.set(senderId, { ws, keepAlive: keepAliveInterval, closed: false });
    }

    connectWebSocket();
  }
};
