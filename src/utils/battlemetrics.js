import config from '../config/config.js';

export class BattleMetricsAPI {
  constructor(apiKey = config.battlemetrics.apiKey, serverId = config.battlemetrics.serverId) {
    this.apiKey = apiKey;
    this.serverId = serverId;
    this.baseUrl = 'https://api.battlemetrics.com';
  }

  async getTopPlayersByPlaytime(limit = 10) {
    // Build the URL with the access_token from config/env
    const url = `${this.baseUrl}/servers/${this.serverId}/relationships/leaderboards/time?version=%5E0.1.0&filter%5Bperiod%5D=2025-04-07T00%3A00%3A00.000Z%3A2025-05-07T00%3A00%3A00.000Z&access_token=${this.apiKey}&page[size]=${limit}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`BattleMetrics API error: ${res.statusText}`);
    const data = await res.json();

    // Handle the leaderboard response
    const players = data.data.map(entry => ({
      name: entry.attributes.name,
      time: entry.attributes.value,
      rank: entry.attributes.rank
    }));

    return players;
  }
}