const { sendMessage } = require("../handles/sendMessage");
const axios = require("axios");

const activeSessions = new Map();
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

module.exports = {
  name: "gagstock",
  description: "Track Grow A Garden stock including cosmetics and restocks.",
  usage: "gagstock on | gagstock off",
  category: "Tools ⚒️",

  async execute(senderId, args, pageAccessToken) {
    const action = args[0]?.toLowerCase();

    if (action === "off") {
      const session = activeSessions.get(senderId);
      if (session) {
        clearInterval(session.interval);
        activeSessions.delete(senderId);
        return await sendMessage(senderId, {
          text: "🛑 Gagstock tracking stopped."
        }, pageAccessToken);
      } else {
        return await sendMessage(senderId, {
          text: "⚠️ You don't have an active gagstock session."
        }, pageAccessToken);
      }
    }

    if (action !== "on") {
      return await sendMessage(senderId, {
        text: "📌 Usage:\n• `gagstock on` to start tracking\n• `gagstock off` to stop tracking"
      }, pageAccessToken);
    }

    if (activeSessions.has(senderId)) {
      return await sendMessage(senderId, {
        text: "📡 You're already tracking Gagstock. Use `gagstock off` to stop."
      }, pageAccessToken);
    }

    await sendMessage(senderId, {
      text: "✅ Gagstock tracking started! You'll be notified when stock or weather changes."
    }, pageAccessToken);

    const sessionData = {
      interval: null,
      lastCombinedKey: null,
      lastMessage: ""
    };

    async function fetchAll() {
      try {
        const [allStockRes, weatherRes] = await Promise.all([
          axios.get("http://65.108.103.151:22377/api/stocks?type=all"),
          axios.get("https://growagardenstock.com/api/stock/weather")
        ]);

        const stockData = allStockRes.data;
        const weather = weatherRes.data;

        const combinedKey = JSON.stringify({
          gearStock: stockData.gearStock,
          seedsStock: stockData.seedsStock,
          eggStock: stockData.eggStock,
          honeyStock: stockData.honeyStock,
          cosmeticsStock: stockData.cosmeticsStock,
          weatherUpdatedAt: weather.updatedAt,
          weatherCurrent: weather.currentWeather,
        });

        if (combinedKey === sessionData.lastCombinedKey) return;
        sessionData.lastCombinedKey = combinedKey;

        const restocks = getNextRestocks();

        const formatList = (arr) => (arr?.length
          ? arr.map(i =>
              `- ${i.emoji ? i.emoji + " " : ""}${i.name}: ${formatValue(i.value)}`
            ).join("\n")
          : "None."
        );

        const gearList = formatList(stockData.gearStock);
        const seedList = formatList(stockData.seedsStock);
        const eggList = formatList(stockData.eggStock);
        const cosmeticsList = formatList(stockData.cosmeticsStock);
        const honeyList = formatList(stockData.honeyStock);

        const weatherDetails =
          `🌤️ 𝗪𝗲𝗮𝘁𝗵𝗲𝗿: ${weather.icon || "🌦️"} ${weather.currentWeather}\n` +
          `📖 Description: ${weather.description}\n` +
          `📌 Effect: ${weather.effectDescription}\n` +
          `🪄 Crop Bonus: ${weather.cropBonuses}\n` +
          `📢 Visual Cue: ${weather.visualCue}\n` +
          `🌟 Rarity: ${weather.rarity}`;

        const message =
          `🌾 𝗚𝗿𝗼𝘄 𝗔 𝗚𝗮𝗿𝗱𝗲𝗻 — 𝗧𝗿𝗮𝗰𝗸𝗲𝗿\n\n` +
          `🛠️ 𝗚𝗲𝗮𝗿:\n${gearList}\n⏳ Restock in: ${restocks.gear}\n\n` +
          `🌱 𝗦𝗲𝗲𝗱𝘀:\n${seedList}\n⏳ Restock in: ${restocks.seed}\n\n` +
          `🥚 𝗘𝗴𝗴𝘀:\n${eggList}\n⏳ Restock in: ${restocks.egg}\n\n` +
          `🎨 𝗖𝗼𝘀𝗺𝗲𝘁𝗶𝗰𝘀:\n${cosmeticsList}\n⏳ Restock in: ${restocks.cosmetics}\n\n` +
          `🍯 𝗛𝗼𝗻𝗲𝘆:\n${honeyList}\n⏳ Restock in: ${restocks.honey}\n\n` +
          weatherDetails;

        if (message !== sessionData.lastMessage) {
          sessionData.lastMessage = message;
          await sendMessage(senderId, { text: message }, pageAccessToken);
        }

      } catch (err) {
        console.error(`❌ Gagstock error for ${senderId}:`, err.message);
      }
    }

    sessionData.interval = setInterval(fetchAll, 10 * 1000);
    activeSessions.set(senderId, sessionData);
    await fetchAll();
  }
};
