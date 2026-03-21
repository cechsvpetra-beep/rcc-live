const fs = require("fs");
const path = require("path");
const { DATA_ROOT, writeJsonAtomic } = require("../storage/fileStore");

const BACKUP_DIR = path.join(DATA_ROOT, "backup");
const MAX_BACKUPS = 50;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function cleanupBackups() {
  try {
    ensureBackupDir();

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(name =>
        (name.startsWith("data-") || name.startsWith("pre-restore-")) &&
        name.endsWith(".json")
      )
      .sort();

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, file));
        } catch (e) {
          console.error("Mazanie starej zálohy zlyhalo:", e);
        }
      }
    }
  } catch (e) {
    console.error("Cleanup backupov zlyhal:", e);
  }
}

function createBackupFromData(data, prefix = "data") {
  try {
    ensureBackupDir();

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const backupName = `${prefix}-${timestamp}.json`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    writeJsonAtomic(backupPath, data);
    cleanupBackups();

    console.log("Backup uložený:", backupName);
  } catch (e) {
    console.error("Backup chyba:", e);
  }
}

module.exports = {
  BACKUP_DIR,
  cleanupBackups,
  createBackupFromData
};