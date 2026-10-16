"use client";
import { useEffect, useRef, useState } from "react";

/** Decorative effects stay outside the workspace state and never delay data requests. */
export function SiteExperience() {
  const [intro, setIntro] = useState<"enter" | "exit" | "done">("enter");
  const bar = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let enabled = fine.matches && !reduced.matches;
    let frame: number | null = null;
    let x = 0, y = 0, currentX = 0, currentY = 0;
    let visible = false;
    function hide() {
      visible = false;
      root.removeAttribute("data-roteiva-cursor");
      ring.current?.classList.remove("is-visible", "is-active", "is-pressed");
      dot.current?.classList.remove("is-visible");
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    function render() {
      currentX += (x - currentX) * .23;
      currentY += (y - currentY) * .23;
      if (ring.current) ring.current.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      if (Math.abs(x-currentX) + Math.abs(y-currentY) > .15 && visible) frame = requestAnimationFrame(render);
      else frame = null;
    }
    function move(event: PointerEvent) {
      if (!enabled || event.pointerType === "touch") { hide(); return; }
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, video, iframe, [contenteditable="true"], [data-native-cursor]')) { hide(); return; }
      x = event.clientX; y = event.clientY;
      if (!visible) { currentX = x; currentY = y; }
      visible = true;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      ring.current?.classList.add("is-visible");
      dot.current?.classList.add("is-visible");
      ring.current?.classList.toggle("is-active", !!target.closest('button:not(:disabled), a, [role="button"], label, summary, input[type="checkbox"], input[type="radio"]'));
      root.setAttribute("data-roteiva-cursor", "on");
      if (frame === null) frame = requestAnimationFrame(render);
    }
    function down() { ring.current?.classList.add("is-pressed"); }
    function up() { ring.current?.classList.remove("is-pressed"); }
    function keyboard(event: KeyboardEvent) { if (event.key === "Tab" || event.key === "Escape") hide(); }
    function updateMedia() { enabled = fine.matches && !reduced.matches; if (!enabled) hide(); }
    window.addEventListener("pointermove", move, {passive:true});
    window.addEventListener("pointerdown", down, {passive:true});
    window.addEventListener("pointerup", up, {passive:true});
    window.addEventListener("blur", hide);
    document.addEventListener("pointerleave", hide);
    window.addEventListener("keydown", keyboard);
    fine.addEventListener("change", updateMedia);
    reduced.addEventListener("change", updateMedia);
    return () => {
      hide(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", hide); document.removeEventListener("pointerleave", hide); window.removeEventListener("keydown", keyboard);
      fine.removeEventListener("change", updateMedia); reduced.removeEventListener("change", updateMedia);
    };
  }, []);

  return <>
    {intro !== "done" && <div className={`brand-intro brand-intro-${intro}`} aria-hidden="true">
      <div className="brand-intro-corner"><span>ROTEIVA</span><span>SEU ESPAÇO DE PRODUÇÃO</span></div>
      <div className="brand-intro-center"><div className="brand-intro-wordmark"><img src="roteiva-logo-white.png" alt=""/></div><div className="brand-intro-track"><span ref={bar}/></div></div>
      <div className="brand-intro-footer"><span>DA IDEIA À ENTREGA.</span><span>EM SINTONIA.</span></div>
    </div>}
    <div ref={ring} className="studio-cursor-ring" aria-hidden="true"><i/></div>
    <div ref={dot} className="studio-cursor-dot" aria-hidden="true"><i/></div>
  </>;
}
