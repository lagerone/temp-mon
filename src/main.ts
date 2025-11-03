import { execSync } from 'child_process';
import fs from 'fs';
import si from 'systeminformation';
import { logger } from './logger/logger';

/**
 * Try to get the CPU temperature from systeminformation first. If the "main" value
 * is undefined, fall back to reading thermal zones directly from /sys/class/thermal.
 */
async function getCpuTemperature(): Promise<number | null> {
  try {
    const cpu = await si.cpuTemperature();
    if (typeof cpu.main === 'number' && !Number.isNaN(cpu.main)) {
      return cpu.main;
    }
  } catch (err) {
    logger.warn(
      'systeminformation cpuTemperature() failed, attempting fallback',
      { err }
    );
  }

  // Fallback: iterate thermal zones
  try {
    const basePath = '/sys/class/thermal';
    if (!fs.existsSync(basePath)) return null;
    const zones = fs
      .readdirSync(basePath)
      .filter((d) => d.startsWith('thermal_zone'));
    let best: number | null = null;
    for (const zone of zones) {
      const typePath = `${basePath}/${zone}/type`;
      const tempPath = `${basePath}/${zone}/temp`;
      if (!fs.existsSync(typePath) || !fs.existsSync(tempPath)) continue;
      let type: string;
      try {
        type = fs.readFileSync(typePath, 'utf8').trim();
      } catch {
        continue;
      }
      // Heuristics: prefer x86_pkg_temp, cpu-thermal, soc-thermal, or similar
      if (/cpu|x86_pkg|soc/i.test(type)) {
        try {
          const raw = fs.readFileSync(tempPath, 'utf8').trim();
          const milli = parseInt(raw, 10);
          if (!Number.isNaN(milli)) {
            const c = milli / 1000;
            if (best === null || c > best) {
              best = c; // choose max among matching zones
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return best;
  } catch (err) {
    logger.warn('CPU thermal zone fallback failed', { err });
  }
  return null;
}

interface GpuTempInfo {
  model: string;
  temperatureGpu: number | null;
  temperatureMemory?: number | null;
  source: string; // systeminformation | nvidia-smi | unknown
}

/**
 * Collect GPU temperatures. Use systeminformation first; if undefined, attempt vendor-specific CLI (nvidia-smi).
 */
async function getGpuTemperatures(): Promise<GpuTempInfo[]> {
  const result: GpuTempInfo[] = [];
  try {
    const graphics = await si.graphics();
    for (const c of graphics.controllers) {
      let temp: number | null =
        typeof c.temperatureGpu === 'number' && !Number.isNaN(c.temperatureGpu)
          ? c.temperatureGpu
          : null;
      let memTemp: number | null =
        typeof c.temperatureMemory === 'number' &&
        !Number.isNaN(c.temperatureMemory)
          ? c.temperatureMemory
          : null;
      let source = 'systeminformation';
      // Attempt nvidia-smi if NVIDIA and temp missing
      if (temp === null && /nvidia/i.test(c.vendor + ' ' + c.model)) {
        try {
          // Query just the temperature number (no header, no units)
          const out = execSync(
            'nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits',
            {
              stdio: ['ignore', 'pipe', 'ignore'],
            }
          )
            .toString()
            .trim();
          const firstLineParts: string[] = out.split(/\s*\n\s*/);
          const first: string =
            firstLineParts.length > 0 && firstLineParts[0]
              ? firstLineParts[0]
              : '';
          const parsed = parseInt(first as string, 10);
          if (!Number.isNaN(parsed)) {
            temp = parsed;
            source = 'nvidia-smi';
          }
        } catch (err) {
          logger.debug('nvidia-smi fallback failed', { err });
        }
      }
      result.push({
        model: c.model || c.vendor || 'Unknown GPU',
        temperatureGpu: temp,
        temperatureMemory: memTemp ?? null,
        source,
      });
    }
  } catch (err) {
    logger.warn('systeminformation graphics() failed', { err });
  }
  return result;
}

async function logSysTemperatures() {
  const cpuTemp = await getCpuTemperature();
  if (cpuTemp === null) {
    logger.info('CPU temperature unavailable');
  } else {
    logger.info(`CPU temperature: ${cpuTemp.toFixed(1)} °C`);
  }

  const gpuTemps = await getGpuTemperatures();
  if (gpuTemps.length === 0) {
    logger.info('No GPU controllers found');
  } else {
    for (const gpu of gpuTemps) {
      const base = `GPU ${gpu.model}`;
      if (gpu.temperatureGpu === null) {
        logger.info(`${base} temperature unavailable (source=${gpu.source})`);
      } else {
        logger.info(
          `${base} temperature: ${gpu.temperatureGpu} °C (source=${gpu.source})`
        );
      }
      if (gpu.temperatureMemory !== null) {
        logger.info(`${base} memory temperature: ${gpu.temperatureMemory} °C`);
      }
    }
  }
}

async function main() {
  const intervalMs = 30_000;

  while (true) {
    const started = Date.now();
    try {
      await logSysTemperatures();
    } catch (err) {
      logger.error('Job failed', err);
    }
    const elapsed = Date.now() - started;
    const remaining = intervalMs - elapsed;
    if (remaining > 0) {
      await new Promise((res) => setTimeout(res, remaining));
    }
  }
}

main().catch((err) => {
  logger.error('Fatal', err);
  process.exit(1);
});
