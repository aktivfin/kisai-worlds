import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function loadState(file, initial) {
  if (!fs.existsSync(file)) return structuredClone(initial);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    try {
      const recovered = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
      console.error(JSON.stringify({event:'state_recovered_from_backup',file,error:error.message}));
      fs.renameSync(file, file + `.corrupt.${Date.now()}`);
      atomicWrite(file, recovered);
      return recovered;
    } catch (backupError) {
      throw new Error(`state_corrupt: ${file}; primary=${error.message}; backup=${backupError.message}`);
    }
  }
}

export function atomicWrite(file, value) {
  const dir = path.dirname(file), temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const data = JSON.stringify(value, null, 2);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (fs.existsSync(file)) {
      // Preserve only a verified previous generation.
      JSON.parse(fs.readFileSync(file, 'utf8'));
      const backupTemp = temp + '.bak';
      fs.copyFileSync(file, backupTemp);
      const backupFd = fs.openSync(backupTemp, 'r');
      try { fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
      fs.renameSync(backupTemp, file + '.bak');
    }
    fs.renameSync(temp, file);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
