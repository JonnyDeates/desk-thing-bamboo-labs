import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mqtt, { MqttClient } from "mqtt";
import { createDeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";

type PrintCommand = "pause" | "resume" | "stop";
type PrintState = "idle" | "preparing" | "printing" | "paused" | "finished" | "failed" | "unknown";

type ToServerEvent =
  | { type: "request_frame" }
  | { type: "start_feed" }
  | { type: "stop_feed" }
  | { type: "set_light"; payload: { on: boolean } }
  | { type: "set_print_state"; payload: { command: PrintCommand } };
type ToClientEvent =
  | { type: "frame"; payload: string }
  | { type: "status"; payload: { connected: boolean; message: string } }
  | { type: "light_state"; payload: { on: boolean; available: boolean } }
  | { type: "print_state"; payload: { state: PrintState; available: boolean } };

const DeskThing = createDeskThing<ToServerEvent, ToClientEvent>();

const DEFAULT_FPS = 1;

let latestFrame: string | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let currentUrl = "";
let currentFps = DEFAULT_FPS;
let settingsDebounce: ReturnType<typeof setTimeout> | null = null;
let starting = false;
let grabbing = false;
let clientActive = false;
// DeskThing.getSettings() internally delivers its response via a SETTINGS event, which
// would re-trigger our SETTINGS handler and loop forever. We hash the setting values and
// only act when the hash actually changes — the self-response matches the last hash.
let lastSettingsHash: string | null = null;

function hashSettings(payload: unknown): string {
  const s = payload as Record<string, { value?: unknown }> | undefined;
  return JSON.stringify({
    printer_ip: s?.printer_ip?.value ?? null,
    access_code: s?.access_code?.value ?? null,
    fps: s?.fps?.value ?? null,
  });
}

const WATCHDOG_MS = 45_000;

function resetWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    console.log("[bamboo] client watchdog fired — stopping loop");
    clientActive = false;
    stopLoop();
  }, WATCHDOG_MS);
}

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

function findFfmpeg(): string {
  const r = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  const p = r.stdout?.trim();
  if (p) return p;
  for (const alt of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"]) {
    if (spawnSync(alt, ["-version"], { timeout: 2000 }).status === 0) return alt;
  }
  return "ffmpeg";
}

const FFMPEG = findFfmpeg();
console.log(`[bamboo] ffmpeg: ${FFMPEG}`);

// ── Settings ──────────────────────────────────────────────────────────────────

const setupSettings = async () => {
  await DeskThing.initSettings({
    printer_ip: {
      id: "printer_ip",
      type: SETTING_TYPES.STRING,
      label: "Printer IP address",
      description: "Local IP of your Bambu Lab printer — find it under Network on the printer screen.",
      value: "",
    },
    access_code: {
      id: "access_code",
      type: SETTING_TYPES.STRING,
      label: "LAN access code",
      description: "8-character code shown under Network > LAN Mode on the printer touchscreen.",
      value: "",
    },
    fps: {
      id: "fps",
      type: SETTING_TYPES.NUMBER,
      label: "Frames per second",
      description: "Camera refresh rate. 1fps is smooth enough; higher uses more CPU.",
      value: DEFAULT_FPS,
      min: 1,
      max: 5,
    },
  });
};

const readSettings = async () => {
  const s = await DeskThing.getSettings();
  lastSettingsHash = hashSettings(s);
  const ip   = ((s?.printer_ip?.value  as string | undefined) ?? "").trim();
  const code = ((s?.access_code?.value as string | undefined) ?? "").trim();
  const fps  = Math.max(1, Math.min(5, Number(s?.fps?.value ?? DEFAULT_FPS)));
  return { ip, code, fps };
};

// ── MQTT (chamber light control) ──────────────────────────────────────────────

let mqttClient: MqttClient | null = null;
let printerSerial: string | null = null;
let lightOn = false;
let lightKnown = false;
let printState: PrintState = "unknown";
let printStateKnown = false;
let sequenceId = 0;

function sendLightState() {
  DeskThing.send({
    type: "light_state",
    payload: { on: lightOn, available: !!printerSerial && lightKnown },
  });
}

function sendPrintState() {
  DeskThing.send({
    type: "print_state",
    payload: { state: printState, available: !!printerSerial && printStateKnown },
  });
}

// Bambu's gcode_state values → our normalized states.
function mapGcodeState(raw: string): PrintState {
  switch (raw?.toUpperCase()) {
    case "IDLE": return "idle";
    case "PREPARE": return "preparing";
    case "RUNNING": return "printing";
    case "PAUSE": return "paused";
    case "FINISH": return "finished";
    case "FAILED": return "failed";
    default: return "unknown";
  }
}

function disconnectMqtt() {
  if (mqttClient) {
    try { mqttClient.end(true); } catch { /* ignore */ }
    mqttClient = null;
  }
  printerSerial = null;
  lightKnown = false;
  printStateKnown = false;
  sendLightState();
  sendPrintState();
}

