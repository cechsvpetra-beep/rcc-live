function getPayload() {
  const teamCatches = {};

  teams.forEach(team => {
    const list = catches
      .filter(c => c.teamId === team.id)
      .map(c => ({
        number: c.number,
        weight: c.weight,
        photo: c.photo || null,
        time: c.time
      }));

    teamCatches[team.id] = list;
  });

  return {
    lb: leaderboard(),
    topFish: topFish(),
    recent: recentCatches(),
    teams: teams,
    sectorRankings: sectorRankings(),
    activeSectors: getActiveSectors(),
    teamCatches: teamCatches
  };
}