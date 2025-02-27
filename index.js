// Require necessary dependencies
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Configuration
const WORDLE_CHANNEL_NAME = 'gamers-rise-up'; // Channel name without the # symbol
const WORDLE_REGEX = /Wordle\s+(\d+,?\d*)\s+([1-6X])\/(\d+)(\*?)/i;

// Database to store user scores (in-memory for simplicity)
const userScores = new Map();

// Function to parse Wordle scores from messages
function parseWordleScore(content) {
  const match = content.match(WORDLE_REGEX);
  if (match) {
    // Remove any commas from the Wordle number
    const wordleNumberStr = match[1].replace(/,/g, '');
    const wordleNumber = parseInt(wordleNumberStr);
    const score = parseInt(match[2]);
    const maxAttempts = parseInt(match[3]);
    const hardMode = match[4] === '*';

    // Check for failed attempts (X/6)
    const scoreValue = match[2].toUpperCase() === 'X' ? 7 : score;

    return {
      wordleNumber,
      score: scoreValue,
      maxAttempts,
      hardMode,
      timestamp: new Date(),
    };
  }
  return null;
}

// Function to calculate statistics for a specific time period
function calculateStats(startDate, endDate) {
  const stats = [];

  for (const [userId, scores] of userScores.entries()) {
    const filteredScores = scores.filter(score => 
      score.timestamp >= startDate && score.timestamp <= endDate
    );

    if (filteredScores.length > 0) {
      const totalScore = filteredScores.reduce((sum, score) => sum + score.score, 0);
      const averageScore = totalScore / filteredScores.length;

      // Calculate distribution of scores (1/6, 2/6, etc.)
      const distribution = {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0
      };

      filteredScores.forEach(score => {
        if (score.score >= 1 && score.score <= 6) {
          distribution[score.score]++;
        } else {
          distribution.X++;  // Failed attempts
        }
      });

      stats.push({
        userId,
        totalGames: filteredScores.length,
        averageScore: parseFloat(averageScore.toFixed(2)),
        distribution: distribution
      });
    }
  }

  // Sort by average score (lower is better)
  return stats.sort((a, b) => a.averageScore - b.averageScore);
}

// Command to get Wordle statistics
const commands = [
  new SlashCommandBuilder()
    .setName('wordlestats')
    .setDescription('Get Wordle statistics for a specific time period')
    .addStringOption(option =>
      option.setName('period')
        .setDescription('Time period for statistics')
        .setRequired(true)
        .addChoices(
          { name: 'Today', value: 'today' },
          { name: 'Last Month', value: 'month' },
          { name: 'Last 3 Months', value: 'three_months' },
          { name: 'Last 6 Months', value: 'six_months' },
          { name: 'Last Year', value: 'year' },
        )
    ),
];

// Event: Ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    // Register slash commands
    await client.application.commands.set(commands);
    console.log('Slash commands registered');

    // Fetch historical messages
    await fetchHistoricalMessages();
  } catch (error) {
    console.error('Error during setup:', error);
  }
});

// Function to fetch historical messages
async function fetchHistoricalMessages() {
  console.log('Fetching historical Wordle messages (past year)...');

  try {
    // Find the Wordle channel
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.error('Bot is not in any guild');
      return;
    }

    const channel = guild.channels.cache.find(ch => ch.name === WORDLE_CHANNEL_NAME);
    if (!channel) {
      console.error(`Channel #${WORDLE_CHANNEL_NAME} not found`);
      return;
    }

    // Calculate the date 1 year ago
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    let lastId = null;
    let messagesProcessed = 0;
    let scoresFound = 0;
    const batchSize = 100; // Discord API limit

    // Loop to fetch messages in batches
    while (true) {
      const options = { limit: batchSize };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options);

      if (messages.size === 0) break; // No more messages

      messagesProcessed += messages.size;
      lastId = messages.last().id;

      // Process messages
      for (const [_, message] of messages) {
        // Skip messages older than 1 year
        if (message.createdAt < oneYearAgo) {
          console.log(`Reached messages older than 1 year (${messagesProcessed} messages processed, ${scoresFound} Wordle scores found)`);
          return;
        }

        const score = parseWordleScore(message.content);
        if (score) {
          if (!userScores.has(message.author.id)) {
            userScores.set(message.author.id, []);
          }

          userScores.get(message.author.id).push({
            ...score,
            timestamp: message.createdAt,
          });

          scoresFound++;
        }
      }

      console.log(`Processed ${messagesProcessed} messages, found ${scoresFound} Wordle scores so far...`);

      // Wait a short time to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

      // If we got fewer messages than the batch size, we've reached the end
      if (messages.size < batchSize) break;
    }

    console.log(`Finished processing historical messages. Total: ${messagesProcessed} messages processed, ${scoresFound} Wordle scores found.`);
  } catch (error) {
    console.error('Error fetching historical messages:', error);
  }
}

// Event: Message Create
client.on('messageCreate', message => {
  // Only process messages in the Wordle channel
  if (message.channel.name !== WORDLE_CHANNEL_NAME) return;

  const score = parseWordleScore(message.content);
  if (score) {
    // Store the score
    if (!userScores.has(message.author.id)) {
      userScores.set(message.author.id, []);
    }

    userScores.get(message.author.id).push({
      ...score,
      timestamp: message.createdAt,
    });

    console.log(`Recorded Wordle score for ${message.author.tag}: ${score.score}/${score.maxAttempts}`);
  }
});

// Event: Interaction Create (for slash commands)
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'wordlestats') {
    const periodChoice = interaction.options.getString('period');
    let startDate = new Date();
    const endDate = new Date();

    // Calculate the start date based on the period
    switch (periodChoice) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'three_months':
        startDate.setMonth(startDate.getMonth() - 3);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'six_months':
        startDate.setMonth(startDate.getMonth() - 6);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }

    await interaction.deferReply();

    const stats = calculateStats(startDate, endDate);
    if (stats.length === 0) {
      await interaction.editReply("No Wordle scores found for this time period!");
      return;
    }

    // Create the stats embed
    const embed = new EmbedBuilder()
      .setTitle(`Wordle Statistics (${periodChoice})`)
      .setColor('#538d4e') // Wordle green
      .setDescription(`Statistics from <t:${Math.floor(startDate.getTime() / 1000)}:D> to <t:${Math.floor(endDate.getTime() / 1000)}:D>`)
      .setTimestamp();

    // Add medals
    const medals = ['🥇', '🥈', '🥉'];

    // Process users one by one for detailed stats
    for (let i = 0; i < Math.min(stats.length, 10); i++) {
      const stat = stats[i];
      const user = await client.users.fetch(stat.userId);

      // Assign medals based on position
      let medal = '';
      if (i === 0) medal = '🥇';
      else if (i === 1) medal = '🥈';
      else if (i === 2) medal = '🥉';
      else if (i === 3) medal = ':kekw:'; // 4th place gets kekw

      // Create distribution text
      let distributionText = '';
      for (let attempt = 1; attempt <= 6; attempt++) {
        distributionText += `${attempt}/6: ${stat.distribution[attempt]} times\n`;
      }
      distributionText += `X/6: ${stat.distribution.X} times`;

      embed.addFields(
        { 
          name: `${medal} ${user.username} (Avg: ${stat.averageScore})`, 
          value: `Games: ${stat.totalGames}\n${distributionText}` 
        }
      );
    }

    await interaction.editReply({ embeds: [embed] });
  }
});

// Login to Discord
client.login(process.env.TOKEN);
