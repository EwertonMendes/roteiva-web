import { BadgeCheck, Clapperboard, Eye, Wrench, type LucideIcon } from "lucide-react";
import type { Status } from "../../domain/workspace";

/** One consistent icon for each project status across filters and badges. */
export const PROJECT_STATUS_ICONS = {
  "Em produção": Clapperboard,
  "Em aprovação": Eye,
  Ajustes: Wrench,
  Aprovado: BadgeCheck,
} satisfies Record<Status, LucideIcon>;

export const PROJECT_STATUS_LABELS = {
  "Em produção": "Em produção",
  "Em aprovação": "Em aprovação",
  Ajustes: "Ajustes pedidos",
  Aprovado: "Aprovado",
} satisfies Record<Status, string>;

/** Shared colors for status filters, cards and dropdown options. */
export const PROJECT_STATUS_COLORS = {
  "Em produção":"#349af4",
  "Em aprovação":"#f6bd4f",
  Ajustes:"#ae77f1",
  Aprovado:"#38cc74",
} satisfies Record<Status,string>;
