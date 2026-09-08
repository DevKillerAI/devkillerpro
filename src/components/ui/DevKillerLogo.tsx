import React from "react";

interface DevKillerLogoProps {
  className?: string;
  size?: number;
  withBackground?: boolean;
}

export function DevKillerLogo({
  className = "",
  size = 48,
  withBackground = true,
}: DevKillerLogoProps) {
  if (!withBackground) {
    return (
      <img
        src="/logoDX.png"
        alt="DevKiller Logo"
        width={size}
        height={size}
        className={`object-contain ${className}`}
      />
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center rounded-2xl bg-[#111420] border border-slate-800/80 shadow-lg shadow-black/30 overflow-hidden shrink-0 transition-transform ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/logoDX.png"
        alt="DevKiller Logo"
        className="w-[82%] h-[82%] object-contain drop-shadow-sm"
      />
    </div>
  );
}

export function DevKillerSymbol({
  className = "",
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src="/logoDX.png"
      alt="DevKiller Symbol"
      width={size}
      height={size}
      className={`object-contain ${className}`}
    />
  );
}
