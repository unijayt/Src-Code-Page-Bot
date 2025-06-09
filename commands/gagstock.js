const { sendMessage } = require("../handles/sendMessage");
const axios = require("axios");

const activeSessions = new Map();
const lastSentCache = new Map();
const PH_OFFSET = 8 * 60 * 60 * 1000;

function pad(n) {
  return n < 10 ? "0" + n : n;
}

function getPHTime() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + PH_OFFSET);
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

  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  timers.honey = getCountdown(nextHour);

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
    "Common Egg": "🥚", "Uncommon Egg": "🐣", "Rare Egg": "🍳", "Legendary Egg": "🪺", "Mythical Egg": "🥚", "Bug Egg": "🪲",
    "Watering Can": "🚿", "Trowel": "🛠️", "Recall Wrench": "🔧", "Basic Sprinkler": "💧",
    "Advanced Sprinkler": "💦", "Godly Sprinkler": "⛲", "Lightning Rod": "⚡", "Master Sprinkler": "🌊",
    "Favorite Tool": "❤️", "Harvest Tool": "🌾",
    "Carrot": "🥕", "Strawberry": "🍓", "Blueberry": "🫐", "Orange Tulip": "🌷", "Tomato": "🍅", "Corn": "🌽",
    "Daffodil": "🌼", "Watermelon": "🍉", "Pumpkin": "🎃", "Apple": "🍎", "Bamboo": "🎍", "Coconut": "🥥",
    "Cactus": "🌵", "Dragon Fruit": "🍈", "Mango": "🥭", "Grape": "🍇", "Mushroom": "🍄", "Pepper": "🌶️",
    "Cacao": "🍫", "Beanstalk": "🌱"
  };
  return `${emojis[name] || ""} ${name}`;
}

function normalizeStockData(stockData) {
  const transform = (arr) =>
    arr.map((i) => ({
      name: i.name,
      value: i.value,
    }));
  return {
    gearStock: transform(stockData.gearStock),
    seedsStock: transform(stockData.seedsStock),
    eggStock: transform(stockData.eggStock),
    honeyStock: transform(stockData.honeyStock),
    cosmeticsStock: transform(stockData.cosmeticsStock),
  };
}

