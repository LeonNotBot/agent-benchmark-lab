import { logger } from "../../util/logger";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { execSync } from "child_process";
import * as os from "os";
import type { DeviceCapabilities } from "@lenovo/agent-protocol";

/** @internal 设备硬件能力探测（GPU/显存/内存/CPU），用于设备信息展示，非公共契约。 */
@Injectable()
export class DeviceCapabilityService implements OnModuleInit {
  private capabilities: DeviceCapabilities | null = null;

  async onModuleInit(): Promise<void> {
    this.capabilities = await this.detect();
    logger.log("[routing] Device capabilities:", JSON.stringify(this.capabilities, null, 2));
  }

  getCapabilities(): DeviceCapabilities {
    return this.capabilities ?? this.defaultCapabilities();
  }

  private async detect(): Promise<DeviceCapabilities> {
    const platform = os.platform();
    const ramMB = Math.round(os.totalmem() / 1024 / 1024);
    const cpuCores = os.cpus().length;
    const gpu = this.detectGpu(platform);
    return { ...gpu, ramMB, cpuCores, platform };
  }

  private detectGpu(platform: string): { gpuName: string | null; gpuVramMB: number } {
    // Try nvidia-smi first (cross-platform for NVIDIA GPUs)
    try {
      const out = execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits", {
        timeout: 5000, encoding: "utf-8", windowsHide: true,
      }).trim();
      const [name, vramStr] = out.split(",").map((s) => s.trim());
      const vram = parseInt(vramStr, 10);
      if (name && !isNaN(vram)) return { gpuName: name, gpuVramMB: vram };
    } catch {}

    // Windows fallback via PowerShell
    if (platform === "win32") {
      try {
        const cmd = 'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json"';
        const out = execSync(cmd, { timeout: 5000, encoding: "utf-8", windowsHide: true }).trim();
        const data = JSON.parse(out);
        const name = data?.Name ?? null;
        const ram = data?.AdapterRAM ? Math.round(Number(data.AdapterRAM) / 1024 / 1024) : 0;
        return { gpuName: name, gpuVramMB: ram };
      } catch {}
    }

    // macOS fallback
    if (platform === "darwin") {
      try {
        const out = execSync("system_profiler SPDisplaysDataType -json", {
          timeout: 5000, encoding: "utf-8",
        });
        const data = JSON.parse(out);
        const gpu = data?.SPDisplaysDataType?.[0];
        const name = gpu?.sppci_model ?? null;
        // Apple Silicon uses unified memory
        const vram = gpu?.spdisplays_vram_shared ? Math.round(os.totalmem() / 1024 / 1024 * 0.75) : 0;
        return { gpuName: name, gpuVramMB: vram };
      } catch {}
    }

    return { gpuName: null, gpuVramMB: 0 };
  }

  private defaultCapabilities(): DeviceCapabilities {
    return {
      gpuName: null, gpuVramMB: 0, ramMB: Math.round(os.totalmem() / 1024 / 1024),
      cpuCores: os.cpus().length, platform: os.platform(),
    };
  }
}
