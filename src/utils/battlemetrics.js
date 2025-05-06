// import fetch from 'node-fetch';

export class BattleMetricsAPI {
  constructor(apiKey, serverId) {
    this.apiKey = apiKey;
    this.serverId = serverId;
    this.baseUrl = 'https://api.battlemetrics.com';
  }

  async getTopPlayersByPlaytime(limit = 10) {
    const headers = this.apiKey
      ? { Authorization: `Bearer ${this.apiKey}` }
      : {};

    // Use your working leaderboard URL here, or build it dynamically
    const url = `${this.baseUrl}/servers/${this.serverId}/relationships/leaderboards/time?filter[period]=2025-04-06T00:00:00.000Z:2025-05-06T00:00:00.000Z&page[size]=${limit}`;

    const res = await fetch(url, { headers });
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