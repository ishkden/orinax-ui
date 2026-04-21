"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";

import { ChevronDown, LogOut, Settings, BarChart3, Users, Plug } from "lucide-react";

const SERVICES = [
  { label: "Аналитика", href: "https://analytics.orinax.ai", hosts: ["analytics.orinax.ai", "my.orinax.ai", "localhost"], icon: BarChart3 },
  { label: "CRM", href: "https://crm.orinax.ai", hosts: ["crm.orinax.ai"], icon: Users },
  { label: "Коннектор", href: "https://connector.orinax.ai", hosts: ["connector.orinax.ai"], icon: Plug },
];

const ANALYTICS_HOSTS = ["analytics.orinax.ai", "my.orinax.ai", "localhost"];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "U").toUpperCase();
}

function applyOrgBackground(url: string | null) {
  const existing = document.getElementById("__org-bg-style");
  if (existing) existing.remove();

  if (!url) {
    document.documentElement.classList.remove("org-has-bg");
    document.documentElement.style.removeProperty("--org-bg-url");
    return;
  }

  document.documentElement.classList.add("org-has-bg");
  document.documentElement.style.setProperty("--org-bg-url", `url(${url})`);

  const style = document.createElement("style");
  style.id = "__org-bg-style";
  style.textContent = [
    "html.org-has-bg {",
    "  --bg: transparent !important;",
    "  --bg2: transparent !important;",
    "  --color-surface: transparent !important;",
    "  background-image: var(--org-bg-url);",
    "  background-size: cover;",
    "  background-position: center;",
    "  background-attachment: fixed;",
    "  background-repeat: no-repeat;",
    "  min-height: 100vh;",
    "}",
    "html.org-has-bg body { background: transparent !important; }",
    "html.org-has-bg .min-h-screen,",
    "html.org-has-bg .h-screen,",
    "html.org-has-bg .bg-gray-50,",
    "html.org-has-bg .bg-surface,",
    "html.org-has-bg .bg-background { background: transparent !important; }",
    "html.org-has-bg header { background: rgba(255,255,255,0.92) !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important; }",
  ].join("\n");
  document.head.appendChild(style);
}

export interface GlobalHeaderProps {
  onLogout?: () => void | Promise<void>;
  activeService?: string;
}

export function GlobalHeader({ onLogout, activeService }: GlobalHeaderProps = {}) {
  const { data: session } = useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currentHost, setCurrentHost] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [avatarError, setAvatarError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userName = session?.user?.name || session?.user?.email || "Пользователь";
  const userInitials = getInitials(userName);
  const userImage = session?.user?.image ?? null;

  useLayoutEffect(() => {
    setCurrentHost(window.location.hostname);
    setCurrentPath(window.location.pathname);
  }, []);

  const fetchAndApplyBg = useCallback(() => {
    const host = window.location.hostname;
    const isAnalytics = ANALYTICS_HOSTS.includes(host);
    const apiUrl = isAnalytics
      ? "/api/org/background"
      : "https://analytics.orinax.ai/api/org/background";

    fetch(apiUrl, {
      credentials: isAnalytics ? "same-origin" : "include",
    })
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data) applyOrgBackground(data.backgroundUrl ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAndApplyBg();

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      applyOrgBackground(detail?.backgroundUrl ?? null);
    };
    window.addEventListener("org-background-changed", handler);
    return () => window.removeEventListener("org-background-changed", handler);
  }, [fetchAndApplyBg]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const SHARED_PATHS = ["/profile", "/settings"];
  const isSharedPath = SHARED_PATHS.some((p) => currentPath.startsWith(p));
  const activeHref = activeService || (isSharedPath ? "" : SERVICES.find((s) => s.hosts.includes(currentHost))?.href ?? "");

  const handleLogout = async () => {
    setDropdownOpen(false);
    if (onLogout) {
      await onLogout();
    } else {
      await signOut({ callbackUrl: "/login" });
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 h-12 flex items-center px-5 shrink-0 z-20">
      <div className="w-full max-w-[1400px] mx-auto flex items-center gap-5">

        <img
          src="/logo.png"
          alt="ORINAX"
          className="h-6 w-auto shrink-0 select-none"
          draggable={false}
        />

        <div className="h-4 w-px bg-gray-200 shrink-0 hidden sm:block" />

        <nav className="hidden sm:flex items-center gap-0.5">
          {SERVICES.map((s) => {
            const isActive = s.href === activeHref;
            const Icon = s.icon;
            return (
              <a
                key={s.href}
                href={s.href}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-200 whitespace-nowrap",
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100",
                ].join(" ")}
              >
                <Icon size={13} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
                {s.label}
              </a>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors duration-200"
          >
            {userImage && !avatarError ? (
              <img
                src={userImage}
                alt={userName}
                onError={() => setAvatarError(true)}
                className="w-6 h-6 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                {userInitials}
              </div>
            )}
            <span className="hidden sm:block text-[13px] text-gray-500 max-w-[120px] truncate">
              {userName}
            </span>
            <ChevronDown
              size={12}
              className={`text-gray-400 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-white ring-1 ring-gray-200 rounded-lg shadow-xl shadow-gray-200/50 z-50 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-900 truncate">{userName}</p>
                {session?.user?.email && session.user.email !== userName && (
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    {session.user.email}
                  </p>
                )}
              </div>

              <div className="py-1">
                <a
                  href="https://my.orinax.ai/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors duration-150"
                >
                  <Settings size={14} className="text-gray-400 shrink-0" />
                  Настройки
                </a>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors duration-150"
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
  );
}
