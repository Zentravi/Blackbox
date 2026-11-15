import {
  Activity,
  LayoutDashboard,
  Network,
  ScrollText,
  Server,
  Settings,
  Siren,
  Route,
  Brain,
  Wrench,
  FileText,
} from "lucide-react";

/** Maps NAV_ITEMS icon names to actual Lucide components. */
export const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Network,
  Server,
  Siren,
  ScrollText,
  Route,
  Brain,
  Wrench,
  FileText,
  Settings,
  Activity,
};
