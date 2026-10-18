import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type IconLabelProps = {
  icon: LucideIcon;
  children: ReactNode;
  size?: number;
  className?: string;
};

/** Decorative Lucide icon paired with a meaningful visible text label.
 * The label itself supplies the accessible name for the parent control.
 */
export function IconLabel({ icon: Icon, children, size = 16, className = "" }: IconLabelProps) {
  return <span className={["ui-icon-label", className].filter(Boolean).join(" ")}>
    <Icon size={size} strokeWidth={1.85} aria-hidden="true" focusable="false" />
    <span>{children}</span>
  </span>;
}