function connectMqtt(ip: string, code: string) {
  disconnectMqtt();
  console.log(`[bamboo] mqtt: connecting to ${ip}:8883`);
  const c = mqtt.connect(`mqtts://${ip}:8883`, {
    username: "bblp",
    password: code,
    rejectUnauthorized: false,
    reconnectPeriod: 10_000,
    connectTimeout: 10_000,
    protocolVersion: 4,
  });

  c.on("connect", () => {
    console.log("[bamboo] mqtt: connected");
    c.subscribe("device/+/report", (err) => {
      if (err) console.warn("[bamboo] mqtt subscribe failed:", err.message);
    });
  });

  c.on("message", (topic, payload) => {
    // topic: device/{SERIAL}/report
    const m = /^device\/([^/]+)\/report$/.exec(topic);
    if (!m) return;
    const serial = m[1];
    if (!printerSerial) {
      printerSerial = serial;
      console.log(`[bamboo] mqtt: discovered serial ${serial}`);
    }
    try {
      const obj = JSON.parse(payload.toString("utf8"));
      const lights = obj?.print?.lights_report;
      if (Array.isArray(lights)) {
        const chamber = lights.find((l: { node?: string }) => l?.node === "chamber_light");
        if (chamber && typeof chamber.mode === "string") {
          lightOn = chamber.mode === "on";
          lightKnown = true;
          sendLightState();
        }
      }
      const gcodeState = obj?.print?.gcode_state;
      if (typeof gcodeState === "string") {
        const next = mapGcodeState(gcodeState);
        if (next !== printState || !printStateKnown) {
          printState = next;
          printStateKnown = true;
          sendPrintState();
        }
      }
    } catch { /* non-JSON payload, ignore */ }
  });

  c.on("error", (err) => {
    console.warn("[bamboo] mqtt error:", err.message);
  });

  c.on("close", () => {
    console.log("[bamboo] mqtt: closed");
  });

  mqttClient = c;
}

function publishPrintCommand(command: PrintCommand) {
  if (!mqttClient || !printerSerial) {
    console.warn("[bamboo] mqtt: cannot send print command — not connected or serial unknown");
    return;
  }
  const payload = JSON.stringify({
    print: {
      sequence_id: String(sequenceId++),
      command,
      param: "",
    },
  });
  const topic = `device/${printerSerial}/request`;
  mqttClient.publish(topic, payload, { qos: 0 }, (err) => {
    if (err) console.warn(`[bamboo] mqtt print ${command} failed: ${err.message}`);
    else console.log(`[bamboo] mqtt: print ${command} sent`);
  });
  // Optimistic local state update — the printer's report will correct us if wrong.
  if (command === "pause") printState = "paused";
  else if (command === "resume") printState = "printing";
  else if (command === "stop") printState = "idle";
  printStateKnown = true;
  sendPrintState();
}

function publishLight(on: boolean) {
  if (!mqttClient || !printerSerial) {
    console.warn("[bamboo] mqtt: cannot set light — not connected or serial unknown");
    return;
  }
  const payload = JSON.stringify({
    system: {
      sequence_id: String(sequenceId++),
      command: "ledctrl",
      led_node: "chamber_light",
      led_mode: on ? "on" : "off",
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 0,
      interval_time: 0,
    },
  });
  const topic = `device/${printerSerial}/request`;
  mqttClient.publish(topic, payload, { qos: 0 }, (err) => {
    if (err) console.warn(`[bamboo] mqtt publish failed: ${err.message}`);
    else console.log(`[bamboo] mqtt: light ${on ? "on" : "off"} sent`);
  });
  // Optimistic update so the UI feels snappy; the real state will arrive via report.
  lightOn = on;
  lightKnown = true;
  sendLightState();
}

// ── Frame grabber ─────────────────────────────────────────────────────────────

type GrabResult = { ok: true; data: string } | { ok: false; reason: string };

