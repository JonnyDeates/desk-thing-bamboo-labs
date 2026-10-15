import React, { useEffect, useState } from "react";
import { createDeskThing } from "@deskthing/client";

type ToClientEvent =
  | { type: "frame"; payload: string }
  | { type: "status"; payload: { connected: boolean; message: string } }
  | { type: "light_state"; payload: { on: boolean; available: boolean } };
type ToServerEvent =
  | { type: "request_frame" }
  | { type: "start_feed" }
  | { type: "stop_feed" }
  | { type: "set_light"; payload: { on: boolean } };

const DeskThing = createDeskThing<ToClientEvent, ToServerEvent>();

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

        DeskThing.send({ type: "start_feed" });
        const keepalive = setInterval(() => DeskThing.send({ type: "start_feed" }), 20_000);

        return () => {
            offFrame?.();
            offStatus?.();
            offLight?.();
            clearInterval(keepalive);
            DeskThing.send({ type: "stop_feed" });
        };
    }, []);

    const toggleLight = () => {
        if (!light.available) return;
        DeskThing.send({ type: "set_light", payload: { on: !light.on } });
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
                {status.connected ? <LiveDot /> : status.message ? <span className="text-red-400/70 normal-case">{status.message}</span> : null}
            </div>

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

const LightbulbIcon: React.FC<{ on: boolean }> = ({ on }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z" />
    </svg>
);

export default App;
