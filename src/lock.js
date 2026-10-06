import fs from 'node:fs';
import path from 'node:path';
export function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'server.lock');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
      return () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid data/server.lock. Close all app instances before removing it.');
      try { process.kill(pid, 0); throw Error('Another paper-trading server is using this wallet. Close it first.'); }
      catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
      if (fs.readFileSync(file, 'utf8') === String(pid)) fs.unlinkSync(file);
    }
  }
  throw Error('Cannot acquire wallet lock.');
}
