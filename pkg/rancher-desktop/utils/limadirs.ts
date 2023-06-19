import fs from 'fs';
import os from 'os';
import path from 'path';

import Logging from '@pkg/utils/logging';

const console = Logging.limadirs;

/**
 * Current locations for lima (LIMA_HOME):
 * mac: ~/Library/Application Support/rancher-desktop/lima
 * linux: ~/.local/share/rancher-desktop/lima
 *
 * Problem: because $LIMA_HOME/0 contains a socket, if the path is too long the socket isn't usable.
 * Solution: if LIMA_HOME doesn't exist, store the socket info in ~/.rdlima and make LIMA_HOME a symlink to it.
 *
 * If LIMA_HOME is currently a symlink, leave it alone.
 * Otherwise determine if the LIMA_HOME/0/socket path will be too long, and set it up as a symlink to the alt dir.
 *
 * @param appDataLimaPath
 */
export function setupAltLima(appDataLimaPath: string) {
  const stat = fs.lstatSync(appDataLimaPath, { throwIfNoEntry: false });

  if (stat?.isSymbolicLink()) {
    // Use current LIMA_HOME symlink
    return;
  }
  const limaFullPath = path.join(appDataLimaPath, '0', 'ssh.sock.1234567890123456');

  if (!socketPathTooLong(limaFullPath)) {
    // Use the legacy path
    return;
  }
  const altDir = path.join(os.homedir(), '.rdlima');
  const altPath = path.join(altDir, '0', 'ssh.sock.1234567890123456');

  if (socketPathTooLong(altPath)) {
    console.log(`Alternative lima path ${ altPath } is too long. Try running on a system with a shorter username.`);

    return;
  }
  try {
    fs.accessSync(altDir, fs.constants.F_OK);
    console.log(`Directory ${ altDir } exists and ${ appDataLimaPath } isn't a symlink to it. Needs to be fixed`);

    return;
  } catch {
  }
  try {
    fs.accessSync(appDataLimaPath, fs.constants.F_OK);
    fs.renameSync(appDataLimaPath, altDir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      fs.mkdirSync(altDir, { recursive: true });
    } else {
      // There will be another error code; let it happen and deal with it later.
      console.log(`Error checking existence of ${ appDataLimaPath }: ${ err }`);

      return;
    }
  }
  try {
    // Make the link from the thing that exists (the "target" in the docs)
    // to the thing that we want to be a pointer (the "path" in the docs)
    fs.symlinkSync(altDir, appDataLimaPath);
  } catch (err: any) {
    console.log(`Creating symlink failed: ${ err }`);
  }
}

export function socketPathTooLong(proposedPath: string): boolean {
  return proposedPath.length > maxSocketSize();
}

export function maxSocketSize(): number {
  const maxSizes = { darwin: 104, linux: 106 };

  return maxSizes[os.platform() as 'darwin'|'linux'];
}
