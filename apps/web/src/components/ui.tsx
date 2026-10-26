import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { ControllerStatus } from "@wled-manager/shared";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-sky-600 hover:bg-sky-500 text-white",
    secondary: "bg-neutral-800 hover:bg-neutral-700 text-neutral-100",
    danger: "bg-neutral-800 hover:bg-red-900 text-red-300",
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-400">{label}</span>
      <input
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-neutral-100 outline-none focus:border-sky-500"
        {...props}
      />
    </label>
  );
}

const statusStyles: Record<ControllerStatus, [string, string]> = {
  online: ["bg-emerald-500", "Online"],
  offline: ["bg-red-500", "Offline"],
  unknown: ["bg-neutral-500", "Unknown"],
};

export function StatusDot({ status }: { status: ControllerStatus }) {
  const [color, label] = statusStyles[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-neutral-800 bg-neutral-900 p-4 ${className}`}>{children}</div>;
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-400">{error instanceof Error ? error.message : String(error)}</p>;
}

export const timeAgo = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
