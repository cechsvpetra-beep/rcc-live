function getDisplayTime(catchItem) {
  const catchTime = String(catchItem?.catchTime || "").trim();
  if (catchTime) return catchTime;
  return catchItem?.time || "";
}

function getTopWeights(teamCatches, count) {
  const top = [...teamCatches]
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, count)
    .map(c => Number(c.weight || 0));

  while (top.length < count) {
    top.push(0);
  }

  return top;
}

function buildPublicState(data) {
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const catches = Array.isArray(data?.catches) ? data.catches : [];
  const meta = data?.meta || {};

  const baseRows = teams
    .filter(team => team.active)
    .map(team => {
      const teamCatches = catches.filter(c => Number(c.teamId) === Number(team.id));
      const total = teamCatches.reduce((sum, c) => sum + Number(c.weight || 0), 0);
      const biggest = teamCatches.length
        ? Math.max(...teamCatches.map(c => Number(c.weight || 0)))
        : 0;

      const top3 = getTopWeights(teamCatches, 3);
      const top3sum = top3.reduce((a, b) => a + b, 0);

      const top5 = getTopWeights(teamCatches, 5);
      const top5sum = top5.reduce((a, b) => a + b, 0);

      return {
        id: team.id,
        name: team.name,
        sector: team.sector,
        sectorCode: team.sector,
        peg: team.peg,
        photo: team.photo || null,
        total,
        count: teamCatches.length,
        biggest,
        top3,
        top3sum,
        top5,
        top5sum
      };
    });

  const lbByTotal = [...baseRows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return Number(a.id) - Number(b.id);
  });

  const lbByTop5 = [...baseRows].sort((a, b) => {
    if (b.top5sum !== a.top5sum) return b.top5sum - a.top5sum;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return Number(a.id) - Number(b.id);
  });

  const top3teams = [...baseRows].sort((a, b) => {
    if (b.top3sum !== a.top3sum) return b.top3sum - a.top3sum;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return Number(a.id) - Number(b.id);
  });

  const top5teams = [...baseRows].sort((a, b) => {
    if (b.top5sum !== a.top5sum) return b.top5sum - a.top5sum;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return Number(a.id) - Number(b.id);
  });

  const topFishCatch = catches.length
    ? catches.reduce((max, c) => Number(c.weight || 0) > Number(max.weight || 0) ? c : max)
    : null;

  const topFishTeam = topFishCatch
    ? teams.find(t => Number(t.id) === Number(topFishCatch.teamId))
    : null;

  const topFish = topFishCatch
    ? {
        id: topFishCatch.id,
        weight: Number(topFishCatch.weight || 0),
        teamId: Number(topFishCatch.teamId || 0),
        team: topFishTeam?.name || "",
        teamName: topFishTeam?.name || "",
        sector: topFishTeam?.sector || "",
        peg: topFishTeam?.peg || "",
        time: getDisplayTime(topFishCatch),
        catchTime: topFishCatch.catchTime || "",
        recordedTime: topFishCatch.time || "",
        photo: topFishCatch.photo || null
      }
    : null;

  const sortedByTimeDesc = [...catches].sort(
    (a, b) => new Date(b.time || 0) - new Date(a.time || 0)
  );

  const lastCatchRaw = sortedByTimeDesc.length ? sortedByTimeDesc[0] : null;
  const lastCatchTeam = lastCatchRaw
    ? teams.find(t => Number(t.id) === Number(lastCatchRaw.teamId))
    : null;

  const lastCatch = lastCatchRaw
    ? {
        id: lastCatchRaw.id,
        weight: Number(lastCatchRaw.weight || 0),
        teamId: Number(lastCatchRaw.teamId || 0),
        team: lastCatchTeam?.name || "",
        teamName: lastCatchTeam?.name || "",
        sector: lastCatchTeam?.sector || "",
        peg: lastCatchTeam?.peg || "",
        time: getDisplayTime(lastCatchRaw),
        catchTime: lastCatchRaw.catchTime || "",
        recordedTime: lastCatchRaw.time || "",
        photo: lastCatchRaw.photo || null
      }
    : null;

  const teamCatches = Object.fromEntries(
    teams.map(team => [
      team.id,
      catches
        .filter(c => Number(c.teamId) === Number(team.id))
        .map((c, index) => ({
          id: c.id,
          number: index + 1,
          weight: Number(c.weight || 0),
          time: getDisplayTime(c),
          catchTime: c.catchTime || "",
          recordedTime: c.time || "",
          photo: c.photo || null
        }))
    ])
  );

  return {
  eventName: meta.eventName || "RCC Live tabuľka",
  eventSub: meta.eventSub || "Ružín Carp Classic",
  leaderboardMode: meta.leaderboardMode || "TOTAL",

  lb: lbByTotal,
  lbByTotal,
  lbByTop5,

    totalWeight: lbByTotal.reduce((sum, t) => sum + Number(t.total || 0), 0),
    totalFish: catches.length,
    topFish,
    lastCatch,
    teamCatches,

    top3teams,
    top5teams
  };
}

module.exports = {
  buildPublicState
};