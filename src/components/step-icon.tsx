import {
  Brain,
  CircleHelp,
  ClipboardList,
  CloudUpload,
  FilePen,
  FilePlus,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  Globe,
  Inbox,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  OctagonX,
  Package,
  Plug,
  Quote,
  Reply,
  Search,
  Send,
  Sparkles,
  SquareTerminal,
  Timer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { IconKey } from "@/lib/explain";

const ICONS: Record<IconKey, LucideIcon> = {
  prompt: MessageSquare,
  read: FileText,
  edit: FilePen,
  create: FilePlus,
  search: Search,
  terminal: SquareTerminal,
  test: FlaskConical,
  save: GitCommitHorizontal,
  upload: CloudUpload,
  install: Package,
  web: Globe,
  browser: MousePointerClick,
  todo: ListTodo,
  brief: Send,
  report: Inbox,
  message: MessagesSquare,
  reply: Reply,
  ask: CircleHelp,
  plan: ClipboardList,
  skill: Sparkles,
  tool: Wrench,
  note: Quote,
  stop: OctagonX,
  plug: Plug,
  wait: Timer,
  memory: Brain,
};

export function StepIcon({ icon, className }: { icon: IconKey; className?: string }) {
  const Icon = ICONS[icon] ?? Wrench;
  return <Icon className={className} />;
}

/** One colour per agent, readable on light and dark backgrounds. */
export const hueColor = (hue: number, alpha = 1) => `oklch(0.68 0.15 ${hue} / ${alpha})`;