async function grabOneFrame(rtspUrl: string): Promise<GrabResult> {
  const outFile = path.join(os.tmpdir(), `bamboo-${process.pid}.jpg`);

  return new Promise((resolve) => {
    const args = [
      "-rtsp_transport", "tcp",
      "-tls_verify",     "0",
      "-timeout",        "10000000",   // 10s TCP connect timeout (µs)
      "-i",              rtspUrl,
      "-an",                            // skip audio track
      "-vframes",        "1",           // grab exactly one frame
      "-q:v",            "5",
      "-y",                             // overwrite output
      outFile,
    ];
    console.log(`[bamboo] running: ${FFMPEG} ${args.join(" ").replace(/:[^@]+@/, ":***@")}`);

    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });

    const stderrLines: string[] = [];
    child.stderr!.on("data", (c: Buffer) => {
      const txt = c.toString("utf8");
      stderrLines.push(txt);
      // Log every line so it appears in DeskThing server logs
      process.stdout.write(txt.split("\n").map(l => l ? `[bamboo] ${l}` : "").join("\n"));
    });

    const hardTimeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, reason: "Timed out after 15s — check IP and network" });
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(hardTimeout);
      const stderr = stderrLines.join("");

      // Try to read the output file regardless of exit code
      try {
        const data = fs.readFileSync(outFile);
        fs.unlinkSync(outFile);
        if (data.length > 100 && data[0] === 0xff && data[1] === 0xd8) {
          console.log(`[bamboo] got frame: ${data.length} bytes`);
          resolve({ ok: true, data: data.toString("base64") });
          return;
        }
      } catch { /* file not written */ }
      try { fs.unlinkSync(outFile); } catch { /* already gone */ }

      // Map ffmpeg exit to a useful message
      let reason = `ffmpeg exited ${code}`;
      if (stderr.includes("Connection refused"))                    reason = "Connection refused — is the printer on? Is LAN mode enabled?";
      else if (stderr.includes("No route to host"))                 reason = "No route to host — check printer IP";
      else if (stderr.includes("timed out") || stderr.includes("Timeout")) reason = "Connection timed out — check printer IP";
      else if (/401|[Uu]nauthorized/.test(stderr) && code !== 0)   reason = "Unauthorized — re-check LAN access code on the printer screen";
      else if (code === null)                                        reason = "Process killed (timeout)";

      console.warn(`[bamboo] grab failed (${code}): ${reason}`);
      resolve({ ok: false, reason });
    });

    child.on("error", (err) => {
      clearTimeout(hardTimeout);
      const reason = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? "ffmpeg not found — install it and restart DeskThing"
        : `Spawn error: ${err.message}`;
      resolve({ ok: false, reason });
    });
  });
}

// ── Grab loop ─────────────────────────────────────────────────────────────────

function stopLoop() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  grabbing = false;
}

async function runLoop() {
  if (!currentUrl || !clientActive) return;
  if (grabbing) return;
  grabbing = true;

  const result = await grabOneFrame(currentUrl);

  if (result.ok) {
    latestFrame = result.data;
    DeskThing.send({ type: "frame", payload: result.data });
  } else {
    DeskThing.send({ type: "status", payload: { connected: false, message: result.reason } });
  }

  grabbing = false;

  if (currentUrl && clientActive) {
    const delayMs = result.ok
      ? Math.floor(1000 / currentFps)   // normal cadence
      : 5000;                            // back off on error
    loopTimer = setTimeout(runLoop, delayMs);
  }
}

// ── DeskThing lifecycle ───────────────────────────────────────────────────────

const rebuild = async () => {
  stopLoop();
  latestFrame = null;

  const { ip, code, fps } = await readSettings();
  currentFps = fps;

  if (!ip || !code) {
    disconnectMqtt();
    DeskThing.send({
      type: "status",
      payload: { connected: false, message: "Set printer IP and access code in settings" },
    });
    return;
  }

  currentUrl = `rtsps://bblp:${code}@${ip}:322/streaming/live/1`;
  connectMqtt(ip, code);

  if (clientActive) {
    DeskThing.send({ type: "status", payload: { connected: false, message: "Connecting to printer…" } });
    runLoop();
  }
};

DeskThing.on(DESKTHING_EVENTS.START, async () => {
  console.log("[bamboo] starting");
  starting = true;
  await setupSettings();
  await rebuild();
  starting = false;
});

DeskThing.on(DESKTHING_EVENTS.SETTINGS, (event) => {
  if (starting) return;
  const hash = hashSettings((event as { payload?: unknown })?.payload);
  if (hash === lastSettingsHash) return;
  lastSettingsHash = hash;
  if (settingsDebounce) clearTimeout(settingsDebounce);
  settingsDebounce = setTimeout(async () => {
    settingsDebounce = null;
    console.log("[bamboo] settings changed");
    await rebuild();
  }, 500);
});

DeskThing.on(DESKTHING_EVENTS.STOP, () => {
  console.log("[bamboo] stopping");
  currentUrl = "";
  clientActive = false;
  clearWatchdog();
  stopLoop();
  disconnectMqtt();
});

DeskThing.on("start_feed", () => {
  console.log("[bamboo] client started viewing");
  clientActive = true;
  resetWatchdog();
  if (latestFrame) DeskThing.send({ type: "frame", payload: latestFrame });
  sendLightState();
  sendPrintState();
  if (!grabbing && currentUrl) runLoop();
});

DeskThing.on("stop_feed", () => {
  console.log("[bamboo] client stopped viewing");
  clientActive = false;
  clearWatchdog();
  stopLoop();
});

DeskThing.on("request_frame", () => {
  if (latestFrame) DeskThing.send({ type: "frame", payload: latestFrame });
});

DeskThing.on("set_light", (data) => {
  const on = !!data?.payload?.on;
  publishLight(on);
});

DeskThing.on("set_print_state", (data) => {
  const cmd = data?.payload?.command;
  if (cmd === "pause" || cmd === "resume" || cmd === "stop") {
    publishPrintCommand(cmd);
  }
});
