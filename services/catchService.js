function addCatch(data, payload) {
  const teamId = Number(payload?.teamId || 0);
  const weight = Number(payload?.weight || 0);
  const photo = payload?.photo || null;

  if (!teamId || !weight) {
    return { error: "Chýba tím alebo váha" };
  }

  const team = (data.teams || []).find(t => Number(t.id) === Number(teamId));
  if (!team) {
    return { error: "Tím neexistuje" };
  }

  const newCatch = {
    id: Date.now(),
    teamId,
    weight,
    time: new Date().toISOString(),
    photo
  };

  if (!Array.isArray(data.catches)) {
    data.catches = [];
  }

  data.catches.push(newCatch);

  return { newCatch };
}

function updateCatch(data, catchId, payload) {
  const safeCatchId = Number(catchId || 0);
  const teamId = Number(payload?.teamId || 0);
  const weight = Number(payload?.weight || 0);

  if (!safeCatchId || !teamId || !weight) {
    return { error: "Chýba ID úlovku, tím alebo váha" };
  }

  const catchItem = (data.catches || []).find(c => Number(c.id) === Number(safeCatchId));
  if (!catchItem) {
    return { error: "Úlovok neexistuje" };
  }

  const team = (data.teams || []).find(t => Number(t.id) === Number(teamId));
  if (!team) {
    return { error: "Tím neexistuje" };
  }

  catchItem.teamId = teamId;
  catchItem.weight = weight;

  return { ok: true, catchItem };
}

function deleteCatch(data, catchId) {
  const safeCatchId = Number(catchId || 0);

  if (!safeCatchId) {
    return { error: "Chýba ID úlovku" };
  }

  const index = (data.catches || []).findIndex(c => Number(c.id) === Number(safeCatchId));

  if (index === -1) {
    return { error: "Úlovok neexistuje" };
  }

  const deleted = data.catches[index];
  data.catches.splice(index, 1);

  return { ok: true, deleted };
}

module.exports = {
  addCatch,
  updateCatch,
  deleteCatch
};