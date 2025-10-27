import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import tar from 'tar';
import { SftpLogReader } from '../../utils/sftpLogReader.js';
import config from '../../config/config.js';

const router = express.Router();

/**
 * POST /map/sync
 * Downloads a tar.gz produced on the game server and extracts into public/pzmap
 * Expected on server: /home/pzserver/pzmap-output.tar.gz
 */
router.post('/sync', async (req, res) => {
  const tmpDir = path.resolve(process.cwd(), 'tmp', 'pzmap');
  const outDir = path.resolve(process.cwd(), 'public', 'pzmap');

  const remoteTar = req.body.remotePath || '/home/pzserver/pzmap-output.tar.gz';

  const sftp = new SftpLogReader();

  try {
    // ensure tmp dir
    await fs.remove(tmpDir);
    await fs.mkdirp(tmpDir);

    // connect and download
    await sftp.connect();
    const stream = await sftp.sftp.get(remoteTar);

    const tarPath = path.join(tmpDir, 'pzmap-output.tar.gz');
    await fs.writeFile(tarPath, stream);

    // extract
    await fs.remove(outDir);
    await fs.mkdirp(outDir);
    await tar.x({ file: tarPath, C: outDir });

    await sftp.disconnect();

    res.json({ success: true, message: 'Map synced to server', path: '/pzmap' });
  } catch (error) {
    console.error('Map sync error:', error);
    try { await sftp.disconnect(); } catch {};
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
