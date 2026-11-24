"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { NetClient } from "@/net/client";
import { CHAT_MAX } from "@/shared/protocol";
import { unescapeHtml } from "@/shared/text";

type Line = { id: number; kind: "chat" | "system"; name?: string; text: string; mine?: boolean };
type Toast = { id: number; text: string };

const LOG_MAX = 60;
// join/leave notes go to the chat log only; everything else (jukebox, weather...) also pops up as a toast
const QUIET = /(entered|left) the cafe$/;

/**
 * Everything chat related on /play:
 *  - the pixel chat bar at the bottom (Enter to type, Esc to cancel, Enter to send)
 *  - the collapsible "Nearby chat" log in the bottom-left corner
 *  - small system toasts ("SunnyMocha413 switched the jukebox to ...")
 * While the bar is open it tells the parent (onTypingChange) so game hotkeys are switched off.
 */
const noopSubscribe = () => () => {};

export default function ChatPanel({
  net: netProp, disabled, onTypingChange,
}: {
  net: NetClient | null;
  disabled: boolean; // a modal is open
  onTypingChange: (typing: boolean) => void;
}) {
  // a dropped connection counts as "offline", same as no server at all
  const dropped = useSyncExternalStore(netProp ? netProp.subscribe : noopSubscribe, () => !!netProp?.closed, () => false);
  const net = netProp && !dropped ? netProp : null;
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  const collapsedRef = useRef(false);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  const close = useCallback(() => {
    setTyping(false);
    setText("");
    setError("");
    inputRef.current?.blur();
  }, []);

  // tell the game when we start/stop typing
  useEffect(() => { onTypingChange(typing); }, [typing, onTypingChange]);
  useEffect(() => { if ((disabled || !net) && typing) queueMicrotask(close); }, [disabled, net, typing, close]);
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);

  // Enter opens the bar (unless you're already in some other input, or a window is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || typing || disabled || e.repeat || !net) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      setTyping(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [typing, disabled, net]);

  // incoming chat + system lines
  useEffect(() => {
    if (!net) return;
    const push = (l: Omit<Line, "id">) => {
      setLines((cur) => [...cur.slice(-(LOG_MAX - 1)), { ...l, id: seq.current++ }]);
      if (collapsedRef.current) setUnread((n) => n + 1);
    };
    const offChat = net.on("chat", (m) => {
      const mine = m.from === net.selfId;
      push({ kind: "chat", name: mine ? "You" : unescapeHtml(m.name), text: unescapeHtml(m.text), mine });
    });
    const offSys = net.on("system", ({ text: raw }) => {
      const t = unescapeHtml(raw);
      push({ kind: "system", text: t });
      if (QUIET.test(t)) return;
      const id = seq.current++;
      setToasts((cur) => [...cur.slice(-2), { id, text: t }]);
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 4500);
    });
    return () => { offChat(); offSys(); };
  }, [net]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, collapsed]);

  const sending = useRef(false);
  const send = async () => {
    const t = text.trim();
    if (!t) return close();
    if (!net || sending.current) return;
    sending.current = true; // ignore a second Enter while the server is answering
    const res = await net.chat(t);
    sending.current = false;
    if (res.ok) close();
    else setError(res.reason);
  };

  const left = Array.from(text).length;

  return (
    <>
      {/* system toasts */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-20 flex -translate-x-1/2 flex-col items-center gap-1" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast-in bg-espresso/90 px-3 py-1 text-lg text-latte shadow-[0_0_0_2px_#6b4a31]">{t.text}</div>
        ))}
      </div>

      {/* nearby chat log */}
      <div className="absolute bottom-3 left-3 z-10 w-72 max-w-[42vw]">
        <button
          className="px-btn secondary w-full !py-1 text-left"
          onClick={(e) => { setCollapsed((c) => !c); setUnread(0); e.currentTarget.blur(); }}
          aria-expanded={!collapsed}
          aria-controls="chat-log"
        >
          {collapsed ? "▸" : "▾"} Nearby chat{collapsed && unread > 0 ? ` (${unread} new)` : ""}
        </button>
        {!collapsed && (
          <ul id="chat-log" ref={logRef} className="mt-1 max-h-40 min-h-12 overflow-y-auto bg-espresso/85 p-2 text-lg leading-tight" aria-label="Nearby chat">
            {lines.length === 0 && <li className="text-bark">{net ? "Say hi! Only people near you can hear." : "Chat needs the server (npm run dev:all)."}</li>}
            {lines.map((l) =>
              l.kind === "system" ? (
                <li key={l.id} className="text-latte opacity-70">· {l.text}</li>
              ) : (
                <li key={l.id} className="break-words text-cream">
                  <b className={l.mine ? "text-amber" : "text-mint"}>{l.name}:</b> {l.text}
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {/* chat bar */}
      <div className="absolute bottom-14 left-1/2 z-10 w-[min(34rem,92vw)] -translate-x-1/2">
        {typing ? (
          <div className="px-panel flex items-center gap-2 !p-2" role="group" aria-label="Chat">
            <input
              ref={inputRef}
              className="px-input !border-0 !bg-transparent !p-1"
              value={text}
              maxLength={CHAT_MAX}
              placeholder={net ? "Say something nice..." : "Chat is offline"}
              disabled={!net}
              aria-label="Chat message"
              onChange={(e) => { setText(e.target.value); setError(""); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void send();
                else if (e.key === "Escape") close();
              }}
            />
            <span className={left >= CHAT_MAX ? "text-ember" : "text-latte"}>{left}/{CHAT_MAX}</span>
          </div>
        ) : (
          <button
            className="mx-auto block bg-espresso/80 px-4 py-1 text-latte hover:text-cream"
            onClick={(e) => { if (net && !disabled) setTyping(true); e.currentTarget.blur(); }}
          >
            {net ? "Press Enter to type" : "Chat is offline (server not running)"}
          </button>
        )}
        {typing && (
          <p className="mt-1 bg-espresso/80 px-2 text-center text-base text-latte" role="status">
            {error ? <span className="text-ember">{error}</span> : "Enter to send · Esc to cancel"}
          </p>
        )}
      </div>
    </>
  );
}
