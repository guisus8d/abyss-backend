const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
} = require('discord.js');
const BetaRegistration = require('../models/BetaRegistration');

const PLAY_STORE_URL = 'https://play.google.com/apps/internaltest/4701377691744254634';

const verificarCommand = new SlashCommandBuilder()
  .setName('verificar')
  .setDescription('Verifica tu registro de beta tester de Abyss Social')
  .addStringOption(opt =>
    opt.setName('email')
      .setDescription('Email con el que te registraste en abyss.social/beta')
      .setRequired(true)
  );

async function registerCommands(applicationId) {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(applicationId, process.env.DISCORD_GUILD_ID),
    { body: [verificarCommand.toJSON()] }
  );
  console.log('[discordBot] Comando /verificar registrado en el guild');
}

async function handleVerificar(interaction) {
  if (interaction.channelId !== process.env.DISCORD_VERIFICACION_CHANNEL_ID) {
    return interaction.reply({
      content: 'Este comando solo funciona en el canal de verificación.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const email = interaction.options.getString('email', true).toLowerCase().trim();
    const registro = await BetaRegistration.findOne({ email });

    if (!registro) {
      return interaction.editReply('Este email no está registrado.\nPrimero regístrate en abyss.social/beta');
    }

    const guild = await interaction.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(interaction.user.id);
    await member.roles.add(process.env.DISCORD_BETA_ROLE_ID);

    try {
      await member.send(`Ya tienes acceso a la beta de Abyss Social.\nInstala aquí: ${PLAY_STORE_URL}`);
    } catch (dmErr) {
      console.warn(`[discordBot] No se pudo enviar DM a ${interaction.user.tag}:`, dmErr.message);
    }

    await interaction.editReply(`<@${interaction.user.id}> verificado correctamente`);
  } catch (err) {
    console.error('[discordBot] Error en /verificar:', err.message);
    await interaction.editReply('Ocurrió un error al verificar. Intenta de nuevo más tarde.');
  }
}

function startDiscordBot() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[discordBot] DISCORD_BOT_TOKEN no configurado — bot de Discord desactivado');
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async c => {
    console.log(`[discordBot] Conectado como ${c.user.tag}`);
    try {
      await registerCommands(c.user.id);
    } catch (err) {
      console.error('[discordBot] Error registrando comandos:', err.message);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'verificar') return;
    await handleVerificar(interaction);
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error('[discordBot] Error al iniciar sesión:', err.message);
  });
}

module.exports = { startDiscordBot };
