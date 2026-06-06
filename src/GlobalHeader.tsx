"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { ChevronDown, LogOut, Settings, BarChart3, Users, Plug, HelpCircle, Megaphone, Sparkles } from "lucide-react";

function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("orinax-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved ? saved === "dark" : prefersDark;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    const val = next ? "dark" : "light";
    localStorage.setItem("orinax-theme", val);
    document.cookie = `orinax-theme=${val}; domain=.orinax.ai; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.classList.toggle("dark", next);
    // Notify next-themes (and any other storage listeners) in the current tab
    window.dispatchEvent(new StorageEvent("storage", { key: "orinax-theme", newValue: val, storageArea: localStorage }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-1.5 rounded-md text-gray-400 dark:text-[#71717a] hover:text-gray-600 dark:hover:text-[#a1a1aa] hover:bg-gray-100 dark:hover:bg-[#27272a] transition-colors duration-200 shrink-0"
      title={isDark ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

const SERVICES = [
  { label: "Аналитика", href: "https://analytics.orinax.ai", hosts: ["analytics.orinax.ai", "my.orinax.ai", "localhost"], icon: BarChart3 },
  { label: "CRM", href: "https://crm.orinax.ai", hosts: ["crm.orinax.ai"], icon: Users },
  { label: "Коннектор", href: "https://connector.orinax.ai", hosts: ["connector.orinax.ai"], icon: Plug },
  { label: "Маркетинг", href: "https://marketing.orinax.ai", hosts: ["marketing.orinax.ai"], icon: Megaphone },
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
    <header className="bg-white dark:bg-[#18181b] border-b border-gray-200 dark:border-[#27272a] h-12 flex items-center px-5 shrink-0 z-20">
      <div className="w-full max-w-[1400px] mx-auto flex items-center gap-5">

        <img
          src="/logo.png"
          alt="ORINAX"
          className="h-6 w-auto shrink-0 select-none"
          draggable={false}
        />

        <div className="h-4 w-px bg-gray-200 dark:bg-[#27272a] shrink-0 hidden sm:block" />

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
                    ? "bg-gray-100 dark:bg-[#27272a] text-gray-900 dark:text-[#fafafa]"
                    : "text-gray-500 dark:text-[#a1a1aa] hover:text-gray-900 dark:hover:text-[#fafafa] hover:bg-gray-100 dark:hover:bg-[#27272a]",
                ].join(" ")}
              >
                <Icon size={13} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
                {s.label}
              </a>
            );
          })}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("orinax:open-ai-chat"));
            }
          }}
          title="AI-чат — беседа с моделями OpenRouter"
          className="p-1.5 rounded-md text-gray-400 dark:text-[#71717a] hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-[#27272a] transition-colors duration-200 shrink-0"
        >
          <Sparkles size={16} strokeWidth={1.75} />
        </button>

        <ThemeToggle />

        <button
          type="button"
          onClick={() => {
            // Открывает SupportAssistantWidget (если он смонтирован в layout'е).
            // Shift/Ctrl/Meta + клик — fallback на полную базу знаний.
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("orinax:open-support"));
            }
          }}
          onAuxClick={(e) => {
            // Средняя кнопка мыши — открыть базу знаний в новой вкладке (legacy UX)
            if (e.button === 1 && typeof window !== "undefined") {
              e.preventDefault();
              window.open("https://my.orinax.ai/knowledge", "_blank", "noopener,noreferrer");
            }
          }}
          title="Помощник Orinax — спросите что угодно про платформу"
          className="p-1.5 rounded-md text-gray-400 dark:text-[#71717a] hover:text-gray-600 dark:hover:text-[#a1a1aa] hover:bg-gray-100 dark:hover:bg-[#27272a] transition-colors duration-200 shrink-0"
        >
          <HelpCircle size={16} strokeWidth={1.75} />
        </button>

        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#27272a] transition-colors duration-200"
          >
            {userImage && !avatarError ? (
              <img
                src={userImage}
                alt={userName}
                onError={() => setAvatarError(true)}
                className="w-6 h-6 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                {userInitials}
              </div>
            )}
            <span className="hidden sm:block text-[13px] text-gray-500 dark:text-[#a1a1aa] max-w-[120px] truncate">
              {userName}
            </span>
            <ChevronDown
              size={12}
              className={`text-gray-400 dark:text-[#71717a] transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-[#18181b] ring-1 ring-gray-200 dark:ring-[#27272a] rounded-lg shadow-xl shadow-gray-200/50 dark:shadow-black/30 z-50 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-gray-100 dark:border-[#27272a]">
                <p className="text-xs font-medium text-gray-900 dark:text-[#fafafa] truncate">{userName}</p>
                {session?.user?.email && session.user.email !== userName && (
                  <p className="text-[11px] text-gray-500 dark:text-[#71717a] truncate mt-0.5">
                    {session.user.email}
                  </p>
                )}
              </div>

              <div className="py-1">
                <a
                  href={currentHost === "localhost" ? "/profile" : "https://my.orinax.ai/profile"}
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-gray-600 dark:text-[#a1a1aa] hover:text-gray-900 dark:hover:text-[#fafafa] hover:bg-gray-50 dark:hover:bg-[#27272a] transition-colors duration-150"
                >
                  <Settings size={14} className="text-gray-400 dark:text-[#71717a] shrink-0" />
                  Настройки
                </a>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors duration-150"
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
