import { Client as SSHClient } from 'ssh2';

const DEFAULT_DB_PATHS = [
  '/home/pzserver/Zomboid/db/users.db',
  '/home/pzserver/Zomboid/db/pzserver.db',
];

const DEFAULT_TABLES = ['whitelist', 'users', 'user'];
const DEFAULT_USERNAME_COLUMNS = ['username', 'user', 'name', 'displayname'];
const DEFAULT_PASSWORD_COLUMNS = ['password', 'passwd', 'pass', 'pwd'];

const parseCsv = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

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

const extractJsonFromText = (rawText) => {
  const text = String(rawText ?? '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const firstCurly = text.indexOf('{');
    const lastCurly = text.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly > firstCurly) {
      const candidate = text.slice(firstCurly, lastCurly + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }

  return null;
};

const getLookupConfig = () => {
  const envPaths = parseCsv(process.env.PZ_WHITELIST_DB_PATHS);
  const singleUsersDbPath = String(process.env.PZ_USERS_DB_PATH || '').trim();
  const singleWhitelistDbPath = String(process.env.PZ_WHITELIST_DB_PATH || '').trim();

  const dbPaths = [
    ...envPaths,
    singleUsersDbPath,
    singleWhitelistDbPath,
    ...DEFAULT_DB_PATHS,
  ].filter(Boolean);

  const tables = [
    ...parseCsv(process.env.PZ_WHITELIST_DB_TABLES),
    ...DEFAULT_TABLES,
  ];

  const usernameColumns = [
    ...parseCsv(process.env.PZ_WHITELIST_DB_USERNAME_COLUMNS),
    ...DEFAULT_USERNAME_COLUMNS,
  ];

  const passwordColumns = [
    ...parseCsv(process.env.PZ_WHITELIST_DB_PASSWORD_COLUMNS),
    ...DEFAULT_PASSWORD_COLUMNS,
  ];

  return {
    dbPaths: [...new Set(dbPaths)],
    tables: [...new Set(tables.map((value) => value.toLowerCase()))],
    usernameColumns: [...new Set(usernameColumns.map((value) => value.toLowerCase()))],
    passwordColumns: [...new Set(passwordColumns.map((value) => value.toLowerCase()))],
  };
};

export const lookupWhitelistUserByUsername = async (username) => {
  const targetUsername = String(username ?? '').trim();
  if (!targetUsername) {
    return {
      found: false,
      error: 'Username is required.',
      metadata: null,
    };
  }

  const lookupConfig = getLookupConfig();
  const pythonScript = `
import json
import os
import sqlite3

target_username = ${JSON.stringify(targetUsername)}
db_paths = ${JSON.stringify(lookupConfig.dbPaths)}
candidate_tables = ${JSON.stringify(lookupConfig.tables)}
candidate_username_columns = ${JSON.stringify(lookupConfig.usernameColumns)}
candidate_password_columns = ${JSON.stringify(lookupConfig.passwordColumns)}

def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'

def serialize_value(value):
    if isinstance(value, bytes):
        return {"__type": "bytes", "length": len(value)}
    return value

result = {
    "ok": True,
    "found": False,
    "dbPath": None,
    "table": None,
    "usernameColumn": None,
    "passwordColumn": None,
    "row": None,
    "searchedPaths": db_paths,
}

try:
    for db_path in db_paths:
        if not db_path or not os.path.isfile(db_path):
            continue

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        all_tables_rows = cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        all_tables = [row[0] for row in all_tables_rows]
        lower_to_actual_table = {table.lower(): table for table in all_tables}

        ordered_tables = []
        for table_name in candidate_tables:
            if table_name in lower_to_actual_table:
                ordered_tables.append(lower_to_actual_table[table_name])
        for table_name in all_tables:
            if table_name not in ordered_tables:
                ordered_tables.append(table_name)

        for table in ordered_tables:
            table_info = cursor.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
            columns = [row[1] for row in table_info]
            if not columns:
                continue

            lower_columns = {column.lower(): column for column in columns}
            username_column = None
            password_column = None

            for candidate in candidate_username_columns:
                if candidate in lower_columns:
                    username_column = lower_columns[candidate]
                    break

            for candidate in candidate_password_columns:
                if candidate in lower_columns:
                    password_column = lower_columns[candidate]
                    break

            if not username_column or not password_column:
                continue

            query = (
                f"SELECT * FROM {quote_identifier(table)} "
                f"WHERE lower({quote_identifier(username_column)}) = lower(?) LIMIT 1"
            )
            row = cursor.execute(query, (target_username,)).fetchone()
            if row:
                result["found"] = True
                result["dbPath"] = db_path
                result["table"] = table
                result["usernameColumn"] = username_column
                result["passwordColumn"] = password_column
                result["row"] = {key: serialize_value(row[key]) for key in row.keys()}
                break

        conn.close()
        if result["found"]:
            break
except Exception as error:
    result = {
        "ok": False,
        "error": str(error),
    }

print(json.dumps(result, ensure_ascii=False))
  `.trim();

  const command = `python3 - <<'PY'\n${pythonScript}\nPY`;
  const { stdout, stderr, code } = await runSshCommandWithOutput(command);
  const parsed = extractJsonFromText(stdout);

  if (!parsed) {
    return {
      found: false,
      error: `Failed to parse whitelist DB lookup output (code=${code}). stderr=${stderr || '(none)'}`,
      metadata: null,
    };
  }

  if (!parsed.ok) {
    return {
      found: false,
      error: parsed.error || 'Unknown whitelist DB lookup error.',
      metadata: null,
    };
  }

  return {
    found: Boolean(parsed.found),
    error: null,
    row: parsed.row || null,
    metadata: {
      dbPath: parsed.dbPath || null,
      table: parsed.table || null,
      usernameColumn: parsed.usernameColumn || null,
      passwordColumn: parsed.passwordColumn || null,
      searchedPaths: Array.isArray(parsed.searchedPaths) ? parsed.searchedPaths : [],
    },
  };
};

export const verifyWhitelistCredentials = async (username, password) => {
  const lookup = await lookupWhitelistUserByUsername(username);
  if (lookup.error) {
    return {
      ok: false,
      found: false,
      passwordMatches: false,
      error: lookup.error,
      metadata: lookup.metadata,
      row: null,
    };
  }

  if (!lookup.found || !lookup.row) {
    return {
      ok: true,
      found: false,
      passwordMatches: false,
      error: null,
      metadata: lookup.metadata,
      row: null,
    };
  }

  const passwordColumn = lookup.metadata?.passwordColumn;
  const storedPassword = passwordColumn ? lookup.row?.[passwordColumn] : null;
  const passwordMatches = String(storedPassword ?? '') === String(password ?? '');

  return {
    ok: true,
    found: true,
    passwordMatches,
    error: null,
    metadata: lookup.metadata,
    row: lookup.row,
  };
};
