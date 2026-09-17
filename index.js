const {
  Client,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js");
const {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const token = process.env.DISCORD_TOKEN;
const prefix = "!";
const voiceConnections = new Map();

if (!token) {
  console.error("Missing DISCORD_TOKEN. Add it to Replit Secrets before starting the bot.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function scheduleReconnect(guild, connection) {
  if (connection.reconnectTimer) {
    return;
  }

  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = undefined;

    if (connection.state.status === VoiceConnectionStatus.Destroyed) {
      voiceConnections.delete(guild.id);
      return;
    }

    try {
      const rejoined = connection.rejoin();
      if (!rejoined) {
        scheduleReconnect(guild, connection);
      }
    } catch (error) {
      console.error(`Could not rejoin ${guild.name}:`, error);
      scheduleReconnect(guild, connection);
    }
  }, 5_000);
}

function trackConnection(guild, connection) {
  connection.on(VoiceConnectionStatus.Ready, () => {
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
    }
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.warn(`Voice connection disconnected in ${guild.name}; retrying...`);
    scheduleReconnect(guild, connection);
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (voiceConnections.get(guild.id) === connection) {
      voiceConnections.delete(guild.id);
    }
  });
}

async function connectToVoiceChannel(channel) {
  const existingConnection = voiceConnections.get(channel.guild.id);

  if (existingConnection) {
    const currentChannelId = existingConnection.joinConfig.channelId;
    if (currentChannelId === channel.id) {
      return existingConnection;
    }

    existingConnection.destroy();
    voiceConnections.delete(channel.guild.id);
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  voiceConnections.set(channel.guild.id, connection);
  trackConnection(channel.guild, connection);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    return connection;
  } catch (error) {
    connection.destroy();
    voiceConnections.delete(channel.guild.id);
    throw error;
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log("Type !join in a voice channel to connect the bot.");
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(prefix)) {
    return;
  }

  const [command] = message.content.slice(prefix.length).trim().toLowerCase().split(/\s+/);

  if (command !== "join") {
    return;
  }

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply("Join a voice channel first, then type `!join`.");
    return;
  }

  const permissions = voiceChannel.permissionsFor(message.guild.members.me);
  if (
    !permissions?.has(PermissionsBitField.Flags.Connect) ||
    !permissions.has(PermissionsBitField.Flags.Speak)
  ) {
    await message.reply(
      "I need the **Connect** and **Speak** permissions in that voice channel.",
    );
    return;
  }

  try {
    await connectToVoiceChannel(voiceChannel);
    await message.reply(`Joined **${voiceChannel.name}**. I’ll stay connected until you restart the bot or move me.`);
  } catch (error) {
    console.error(`Could not join ${voiceChannel.name}:`, error);
    await message.reply("I couldn’t join that voice channel. Check my permissions and try again.");
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("SIGINT", () => {
  for (const connection of voiceConnections.values()) {
    connection.destroy();
  }
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  for (const connection of voiceConnections.values()) {
    connection.destroy();
  }
  client.destroy();
  process.exit(0);
});

client.login(token);
