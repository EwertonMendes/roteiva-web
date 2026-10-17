import { useEffect, useState } from "react";
import { Type } from "lucide-react";

/**
 * TEMPORARY DEV EXPERIMENT — delete this component and font-lab.css after
 * choosing the final Roteiva font. Never upload or bundle the Google font files.
 */
export const TEMPORARY_FONT_LAB_ENABLED = true;

export const FONT_CANDIDATES = [
  "Ubuntu", // Existing bundled font: the control group.
  "Manrope",
  "Plus Jakarta Sans",
  "DM Sans",
  "Instrument Sans",
  "Geist",
  "Sora",
  "Space Grotesk",
  "Outfit",
  "Inter",
  "Onest",
] as const;

type Candidate = (typeof FONT_CANDIDATES)[number];
type LoadingState = "ready" | "loading" | "error";
const STORAGE_KEY = "roteiva:temporary-font-lab:v1";
const LINK_ID = "roteiva-temporary-google-font";

function isCandidate(name: string | null): name is Candidate {
  return FONT_CANDIDATES.some((candidate) => candidate === name);
}
function initialFont(): Candidate {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isCandidate(stored) ? stored : "Ubuntu";
  } catch {
    return "Ubuntu";
  }
}

export function TypographyLab() {
  const [font, setFont] = useState<Candidate>(initialFont);
  const [status, setStatus] = useState<LoadingState>("ready");

  useEffect(() => {
    const root = document.documentElement;
    let cancelled = false;
    try { window.sessionStorage.setItem(STORAGE_KEY, font); } catch { /* Temporary choice remains usable. */ }

    if (font === "Ubuntu") {
      root.style.removeProperty("--temporary-roteiva-font");
      root.removeAttribute("data-typography-lab");
      setStatus("ready");
      return;
    }

    setStatus("loading");

    // Google Fonts CSS2 is loaded ONLY for the currently selected family.
    // Loading the entire list eagerly would slow down the dashboard.
    const sheet = document.createElement("link");
    sheet.id = LINK_ID;
    sheet.rel = "stylesheet";
    sheet.href = "https://fonts.googleapis.com/css2?family=" +
      encodeURIComponent(font).replace(/%20/g, "+") +
      ":wght@400;500;600;700&display=swap";

    sheet.onload = () => {
      void document.fonts.load('500 16px "' + font + '"', "Roteiva audiovisual 0123456789")
        .then((loaded) => {
          if (cancelled) return;
          if (loaded.length === 0) throw new Error("No matching remote font face");
          root.style.setProperty("--temporary-roteiva-font", '"' + font + '", Ubuntu, sans-serif');
          root.setAttribute("data-typography-lab", "true");
          setStatus("ready");
        })
        .catch(() => { if (!cancelled) setStatus("error"); });
    };
    sheet.onerror = () => { if (!cancelled) setStatus("error"); };
    document.head.appendChild(sheet);
    return () => { cancelled = true; sheet.remove(); };
  }, [font]);

  useEffect(() => () => {
    document.documentElement.style.removeProperty("--temporary-roteiva-font");
    document.documentElement.removeAttribute("data-typography-lab");
  }, []);

  return <div className="font-lab" aria-label="Laboratório temporário de fontes">
    <Type size={17} aria-hidden="true" className="font-lab-icon" />
    <label className="font-lab-label" htmlFor="roteiva-test-font">
      <span className="font-lab-caption">Fonte (teste)</span>
      <select
        id="roteiva-test-font"
        aria-label="Fonte para testar no Roteiva"
        value={font}
        onChange={(event) => setFont(event.target.value as Candidate)}
        title="Alterar a fonte de toda a interface, temporariamente"
      >
        {FONT_CANDIDATES.map((family) =>
          <option key={family} value={family}>{family === "Ubuntu" ? "Ubuntu (atual)" : family}</option>)}
      </select>
    </label>
    <span role="status" aria-live="polite" className={"font-lab-status font-lab-status-" + status}
      title={status === "loading" ? "Carregando fonte do Google" : status === "error" ?
        "Não foi possível carregar a fonte remota; a anterior permanece aplicada." : "Fonte pronta"}>
      {status === "loading" ? "Carregando…" : status === "error" ? "Falha ao carregar" : ""}
    </span>
  </div>;
}
