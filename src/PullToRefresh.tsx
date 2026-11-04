import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

// Als Homebildschirm-App gibt es kein Herunterziehen zum Neuladen des Browsers.
// Diese Komponente ersetzt es: ganz oben nach unten ziehen und loslassen lädt die App neu.
const TRIGGER = 70;
const MAX = 110;

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

// Nicht auslösen, solange ein Fenster (Lauf einreichen, „Mehr“-Menü) offen ist.
const overlayOpen = () => !!document.querySelector(".modal-backdrop,.more-backdrop");

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (!isStandalone() || overlayOpen() || window.scrollY > 0 || e.touches.length !== 1) { start.current = null; return; }
      start.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) { pullRef.current = 0; setPull(0); return; }
      pullRef.current = Math.min(MAX, dy * 0.5);
      setPull(pullRef.current);
    };
    const onEnd = () => {
      if (start.current == null) return;
      start.current = null;
      if (pullRef.current >= TRIGGER) {
        setRefreshing(true);
        setPull(TRIGGER);
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) return null;
  const ready = pull >= TRIGGER;
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull - 44}px)` }} aria-live="polite">
      <RefreshCw size={18} className={refreshing ? "ptr-spin" : ""} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      <span>{refreshing ? "Wird aktualisiert …" : ready ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen"}</span>
    </div>
  );
}
