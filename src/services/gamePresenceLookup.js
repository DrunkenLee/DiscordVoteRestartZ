import { Client as SSHClient } from 'ssh2';

const normalizeSshPassword = (value) => String(value ?? '').replace(/^"|"$/g, '');

const buildSshConfig = () => ({
  host: process.env.OVH_SG_HOST,
  port: Number(process.env.OVH_SG_PORT_SSH || 22),
  username: process.env.OVH_SG_USERNAME,
  password: normalizeSshPassword(process.env.OVH_SG_PASSWORD),
});

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

export const parseOnlinePlayersFromResponse = (playersResponse) => {
  if (!playersResponse || typeof playersResponse !== 'string') {
    return [];
  }

  const playerLines = playersResponse
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const onlinePlayers = [];
  for (const line of playerLines) {
    if (/^players connected/i.test(line) || /^no players connected/i.test(line)) {
      continue;
    }

    const withIdMatch = line.match(/^-?(.*?)\s*\(id=.*\)$/i);
    if (withIdMatch && withIdMatch[1]) {
      onlinePlayers.push(withIdMatch[1].trim());
      continue;
    }

    const fallbackMatch = line.match(/^-?([^\s(]+)/);
    if (fallbackMatch && fallbackMatch[1]) {
      onlinePlayers.push(fallbackMatch[1].trim());
    }
  }

  return [...new Set(onlinePlayers.filter(Boolean))];
};

export const fetchOnlinePlayersViaSsh = async () => {
  const serverDir = String(process.env.PZ_SERVER_SSH_DIR || '/home/pzserver').trim() || '/home/pzserver';
  const command = `cd ${serverDir} && ./pzserver send 'players'`;

  const { stdout, stderr, code } = await runSshCommandWithOutput(command);
  if (code !== 0) {
    const output = [stdout, stderr].filter(Boolean).join(' ').trim();
    return {
      ok: false,
      error: output || `SSH players check failed with code ${code}.`,
      players: [],
      raw: stdout || '',
    };
  }

  const players = parseOnlinePlayersFromResponse(stdout || '');
  return {
    ok: true,
    error: null,
    players,
    raw: stdout || '',
  };
};

