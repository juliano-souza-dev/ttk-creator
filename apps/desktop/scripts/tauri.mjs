import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const isDev = args[0] === "dev";

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(start = 1420, attempts = 100) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`Nenhuma porta disponível entre ${start} e ${start + attempts - 1}.`);
}

async function run() {
  let configDirectory;
  let configPath;
  let port;

  if (isDev) {
    port = await findAvailablePort();
    configDirectory = await mkdtemp(join(tmpdir(), "ttk-creator-tauri-"));
    configPath = join(configDirectory, "tauri.dev.conf.json");
    await writeFile(
      configPath,
      JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } }, null, 2),
      "utf8",
    );
    console.log(`[ttk-creator] Porta ${port} selecionada para o servidor Vite.`);
  }

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const childArgs = ["tauri", ...args];
  if (isDev) childArgs.push("--config", configPath);

  const child = spawn(command, childArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(isDev ? { TAURI_DEV_PORT: String(port) } : {}),
    },
    shell: process.platform === "win32",
  });

  const cleanup = async () => {
    if (configDirectory) {
      await rm(configDirectory, { recursive: true, force: true });
    }
  };

  child.on("error", async (error) => {
    console.error("[ttk-creator] Não foi possível iniciar o Tauri:", error);
    await cleanup();
    process.exitCode = 1;
  });

  child.on("exit", async (code, signal) => {
    await cleanup();
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

run().catch((error) => {
  console.error("[ttk-creator]", error.message);
  process.exitCode = 1;
});
