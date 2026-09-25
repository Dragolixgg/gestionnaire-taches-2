const os = require('node:os');
const { execFile } = require('node:child_process');

let previousCpu = null;
let previousNetwork = null;

function cpuSnapshot() {
  const cpus = os.cpus();
  const totals = cpus.map(({ times }) => {
    const idle = times.idle;
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return { idle, total };
  });
  const total = totals.reduce((sum, item) => sum + item.total, 0);
  const idle = totals.reduce((sum, item) => sum + item.idle, 0);
  let usage = null;

  if (previousCpu) {
    const totalDelta = total - previousCpu.total;
    const idleDelta = idle - previousCpu.idle;
    usage = totalDelta > 0 ? Number(((1 - idleDelta / totalDelta) * 100).toFixed(1)) : null;
  }
  previousCpu = { total, idle };

  return {
    usage,
    model: cpus[0]?.model || null,
    cores: cpus.length,
    threads: cpus.length,
    speedMHz: cpus[0]?.speed || null
  };
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try { resolve(JSON.parse(stdout.trim() || '[]')); } catch { reject(new Error('Invalid PowerShell response')); }
    });
  });
}

async function disks() {
  const script = `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress`;
  try {
    const value = await runPowerShell(script);
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list.map(d => ({
      name: d.DeviceID || null,
      label: d.VolumeName || null,
      totalBytes: Number(d.Size) || null,
      freeBytes: Number(d.FreeSpace) || null,
      usedBytes: Number(d.Size) && Number(d.FreeSpace) >= 0 ? Number(d.Size) - Number(d.FreeSpace) : null,
      readBytesPerSec: null,
      writeBytesPerSec: null
    }));
  } catch { return []; }
}

async function network() {
  const script = `Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { $s=Get-NetAdapterStatistics -Name $_.Name; [PSCustomObject]@{name=$_.Name; interfaceDescription=$_.InterfaceDescription; linkSpeed=$_.LinkSpeed; receivedBytes=$s.ReceivedBytes; sentBytes=$s.SentBytes} } | ConvertTo-Json -Compress`;
  try {
    const value = await runPowerShell(script);
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const now = Date.now();
    const current = list.map(n => ({ name: n.name, interfaceDescription: n.interfaceDescription, linkSpeed: n.linkSpeed || null, receivedBytes: Number(n.receivedBytes) || 0, sentBytes: Number(n.sentBytes) || 0 }));
    const elapsed = previousNetwork ? Math.max(1, (now - previousNetwork.time) / 1000) : null;
    const result = current.map(n => {
      const old = previousNetwork?.items.find(item => item.name === n.name);
      return { ...n, isActive: true, receivedBytesPerSec: old && elapsed ? Math.max(0, (n.receivedBytes - old.receivedBytes) / elapsed) : null, sentBytesPerSec: old && elapsed ? Math.max(0, (n.sentBytes - old.sentBytes) / elapsed) : null };
    });
    previousNetwork = { time: now, items: current };
    return result;
  } catch { return []; }
}

async function getSystemSnapshot() {
  const [diskData, networkData] = await Promise.all([disks(), network()]);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const cpu = cpuSnapshot();
  return {
    timestamp: new Date().toISOString(),
    system: { hostname: os.hostname(), platform: process.platform, release: os.release(), arch: os.arch(), uptimeSeconds: os.uptime() },
    cpu,
    memory: { totalBytes: totalMemory, freeBytes: freeMemory, usedBytes: totalMemory - freeMemory, usagePercent: Number(((1 - freeMemory / totalMemory) * 100).toFixed(1)) },
    disks: diskData,
    network: networkData,
    unavailable: ['gpu', 'temperatures', 'fans', 'diskThroughput']
  };
}

module.exports = { getSystemSnapshot };