async function fetchWithTimeout(url, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await axios.get(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

module.exports = {
  name: "gagstock",
  description: "Track Grow A Garden stock including cosmetics and restocks.",
  usage: "gagstock on | gagstock on Sunflower | Watering Can | gagstock off",
  category: "Tools ⚒️",

  async execute(senderId, args, pageAccessToken) {
    const action = args[0]?.toLowerCase();
    const filters = args.slice(1).join(" ").split("|").map(f => f.trim().toLowerCase()).filter(Boolean);

    if (action === "off") {
      const session = activeSessions.get(senderId);
      if (session) {
        clearTimeout(session.timeout);
        activeSessions.delete(senderId);
        lastSentCache.delete(senderId);
        return await sendMessage(senderId, { text: "🛑 Gagstock tracking stopped." }, pageAccessToken);
      } else {
        return await sendMessage(senderId, { text: "⚠️ You don't have an active gagstock session." }, pageAccessToken);
      }
    }

    if (action !== "on") {
      return await sendMessage(senderId, {
        text: "📌 Usage:\n• gagstock on\n• gagstock on Sunflower | Watering Can\n• gagstock off",
      }, pageAccessToken);
    }

    if (activeSessions.has(senderId)) {
      return await sendMessage(senderId, {
        text: "📡 You're already tracking Gagstock. Use gagstock off to stop.",
      }, pageAccessToken);
    }

    await sendMessage(senderId, { text: "✅ Gagstock tracking started! You'll be notified when stock or weather changes." }, pageAccessToken);

    async function fetchAndNotify() {
      try {
        let stockData, weather;
        try {
          const [backupRes, weatherRes] = await Promise.all([
            fetchWithTimeout("https://gagstock.gleeze.com/grow-a-garden"),
            fetchWithTimeout("https://growagardenstock.com/api/stock/weather"),
          ]);

          const backup = backupRes.data.data;
          const transform = (items) => items?.map(i => ({ name: i.name, value: Number(i.quantity) })) || [];

          stockData = {
            gearStock: transform(backup.gear.items),
            seedsStock: transform(backup.seed.items),
            eggStock: transform(backup.egg.items),
            cosmeticsStock: transform(backup.cosmetics.items),
            honeyStock: transform(backup.honey.items),
          };

          const w = weatherRes.data;
          weather = {
            currentWeather: w.currentWeather || "Unknown",
            icon: w.icon || "🌤️",
            cropBonuses: w.cropBonuses || "None",
            updatedAt: w.updatedAt || new Date().toISOString(),
          };

        } catch {
          return false;
        }

        const normalized = normalizeStockData(stockData);
        const currentStockOnly = {
          gear: normalized.gearStock,
          seeds: normalized.seedsStock,
          egg: normalized.eggStock,
          honey: normalized.honeyStock,
          cosmetics: normalized.cosmeticsStock,
        };

        const currentKey = JSON.stringify(currentStockOnly);
        const lastSent = lastSentCache.get(senderId);
        if (lastSent === currentKey) return false;
        lastSentCache.set(senderId, currentKey);

        const restocks = getNextRestocks();
        const updatedAtPH = getPHTime().toLocaleString("en-PH", {
          hour: "numeric", minute: "numeric", second: "numeric",
          hour12: true, day: "2-digit", month: "short", year: "numeric"
        });

        const formatList = (arr) => arr.map(i => `- ${addEmoji(i.name)}: ${formatValue(i.value)}`).join("\n");

        const weatherDetails =
          `🌤️ 𝗪𝗲𝗮𝘁𝗵𝗲𝗿: ${weather.icon} ${weather.currentWeather}\n🌾 Crop Bonus: ${weather.cropBonuses}\n📅 Updated at (Philippines): ${updatedAtPH}`;

        const categories = [
          { label: "🛠️ 𝗚𝗲𝗮𝗿", items: stockData.gearStock, restock: restocks.gear },
          { label: "🌱 𝗦𝗲𝗲𝗱𝘀", items: stockData.seedsStock, restock: restocks.seed },
          { label: "🥚 𝗘𝗴𝗴𝘀", items: stockData.eggStock, restock: restocks.egg },
          { label: "🎨 𝗖𝗼𝘀𝗺𝗲𝘁𝗶𝗰𝘀", items: stockData.cosmeticsStock, restock: restocks.cosmetics },
          { label: "🍯 𝗛𝗼𝗻𝗲𝘆", items: stockData.honeyStock, restock: restocks.honey },
        ];

        let filteredContent = "";
        for (const { label, items, restock } of categories) {
          const filteredItems = filters.length ? items.filter(i => filters.some(f => i.name.toLowerCase().includes(f))) : items;
          if (filteredItems.length > 0) {
            filteredContent += `${label}:\n${formatList(filteredItems)}\n⏳ Restock in: ${restock}\n\n`;
          }
        }

        if (!filteredContent.trim()) return false;

        const message = `🌾 𝗚𝗿𝗼𝘄 𝗔 𝗚𝗮𝗿𝗱𝗲𝗻 — 𝗧𝗿𝗮𝗰𝗸𝗲𝗿 BY : JAY AR\n\n${filteredContent}${weatherDetails}`;
        await sendMessage(senderId, { text: message }, pageAccessToken);
        return true;

      } catch (err) {
        console.error("❌ Error:", err.message);
        return false;
      }
    }

    async function scheduleNextFetch() {
      const now = getPHTime();
      const next = new Date(now);
      const mins = now.getMinutes();
      const nextMin = mins - (mins % 5) + 5;
      next.setMinutes(nextMin, 30, 0);
      if (next <= now) next.setMinutes(next.getMinutes() + 5);
      const timeout = next - now;

      const runAndSchedule = async () => {
        await fetchAndNotify();
        const t = setTimeout(runAndSchedule, 5 * 60 * 1000);
        activeSessions.set(senderId, { timeout: t });
      };

      const t = setTimeout(runAndSchedule, timeout);
      activeSessions.set(senderId, { timeout: t });
    }

    await fetchAndNotify();
    await scheduleNextFetch();
  }
};
