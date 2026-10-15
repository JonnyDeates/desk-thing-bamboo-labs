import React, { useEffect, useRef, useState } from "react";
import { createDeskThing } from "@deskthing/client";

type PrintCommand = "pause" | "resume" | "stop";
type PrintState = "idle" | "preparing" | "printing" | "paused" | "finished" | "failed" | "unknown";

type ToClientEvent =
  | { type: "frame"; payload: string }
  | { type: "status"; payload: { connected: boolean; message: string } }
  | { type: "light_state"; payload: { on: boolean; available: boolean } }
  | { type: "print_state"; payload: { state: PrintState; available: boolean } };
type ToServerEvent =
  | { type: "request_frame" }
  | { type: "start_feed" }
  | { type: "stop_feed" }
  | { type: "set_light"; payload: { on: boolean } }
  | { type: "set_print_state"; payload: { command: PrintCommand } };

const DeskThing = createDeskThing<ToClientEvent, ToServerEvent>();

const STOP_CONFIRM_MS = 2500;

const App: React.FC = () => {
    const [frame, setFrame] = useState<string | null>(null);
    const [status, setStatus] = useState<{ connected: boolean; message: string }>({
        connected: false,
        message: "Connecting…",
    });
    const [light, setLight] = useState<{ on: boolean; available: boolean }>({
        on: false,
        available: false,
    });
    const [print, setPrint] = useState<{ state: PrintState; available: boolean }>({
        state: "unknown",
        available: false,
    });
    const [confirmStop, setConfirmStop] = useState(false);
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const offFrame = DeskThing.on("frame", (data) => {
            if (typeof data?.payload === "string" && data.payload.length > 0) {
                setFrame(data.payload);
                setStatus({ connected: true, message: "" });
            }
        });
        const offStatus = DeskThing.on("status", (data) => {
            if (data?.payload) setStatus(data.payload);
        });
        const offLight = DeskThing.on("light_state", (data) => {
            if (data?.payload) setLight(data.payload);
        });
        const offPrint = DeskThing.on("print_state", (data) => {
            if (data?.payload) setPrint(data.payload);
        });

        DeskThing.send({ type: "start_feed" });
        const keepalive = setInterval(() => DeskThing.send({ type: "start_feed" }), 20_000);

        return () => {
            offFrame?.();
            offStatus?.();
            offLight?.();
            offPrint?.();
            clearInterval(keepalive);
            DeskThing.send({ type: "stop_feed" });
        };
    }, []);

    const toggleLight = () => {
        if (!light.available) return;
        DeskThing.send({ type: "set_light", payload: { on: !light.on } });
    };

    const sendPrintCommand = (command: PrintCommand) => {
        DeskThing.send({ type: "set_print_state", payload: { command } });
    };

    // Pause/Resume is the same button, toggled by current state
    const canPauseResume = print.available && (print.state === "printing" || print.state === "paused");
    const isPaused = print.state === "paused";
    const canStop = print.available && (print.state === "printing" || print.state === "paused" || print.state === "preparing");

    const onPauseResume = () => {
        if (!canPauseResume) return;
        sendPrintCommand(isPaused ? "resume" : "pause");
    };

    const onStop = () => {
        if (!canStop) return;
        if (!confirmStop) {
            setConfirmStop(true);
            confirmTimerRef.current && clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = setTimeout(() => setConfirmStop(false), STOP_CONFIRM_MS);
            return;
        }
        confirmTimerRef.current && clearTimeout(confirmTimerRef.current);
        setConfirmStop(false);
        sendPrintCommand("stop");
    };

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-black">
            {frame ? (
                <img
                    src={`data:image/jpeg;base64,${frame}`}
                    className="w-full h-full object-contain"
                    alt="Printer feed"
                />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
                    <span className="text-slate-400 text-sm">{status.message || "Waiting for frame…"}</span>
                </div>
            )}

            <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-2 text-[10px] uppercase tracking-widest text-white/30">
                <span>Bambu Lab</span>
                <div className="flex items-center gap-3">
                    {print.available && <PrintStateBadge state={print.state} />}
                    {status.connected ? <LiveDot /> : status.message ? <span className="text-red-400/70 normal-case">{status.message}</span> : null}
                </div>
            </div>

            {/* Printer controls — left side */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                <ControlButton
                    onClick={onPauseResume}
                    disabled={!canPauseResume}
                    label={isPaused ? "Resume print" : "Pause print"}
                    accent={isPaused ? "green" : undefined}
                >
                    {isPaused ? <PlayIcon /> : <PauseIcon />}
                </ControlButton>
                <ControlButton
                    onClick={onStop}
                    disabled={!canStop}
                    label={confirmStop ? "Tap again to confirm stop" : "Stop print"}
                    accent={confirmStop ? "red" : undefined}
                >
                    <StopIcon />
                </ControlButton>
            </div>

            {/* Light toggle — bottom right */}
            <button
                onClick={toggleLight}
                disabled={!light.available}
                aria-label={light.on ? "Turn chamber light off" : "Turn chamber light on"}
                className={`absolute bottom-4 right-4 w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    !light.available
                        ? "bg-white/5 text-white/20 cursor-not-allowed"
                        : light.on
                            ? "bg-amber-300/90 text-slate-900 shadow-lg shadow-amber-300/30"
                            : "bg-white/10 text-white/70 hover:bg-white/20 active:bg-white/30"
                }`}
            >
                <LightbulbIcon on={light.on} />
            </button>
        </div>
    );
};

const LiveDot: React.FC = () => (
    <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span>live</span>
    </span>
);

const PrintStateBadge: React.FC<{ state: PrintState }> = ({ state }) => {
    const label: Record<PrintState, string> = {
        idle: "idle",
        preparing: "prep",
        printing: "printing",
        paused: "paused",
        finished: "done",
        failed: "failed",
        unknown: "",
    };
    const color: Record<PrintState, string> = {
        idle: "text-white/40",
        preparing: "text-sky-300/70",
        printing: "text-green-300/80",
        paused: "text-amber-300/80",
        finished: "text-green-300/60",
        failed: "text-red-300/80",
        unknown: "text-white/30",
    };
    if (state === "unknown") return null;
    return <span className={`normal-case ${color[state]}`}>{label[state]}</span>;
};

const ControlButton: React.FC<React.PropsWithChildren<{
    onClick: () => void;
    disabled?: boolean;
    label: string;
    accent?: "green" | "red";
}>> = ({ onClick, disabled, label, accent, children }) => {
    const base = "w-12 h-12 rounded-full flex items-center justify-center transition-colors";
    const style = disabled
        ? "bg-white/5 text-white/20 cursor-not-allowed"
        : accent === "red"
            ? "bg-red-500/90 text-white shadow-lg shadow-red-500/40"
            : accent === "green"
                ? "bg-green-400/90 text-slate-900 shadow-lg shadow-green-400/30"
                : "bg-white/10 text-white/80 hover:bg-white/20 active:bg-white/30";
    return (
        <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`${base} ${style}`}>
            {children}
        </button>
    );
};

const LightbulbIcon: React.FC<{ on: boolean }> = ({ on }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z" />
    </svg>
);

const PauseIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
);

const PlayIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5l12 7-12 7V5z" />
    </svg>
);

const StopIcon: React.FC = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
);

export default App;
