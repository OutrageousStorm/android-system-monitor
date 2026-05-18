import { exec } from 'child_process';
import { promisify } from 'util';
import WebSocket from 'ws';
import express from 'express';

const execAsync = promisify(exec);
const app = express();
const wss = new WebSocket.Server({ noServer: true });

interface DeviceMetrics {
  timestamp: number;
  cpu: { user: number; system: number; idle: number };
  memory: { total: number; available: number; used: number };
  thermal: { zone0: number; zone1: number };
  battery: { level: number; temp: number; health: string };
  throttling: boolean;
}

async function getMetrics(): Promise<DeviceMetrics> {
  try {
    // CPU
    const cpuInfo = await execAsync('adb shell cat /proc/stat | head -2');
    const cpuLine = cpuInfo.stdout.split('\n')[0].split(/\s+/);
    const cpu = {
      user: parseInt(cpuLine[1]),
      system: parseInt(cpuLine[3]),
      idle: parseInt(cpuLine[4])
    };

    // Memory
    const memInfo = await execAsync('adb shell cat /proc/meminfo | head -3');
    const memLines = memInfo.stdout.split('\n');
    const total = parseInt(memLines[0].match(/\d+/)?.[0] || '0');
    const available = parseInt(memLines[2].match(/\d+/)?.[0] || '0');
    const memory = { total, available, used: total - available };

    // Thermal
    const thermal0 = await execAsync('adb shell cat /sys/class/thermal/thermal_zone0/temp');
    const thermal1 = await execAsync('adb shell cat /sys/class/thermal/thermal_zone1/temp 2>/dev/null || echo 0');
    const thermal = {
      zone0: parseInt(thermal0.stdout) / 1000,
      zone1: parseInt(thermal1.stdout) / 1000
    };

    // Battery
    const battery = await execAsync('adb shell dumpsys battery');
    const batteryLevel = parseInt(battery.stdout.match(/level: (\d+)/)?.[1] || '0');
    const batteryTemp = parseInt(battery.stdout.match(/temperature: (\d+)/)?.[1] || '0');
    const batteryHealth = battery.stdout.match(/health: (\w+)/)?.[1] || 'unknown';

    // Throttling
    const throttleInfo = await execAsync('adb shell dumpsys sensorservice | grep -i throttle');
    const throttling = throttleInfo.stdout.length > 0;

    return {
      timestamp: Date.now(),
      cpu,
      memory,
      thermal,
      battery: { level: batteryLevel, temp: batteryTemp, health: batteryHealth },
      throttling
    };
  } catch (e) {
    throw new Error(`Failed to get metrics: ${e}`);
  }
}

wss.on('connection', async (ws: WebSocket) => {
  console.log('Client connected');
  const interval = setInterval(async () => {
    try {
      const metrics = await getMetrics();
      ws.send(JSON.stringify(metrics));
    } catch (e) {
      ws.send(JSON.stringify({ error: String(e) }));
    }
  }, 2000);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('Client disconnected');
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Android System Monitor</title>
      <style>
        body { font-family: monospace; background: #1a1a1a; color: #0f0; padding: 20px; }
        .metric { margin: 10px 0; font-size: 14px; }
        .bar { display: inline-block; width: 200px; height: 20px; background: #333; margin: 5px 0; }
        .fill { height: 100%; background: #0f0; }
      </style>
    </head>
    <body>
      <h1>📊 Android System Monitor</h1>
      <div id="metrics"></div>
      <script>
        const ws = new WebSocket(\`ws://\${window.location.host}\`);
        ws.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.error) {
            document.getElementById('metrics').innerHTML = \`<p style="color:red">\${data.error}</p>\`;
            return;
          }
          const memUsage = (data.memory.used / data.memory.total * 100).toFixed(1);
          const batHtml = data.battery.health === 'Good' ? '✓' : '✗';
          document.getElementById('metrics').innerHTML = \`
            <div class="metric">⏰ \${new Date(data.timestamp).toLocaleTimeString()}</div>
            <div class="metric">🌡️  CPU: User \${data.cpu.user} Sys \${data.cpu.system}</div>
            <div class="metric">💾 RAM: \${(data.memory.available/1024).toFixed(0)}MB free / \${(data.memory.total/1024).toFixed(0)}MB
              <div class="bar"><div class="fill" style="width: \${memUsage}%"></div></div>
              \${memUsage}%
            </div>
            <div class="metric">🔥 Thermal Zone 0: \${data.thermal.zone0.toFixed(1)}°C</div>
            <div class="metric">🔋 Battery: \${data.battery.level}% @ \${data.battery.temp}°C \${batHtml}</div>
            <div class="metric">⚡ Throttling: \${data.throttling ? '🔴 YES' : '🟢 NO'}</div>
          \`;
        };
      </script>
    </body>
    </html>
  `);
});

const server = app.listen(3000, () => {
  console.log('📊 Monitor running on http://localhost:3000');
  console.log('WebSocket: ws://localhost:3000');
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
