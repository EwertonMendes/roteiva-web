"use client";
import { useEffect, useRef, useState } from "react";

/** Decorative effects stay outside the workspace state and never delay data requests. */
export function SiteExperience() {
  const [intro, setIntro] = useState<"enter" | "exit" | "done">("enter");
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let live = true;
    const timers: number[] = [];
    let fontsReady = false;
    let appReady = document.documentElement.hasAttribute("data-roteiva-ready") || location.pathname.startsWith("/review");
    let minimumReady = false;
    let leaving = false;
    function finish() {
      if (!live || leaving || !minimumReady || !fontsReady || !appReady) return;
      leaving = true;
      if (bar.current) bar.current.style.transform = "scaleX(1)";
      if (reduced.matches) { setIntro("done"); return; }
      timers.push(window.setTimeout(() => {
        if (!live) return;
        setIntro("exit");
        timers.push(window.setTimeout(() => { if (live) setIntro("done"); }, 650));
      }, 160));
    }
    function onReady() { appReady = true; finish(); }
    function onFonts() {
      if (!live || fontsReady) return;
      fontsReady = true;
      if (bar.current) bar.current.style.transform = "scaleX(.65)";
      finish();
    }
    window.addEventListener("roteiva:ready", onReady);
    void document.fonts.ready.then(onFonts);
    timers.push(window.setTimeout(onFonts, 1800));
    timers.push(window.setTimeout(() => { minimumReady = true; finish(); }, reduced.matches ? 0 : 850));
    // A failed or interrupted page request must never trap someone behind an animation.
    timers.push(window.setTimeout(() => { appReady = true; onFonts(); finish(); }, 4000));
    return () => { live = false; timers.forEach(window.clearTimeout); window.removeEventListener("roteiva:ready", onReady); };
  }, []);

  // Intro animation is independent of the pointer: no global cursor events,
  // animation loops, portals or native cursor overrides are installed.
  return intro !== "done" ? <div className={`brand-intro brand-intro-${intro}`} aria-hidden="true">
    <div className="brand-intro-corner"><span>ROTEIVA</span><span>SEU ESPAÇO DE PRODUÇÃO</span></div>
    <div className="brand-intro-center"><div className="brand-intro-wordmark"><img src={`${import.meta.env.BASE_URL}roteiva-logo-white.png`} alt=""/></div><div className="brand-intro-track"><span ref={bar}/></div></div>
    <div className="brand-intro-footer"><span>DA IDEIA À ENTREGA.</span><span>EM SINTONIA.</span></div>
  </div> : null;
}
