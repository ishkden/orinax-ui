"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings } from "lucide-react";

const SERVICES = [
  { label: "Аналитика", href: "https://my.orinax.ai/dashboard" },
  { label: "CRM", href: "https://crm.orinax.ai" },
  { label: "Коннектор", href: "https://connector.orinax.ai" },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "U").toUpperCase();
}

export interface GlobalHeaderProps {
  /** Override default signOut behaviour. Useful in crm-app to also clear org cookies. */
  onLogout?: () => void | Promise<void>;
}

export function GlobalHeader({ onLogout }: GlobalHeaderProps = {}) {
  const { data: session } = useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userName = session?.user?.name || session?.user?.email || "Пользователь";
  const userInitials = getInitials(userName);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setDropdownOpen(false);
    if (onLogout) {
      await onLogout();
    } else {
      await signOut({ callbackUrl: "/login" });
    }
  };

  return (
    <>
      <div className="h-[2px] bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-600 shrink-0" />
      <header className="bg-[#0f1117] border-b border-[#1e2335] h-14 flex items-center px-5 shrink-0 z-20">
        <div className="w-full max-w-[1400px] mx-auto flex items-center gap-4">

          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                <path
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <span className="font-bold text-white text-sm tracking-tight select-none">
              ORINAX
            </span>
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-[#2e3345] shrink-0 hidden sm:block" />

          {/* Nav links */}
          <nav className="hidden sm:flex items-center gap-0.5">
            {SERVICES.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-[#1e2335] transition-colors whitespace-nowrap"
              >
                {s.label}
              </a>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* User dropdown */}
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1a1d27] border border-[#2e3345] hover:border-indigo-500/50 hover:bg-[#1e2130] transition-all"
            >
              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                {userInitials}
              </div>
              <span className="hidden sm:block text-sm text-gray-300 max-w-[120px] truncate">
                {userName}
              </span>
              <ChevronDown
                size={13}
                className={`text-gray-500 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-[#13151f] border border-[#2e3345] rounded-xl shadow-2xl shadow-black/40 z-50 overflow-hidden">
                {/* User info */}
                <div className="px-4 py-3 border-b border-[#2e3345]">
                  <p className="text-xs font-semibold text-white truncate">{userName}</p>
                  {session?.user?.email && session.user.email !== userName && (
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">
                      {session.user.email}
                    </p>
                  )}
                </div>

                {/* Menu items */}
                <div className="py-1.5">
                  <Link
                    href="/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#1e2335] transition-colors"
                  >
                    <Settings size={14} className="text-gray-500 shrink-0" />
                    Настройки профиля
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/8 transition-colors"
                  >
                    <LogOut size={14} className="shrink-0" />
                    Выйти
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
