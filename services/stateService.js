function getDisplayTime(catchItem) {
  const catchTime = String(catchItem?.catchTime || "").trim();
  if (catchTime) {
    return catchTime;
  }
  return catchItem?.time || "";
}

function buildPublicState(data) {
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const catches = Array.isArray(data?.catches) ? data.catches : [];
  const meta = data?.meta || {};

  const lb = teams
    .filter(team => team.active)
    .map(team => {
      const teamCatches = catches.filter(c => Number(c.teamId) === Number(team.id));

      const total = teamCatches.reduce((sum, c) => sum + Number(c.weight || 0), 0);

      const biggest = teamCatches.length
        ? Math.max(...teamCatches.map(c => Number(c.weight || 0)))
        : 0;

      const sortedTop = [...teamCatches]
        .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
        .slice(0, 3)
        .map(c => Number(c.weight || 0));

      while (sortedTop.length < 3) {
        sortedTop.push(0);
      }

      const top3sum = sortedTop.reduce((a, b) => a + b, 0);

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
        top3: sortedTop,
        top3sum
      };
    });

  lb.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return a.id - b.id;
  });

  const top3teams = [...lb].sort((a, b) => {
    if (b.top3sum !== a.top3sum) return b.top3sum - a.top3sum;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return a.id - b.id;
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
    lb,
    totalWeight: lb.reduce((sum, t) => sum + Number(t.total || 0), 0),
    totalFish: catches.length,
    topFish,
    lastCatch,
    teamCatches,
    top3teams
  };
}

module.exports = {
  buildPublicState
};