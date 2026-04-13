import { Client as SSHClient } from 'ssh2';
import { Rcon } from 'rcon-client';

const normalizeSecret = (value) => String(value ?? '').replace(/^"|"$/g, '').trim();

const ANSI_ESCAPE_REGEX = /[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g;
const PLAYER_HEADER_REGEX = /^players connected\b/i;
const NO_PLAYERS_HEADER_REGEX = /^no players connected\b/i;
const SYSTEM_NOISE_REGEX = /^(send pzserver:|sending command to console:|command sent|linuxgsm|usage:|error:|warning:|info:)/i;

const buildSshConfig = () => ({
  host: process.env.OVH_SG_HOST,
  port: Number(process.env.OVH_SG_PORT_SSH || 22),
  username: process.env.OVH_SG_USERNAME,
  password: normalizeSecret(process.env.OVH_SG_PASSWORD),
});

const buildRconConfig = () => {
  const parsedTimeout = Number(process.env.GAME_PRESENCE_RCON_TIMEOUT_MS || 10000);
  return {
    host: String(process.env.RCON_HOST || '').trim(),
    port: Number(process.env.RCON_PORT || 27015),
    password: normalizeSecret(process.env.RCON_PASSWORD),
    timeout: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 10000,
  };
};

const isRconConfigured = (config) => (
  Boolean(config.host && config.password)
  && Number.isFinite(config.port)
  && config.port > 0
);

const runSshCommandWithOutput = async (command) => {
  const sshConfig = buildSshConfig();
  const conn = new SSHClient();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          stream.on('close', (code) => {
            conn.end();
            resolve({ stdout, stderr, code });
          });

          stream.on('data', (data) => {
            stdout += data.toString('utf8');
          });

          stream.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
          });
        });
      })
      .on('error', reject)
      .connect(sshConfig);
  });
};

const sanitizePlayersOutput = (value) => String(value ?? '')
  .replace(ANSI_ESCAPE_REGEX, '')
  .replace(/\r/g, '');

const extractPlayerNameFromLine = (line) => {
  const withIdMatch = line.match(/^-?\s*(.*?)\s*\(id=.*\)\s*$/i);
  if (withIdMatch && withIdMatch[1]) {
    return withIdMatch[1].trim();
  }

  const dashedNameMatch = line.match(/^-+\s*(.+)$/);
  if (dashedNameMatch && dashedNameMatch[1]) {
    return dashedNameMatch[1].trim();
  }

  if (/^[A-Za-z0-9_.-]+$/.test(line)) {
    return line.trim();
  }

  return null;
};

const isLikelyPlayerName = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 64) {
    return false;
  }
  if (PLAYER_HEADER_REGEX.test(candidate) || NO_PLAYERS_HEADER_REGEX.test(candidate)) {
    return false;
  }
  if (SYSTEM_NOISE_REGEX.test(candidate)) {
    return false;
  }
  return true;
};

const parsePlayersPayload = (playersResponse) => {
  const cleaned = sanitizePlayersOutput(playersResponse);
  const playerLines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const hasPlayersHeader = playerLines.some((line) => (
    PLAYER_HEADER_REGEX.test(line) || NO_PLAYERS_HEADER_REGEX.test(line)
  ));

  const onlinePlayers = [];
  for (const line of playerLines) {
    if (PLAYER_HEADER_REGEX.test(line) || NO_PLAYERS_HEADER_REGEX.test(line)) {
      continue;
    }
    if (SYSTEM_NOISE_REGEX.test(line)) {
      continue;
    }

    const candidate = extractPlayerNameFromLine(line);
    if (isLikelyPlayerName(candidate)) {
      onlinePlayers.push(candidate);
    }
  }

  const hasDashPlayerLine = playerLines.some((line) => /^-\s*\S+/.test(line));
  const recognized = hasPlayersHeader || (onlinePlayers.length > 0 && hasDashPlayerLine);

  return {
    players: [...new Set(onlinePlayers)],
    recognized,
    raw: cleaned,
  };
};

const runPlayersCommandViaRcon = async () => {
  const rconConfig = buildRconConfig();
  if (!isRconConfigured(rconConfig)) {
    throw new Error('RCON is not configured.');
  }

  let rconClient;
  try {
    rconClient = await Rcon.connect(rconConfig);
    const response = await rconClient.send('players');
    return String(response || '');
  } finally {
    if (rconClient) {
      await rconClient.end().catch(() => {});
    }
  }
};

const runPlayersCommandViaSsh = async () => {
  const serverDir = String(process.env.PZ_SERVER_SSH_DIR || '/home/pzserver').trim() || '/home/pzserver';
  const escapedServerDir = serverDir.replace(/'/g, `'\"'\"'`);
  const command = `cd '${escapedServerDir}' && ./pzserver send 'players'`;

  const { stdout, stderr, code } = await runSshCommandWithOutput(command);
  if (code !== 0) {
    const output = [stdout, stderr].filter(Boolean).join(' ').trim();
    throw new Error(output || `SSH players check failed with code ${code}.`);
  }

  return String(stdout || '');
};

export const parseOnlinePlayersFromResponse = (playersResponse) => parsePlayersPayload(playersResponse).players;

export const fetchOnlinePlayersViaSsh = async () => {
  let rconError = null;

  try {
    const rconRaw = await runPlayersCommandViaRcon();
    const parsed = parsePlayersPayload(rconRaw);
    if (parsed.recognized) {
      return {
        ok: true,
        error: null,
        players: parsed.players,
        raw: parsed.raw,
        source: 'rcon',
      };
    }
    rconError = 'RCON returned unexpected players output.';
  } catch (error) {
    rconError = error?.message || String(error);
  }

  try {
    const sshRaw = await runPlayersCommandViaSsh();
    const parsed = parsePlayersPayload(sshRaw);
    if (!parsed.recognized) {
      const reason = rconError
        ? `RCON failed (${rconError}); SSH fallback did not return a valid players list.`
        : 'SSH fallback did not return a valid players list.';
      return {
        ok: false,
        error: reason,
        players: [],
        raw: parsed.raw,
        source: 'ssh',
      };
    }

    return {
      ok: true,
      error: null,
      players: parsed.players,
      raw: parsed.raw,
      source: 'ssh',
    };
  } catch (error) {
    const sshError = error?.message || String(error);
    const reason = rconError
      ? `RCON failed (${rconError}); SSH fallback failed (${sshError}).`
      : `SSH players check failed (${sshError}).`;

    return {
      ok: false,
      error: reason,
      players: [],
      raw: '',
      source: 'ssh',
    };
  }
};

