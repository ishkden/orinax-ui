"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from "react";
import {
  X,
  Plus,
  Send,
  Paperclip,
  Loader2,
  Trash2,
  FileText,
  ChevronDown,
  Check,
  Image,
  FileSpreadsheet,
  File,
  Eye,
} from "lucide-react";

const ANALYTICS_HOSTS = new Set([
  "my.orinax.ai",
  "analytics.orinax.ai",
  "localhost",
  "127.0.0.1",
]);

const MODULE = "global-ai-chat";

const SUGGESTION_POOL = [
  "Помоги составить коммерческое предложение для нового клиента",
  "Напиши скрипт для первого звонка потенциальному клиенту",
  "Как грамотно отказать клиенту, сохранив отношения?",
  "Составь список вопросов для первичной встречи с клиентом",
  "Напиши письмо-напоминание по просроченной задаче",
  "Помоги сформулировать ценностное предложение продукта",
  "Проанализируй ситуацию и предложи план действий",
  "Как улучшить конверсию на этапе воронки продаж?",
  "Напиши краткое резюме по итогам переговоров",
  "Составь план онбординга нового сотрудника",
  "Что важно учесть при заключении договора с подрядчиком?",
  "Помоги описать бизнес-процесс для регламента",
  "Напиши ответ на негативный отзыв клиента",
  "Составь структуру презентации для инвестора",
  "Как правильно поставить задачу сотруднику?",
];

function getRandomSuggestions(count = 3): string[] {
  const shuffled = [...SUGGESTION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

interface ChatSession {
  id: string;
  title: string;
  model: string | null;
  contextUsedTokens: number;
  contextMaxTokens: number;
  updatedAt: string;
}

interface PendingFile {
  fileId: string;
  fileName: string;
  kind: "image" | "document";
  url: string | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  metadata?: { attachmentFileIds?: string[] } | null;
  _pendingFiles?: PendingFile[];
}

interface ModelOption {
  id: string;
  label: string;
  supportsVision?: boolean;
}

function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (ANALYTICS_HOSTS.has(host)) return "";
  return "https://my.orinax.ai";
}

function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

function SectionSpinner({ dark }: { dark: boolean }) {
  return (
    <div className="flex items-center justify-center py-16">
      <svg
        className="animate-spin"
        style={{ color: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)" }}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M12 2a10 10 0 0 1 10 10" opacity="0.9" />
        <path d="M22 12a10 10 0 0 1-10 10" opacity="0.4" />
        <path d="M12 22a10 10 0 0 1-10-10" opacity="0.2" />
        <path d="M2 12a10 10 0 0 1 10-10" opacity="0.6" />
      </svg>
    </div>
  );
}

function renderMarkdown(text: string, dark: boolean): string {
  const codeBlockBg   = dark ? "rgba(0,0,0,0.45)"           : "rgba(0,0,0,0.05)";
  const codeBlockBdr  = dark ? "rgba(255,255,255,0.1)"       : "rgba(0,0,0,0.1)";
  const inlineCodeBg  = dark ? "rgba(255,255,255,0.12)"      : "rgba(0,0,0,0.08)";
  const linkColor     = dark ? "#93c5fd"                     : "#2563eb";
  const headingColor  = dark ? "rgba(255,255,255,0.95)"      : "rgba(0,0,0,0.9)";
  const hrColor       = dark ? "rgba(255,255,255,0.1)"       : "rgba(0,0,0,0.12)";
  const bqBorder      = dark ? "rgba(99,102,241,0.7)"        : "#6366f1";
  const bqBg          = dark ? "rgba(99,102,241,0.06)"       : "rgba(99,102,241,0.04)";
  const codeTextColor = dark ? "#e2e8f0"                     : "#1e293b";

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s: string): string =>
    esc(s)
      // Links [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
        `<a href="$2" target="_blank" rel="noopener noreferrer" style="color:${linkColor};text-decoration:underline;text-underline-offset:2px;">$1</a>`)
      // Inline code
      .replace(/`([^`\n]+)`/g,
        `<code style="padding:1px 6px;border-radius:4px;background:${inlineCodeBg};font-size:0.875em;font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;">$1</code>`)
      // Bold + italic
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>");

  // Extract fenced code blocks → placeholders to protect them from inline processing
  const blocks: string[] = [];
  const withPH = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const idx = blocks.length;
    const langBadge = lang
      ? `<span style="font-size:11px;opacity:0.4;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(lang)}</span>`
      : `<span></span>`;
    const copyBtnColor = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)";
    const copyBtnHover = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
    const escapedCode = esc(code.trim()).replace(/"/g, "&quot;");
    const rawCode = code.trim().replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
    blocks.push(
      `<pre style="margin:10px 0;padding:12px 16px;border-radius:10px;background:${codeBlockBg};border:1px solid ${codeBlockBdr};overflow-x:auto;clear:both;position:relative;">` +
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">` +
      langBadge +
      `<button onclick="(function(btn){var code=btn.getAttribute('data-code');navigator.clipboard.writeText(code).then(function(){btn.textContent='Скопировано';btn.style.color='#22c55e';setTimeout(function(){btn.textContent='Копировать';btn.style.color='${copyBtnColor}';},1500)}).catch(function(){});})(this)" data-code="${escapedCode}" style="font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid ${codeBlockBdr};background:transparent;cursor:pointer;color:${copyBtnColor};font-family:ui-sans-serif,system-ui,sans-serif;transition:background 0.15s;" onmouseover="this.style.background='${copyBtnHover}'" onmouseout="this.style.background='transparent'">Копировать</button>` +
      `</div>` +
      `<code style="color:${codeTextColor};font-family:ui-monospace,'Cascadia Code','Source Code Pro',Menlo,Consolas,monospace;font-size:13px;line-height:1.55;white-space:pre;display:block;">${esc(code.trim())}</code></pre>`
    );
    return `\x02BLOCK${idx}\x03`;
  });

  const lines = withPH.split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType === "ul") { out.push("</ul>"); listType = null; }
    else if (listType === "ol") { out.push("</ol>"); listType = null; }
  };

  for (const line of lines) {
    // Restore code block placeholder
    if (/\x02BLOCK\d+\x03/.test(line)) {
      closeList();
      out.push(line.replace(/\x02BLOCK(\d+)\x03/g, (_, i: string) => blocks[parseInt(i)]));
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      closeList();
      const lvl = hm[1].length;
      const sz  = ["20px", "17px", "15px"][lvl - 1];
      const fw  = lvl === 1 ? "700" : "600";
      const mg  = ["16px 0 7px", "13px 0 5px", "10px 0 4px"][lvl - 1];
      out.push(`<h${lvl} style="font-size:${sz};font-weight:${fw};margin:${mg};color:${headingColor};line-height:1.3;">${inline(hm[2])}</h${lvl}>`);
      continue;
    }

    // Unordered list
    const ulm = line.match(/^[-*+] (.+)/);
    if (ulm) {
      if (listType !== "ul") { closeList(); out.push(`<ul style="margin:6px 0;padding-left:22px;">`); listType = "ul"; }
      out.push(`<li style="margin:2px 0;line-height:1.65;">${inline(ulm[1])}</li>`);
      continue;
    }

    // Ordered list
    const olm = line.match(/^\d+\. (.+)/);
    if (olm) {
      if (listType !== "ol") { closeList(); out.push(`<ol style="margin:6px 0;padding-left:22px;">`); listType = "ol"; }
      out.push(`<li style="margin:2px 0;line-height:1.65;">${inline(olm[1])}</li>`);
      continue;
    }

    // Blockquote
    const bqm = line.match(/^> (.*)/);
    if (bqm) {
      closeList();
      out.push(`<blockquote style="margin:6px 0;padding:5px 10px 5px 12px;border-left:3px solid ${bqBorder};background:${bqBg};border-radius:0 6px 6px 0;">${inline(bqm[1])}</blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList();
      out.push(`<hr style="border:none;border-top:1px solid ${hrColor};margin:10px 0;"/>`);
      continue;
    }

    // Empty line → small gap
    if (line.trim() === "") {
      closeList();
      out.push(`<div style="height:6px;"></div>`);
      continue;
    }

    // Regular paragraph
    closeList();
    out.push(`<p style="margin:1px 0;line-height:1.65;">${inline(line)}</p>`);
  }

  closeList();
  return out.join("");
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  dark,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  dark: boolean;
}) {
  const [dropOpen, setDropOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  const btnStyle = dark
    ? {
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.75)",
      }
    : {
        background: "rgba(0,0,0,0.04)",
        border: "1px solid rgba(0,0,0,0.12)",
        color: "rgba(0,0,0,0.6)",
      };

  const dropStyle = dark
    ? { background: "#1a1f2e", border: "1px solid rgba(255,255,255,0.1)" }
    : { background: "#ffffff", border: "1px solid rgba(0,0,0,0.1)" };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || models.length === 0}
        onClick={() => setDropOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] transition-colors disabled:opacity-40"
        style={btnStyle}
      >
        <span className="truncate max-w-[180px]">
          {models.length === 0 ? "Загрузка…" : (current?.label ?? "Модель")}
        </span>
        <ChevronDown
          size={13}
          className={["shrink-0 transition-transform", dropOpen ? "rotate-180" : ""].join(" ")}
          style={{ opacity: 0.5 }}
        />
      </button>

      {dropOpen && models.length > 0 && (
        <div
          className="absolute left-0 top-full mt-2 w-64 rounded-2xl shadow-2xl z-50 overflow-hidden"
          style={dropStyle}
        >
          <div className="py-1.5 max-h-72 overflow-y-auto">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setDropOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-left transition-colors"
                style={{
                  color: m.id === value
                    ? "#2563eb"
                    : dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)",
                  background: m.id === value
                    ? dark ? "rgba(37,99,235,0.12)" : "rgba(37,99,235,0.06)"
                    : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (m.id !== value) {
                    (e.currentTarget as HTMLButtonElement).style.background = dark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.04)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (m.id !== value) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }
                }}
              >
                <span className="truncate">{m.label}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {m.supportsVision && (
                    <Eye size={11} style={{ opacity: 0.5, color: "#22c55e" }} />
                  )}
                  {m.id === value && <Check size={13} className="text-blue-600" />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ATTACH_OPTIONS = [
  {
    id: "photo",
    label: "Фото и изображения",
    ext: "jpg, jpeg, png, gif, webp",
    accept: ".jpg,.jpeg,.png,.gif,.webp",
    icon: Image,
    color: "#2563eb",
  },
  {
    id: "doc",
    label: "Документы",
    ext: "pdf, doc, docx, txt, md",
    accept: ".pdf,.doc,.docx,.txt,.md",
    icon: FileText,
    color: "#16a34a",
  },
  {
    id: "table",
    label: "Таблицы",
    ext: "csv",
    accept: ".csv",
    icon: FileSpreadsheet,
    color: "#d97706",
  },
  {
    id: "other",
    label: "Другие файлы",
    ext: "любой формат",
    accept: "*",
    icon: File,
    color: "#6b7280",
  },
];

export function GlobalAiChatWidget() {
  const [open, setOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [contextUsed, setContextUsed] = useState<{ used: number; max: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputAcceptRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track dark mode from HTML class
  useEffect(() => {
    const update = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("orinax:open-ai-chat", openHandler);
    return () => window.removeEventListener("orinax:open-ai-chat", openHandler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close attach menu on outside click
  useEffect(() => {
    if (!attachMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [attachMenuOpen]);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/ai-models?module=${MODULE}`), {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { models: ModelOption[] };
      const list = data.models ?? [];
      setModels(list);
      if (list.length > 0) {
        setSelectedModel((prev) =>
          prev && list.some((m) => m.id === prev) ? prev : list[0].id,
        );
      }
    } catch { /* ignore */ }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { sessions: ChatSession[] };
      setSessions(data.sessions ?? []);
    } catch {
      setError("Не удалось загрузить чаты");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setChatLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/global-ai-chat/sessions/${id}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        session: ChatSession;
        messages: ChatMessage[];
      };
      setActiveId(id);
      setMessages(data.messages ?? []);
      setPendingFiles([]);
      setSelectedModel((prev) => data.session.model ?? prev);
    } catch {
      setError("Не удалось загрузить чат");
    } finally {
      setChatLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveId(null);
    setMessages([]);
    setPendingFiles([]);
    setError(null);
    setSuggestions(getRandomSuggestions(3));
    void loadModels();
    // Load sessions and auto-resume the most recent one
    void (async () => {
      setSessionsLoading(true);
      try {
        const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { sessions: ChatSession[] };
        const list = data.sessions ?? [];
        setSessions(list);
        // Automatically open the most recent session (first in list)
        if (list.length > 0) {
          void loadSession(list[0].id);
        }
      } catch {
        setError("Не удалось загрузить чаты");
      } finally {
        setSessionsLoading(false);
      }
    })();
  }, [open, loadModels, loadSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  // Auto-resize textarea up to 9 rows
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 22;
    const maxHeight = lineHeight * 9 + 8; // 9 rows + padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  const createSession = async () => {
    setError(null);
    const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel || undefined }),
    });
    if (!res.ok) { setError("Не удалось создать чат"); return; }
    const data = (await res.json()) as { session: ChatSession };
    setSessions((prev) => [data.session, ...prev]);
    setActiveId(data.session.id);
    setMessages([]);
    setPendingFiles([]);
    setSuggestions(getRandomSuggestions(3));
    if (data.session.model) setSelectedModel(data.session.model);
  };

  const deleteSession = async (id: string) => {
    await fetch(apiUrl(`/api/global-ai-chat/sessions/${id}`), {
      method: "DELETE",
      credentials: "include",
    });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
      setPendingFiles([]);
      setSuggestions(getRandomSuggestions(3));
    }
  };

  const ensureSession = async (): Promise<string | null> => {
    if (activeId) return activeId;
    const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel || undefined }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { session: ChatSession };
    setSessions((prev) => [data.session, ...prev]);
    setActiveId(data.session.id);
    if (data.session.model) setSelectedModel(data.session.model);
    return data.session.id;
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      const sessionId = await ensureSession();
      if (!sessionId) { setError("Не удалось создать чат"); return; }

      await Promise.all(
        files.map(async (file) => {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch(
            apiUrl(`/api/global-ai-chat/sessions/${sessionId}/files`),
            { method: "POST", credentials: "include", body: form },
          );
          const data = (await res.json()) as {
            file?: { id: string; fileName: string; kind: string; status: string; publicUrl: string | null };
            error?: string;
          };
          if (res.ok && data.file) {
            setPendingFiles((prev) => [
              ...prev,
              {
                fileId: data.file!.id,
                fileName: data.file!.fileName,
                kind: data.file!.kind as "image" | "document",
                url: data.file!.publicUrl,
              },
            ]);
          }
        }),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleAttachSelect = (accept: string) => {
    fileInputAcceptRef.current = accept;
    setAttachMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    // Allow sending with files even without text
    if ((!trimmed && pendingFiles.length === 0) || streaming) return;

    let sessionId = activeId;
    if (!sessionId) {
      const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel }),
      });
      if (!res.ok) { setError("Не удалось создать чат"); return; }
      const data = (await res.json()) as { session: ChatSession };
      sessionId = data.session.id;
      setActiveId(sessionId);
      setSessions((prev) => [data.session, ...prev]);
    }

    const filesToSend = [...pendingFiles];
    const attachmentFileIds = filesToSend.map((f) => f.fileId);

    // When only files are attached with no text, use a neutral prompt
    const effectiveText = trimmed ||
      (filesToSend.some((f) => f.kind === "image") ? "Что изображено на скриншоте?" : "Проанализируй прикреплённый файл.");

    setInput("");
    // Collapse textarea back to 1 row
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
    setPendingFiles([]);
    setStreaming(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: trimmed, // show original (possibly empty) in UI — image preview is enough
      _pendingFiles: filesToSend.length > 0 ? filesToSend : undefined,
    };
    const assistantPlaceholder: ChatMessage = {
      id: `tmp-a-${Date.now()}`,
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(
        apiUrl(`/api/global-ai-chat/sessions/${sessionId}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: effectiveText,
            model: selectedModel,
            attachmentFileIds: attachmentFileIds.length ? attachmentFileIds : undefined,
          }),
          signal: abortRef.current.signal,
        },
      );

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          err.error === "insufficient_balance"
            ? "Недостаточно Credits. Пополните баланс в личном кабинете."
            : (err.error ?? "request_failed"),
        );
        setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholder.id));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("no_stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine) as Record<string, unknown>;
            if (event === "meta" && typeof payload.contextUsedTokens === "number") {
              setContextUsed({ used: payload.contextUsedTokens as number, max: payload.contextMaxTokens as number });
            } else if (event === "token" && typeof payload.content === "string") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholder.id
                    ? { ...m, content: m.content + payload.content }
                    : m,
                ),
              );
            } else if (event === "error") {
              setError(String(payload.error ?? "stream_error"));
            } else if (event === "done") {
              void loadSessions();
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("Ошибка отправки сообщения");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Restore focus to the input so the user can keep typing immediately
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  if (!open) return null;

  // Theme-based colors
  const bg = isDark ? "#080b14" : "#f8fafc";
  const sidebarBg = isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.03)";
  const sidebarBorder = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const textPrimary = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
  const textSecondary = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
  const textMuted = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const hoverBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
  const inputBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const inputBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const msgUserBg = "#2563eb";
  const msgAiBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)";
  const msgAiBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const suggestionBg = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)";
  const suggestionBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const dropdownBg = isDark ? "#1a1f2e" : "#ffffff";

  return (
    <div
      className="fixed inset-0 z-[9999] flex"
      style={{ background: bg }}
    >
      {/* Stars — dark mode only */}
      {isDark && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          aria-hidden="true"
          style={{
            backgroundImage: `
              radial-gradient(1px 1px at 8% 12%, rgba(255,255,255,0.4) 0%, transparent 100%),
              radial-gradient(1px 1px at 22% 38%, rgba(255,255,255,0.25) 0%, transparent 100%),
              radial-gradient(1.5px 1.5px at 38% 8%, rgba(255,255,255,0.35) 0%, transparent 100%),
              radial-gradient(1px 1px at 52% 68%, rgba(255,255,255,0.3) 0%, transparent 100%),
              radial-gradient(1px 1px at 63% 22%, rgba(255,255,255,0.25) 0%, transparent 100%),
              radial-gradient(1.5px 1.5px at 74% 52%, rgba(255,255,255,0.35) 0%, transparent 100%),
              radial-gradient(1px 1px at 84% 14%, rgba(255,255,255,0.3) 0%, transparent 100%),
              radial-gradient(1px 1px at 91% 78%, rgba(255,255,255,0.25) 0%, transparent 100%),
              radial-gradient(1px 1px at 14% 83%, rgba(255,255,255,0.35) 0%, transparent 100%),
              radial-gradient(1.5px 1.5px at 33% 58%, rgba(255,255,255,0.2) 0%, transparent 100%),
              radial-gradient(1px 1px at 48% 92%, rgba(255,255,255,0.3) 0%, transparent 100%),
              radial-gradient(1px 1px at 67% 43%, rgba(255,255,255,0.25) 0%, transparent 100%),
              radial-gradient(1px 1px at 79% 33%, rgba(255,255,255,0.35) 0%, transparent 100%),
              radial-gradient(1px 1px at 4% 52%, rgba(255,255,255,0.25) 0%, transparent 100%),
              radial-gradient(1px 1px at 96% 42%, rgba(255,255,255,0.3) 0%, transparent 100%),
              radial-gradient(2px 2px at 17% 27%, rgba(37,99,235,0.3) 0%, transparent 100%),
              radial-gradient(2px 2px at 58% 15%, rgba(37,99,235,0.2) 0%, transparent 100%),
              radial-gradient(2px 2px at 88% 62%, rgba(37,99,235,0.25) 0%, transparent 100%)
            `,
          }}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside
        className="hidden sm:flex w-[240px] shrink-0 flex-col min-h-0"
        style={{
          background: sidebarBg,
          borderRight: `1px solid ${sidebarBorder}`,
        }}
      >
        {/* New chat button */}
        <div className="px-3 pt-4 pb-2">
          <button
            type="button"
            onClick={() => void createSession()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors w-full"
            style={{ color: textSecondary }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
              (e.currentTarget as HTMLButtonElement).style.color = textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
            }}
          >
            <Plus size={13} strokeWidth={2.5} />
            Новый чат
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0 space-y-px">
          {sessionsLoading ? (
            <SectionSpinner dark={isDark} />
          ) : sessions.length === 0 ? (
            <p className="text-xs px-3 py-6 text-center" style={{ color: textMuted }}>
              Нет чатов
            </p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition-colors"
                style={{
                  background: activeId === s.id ? hoverBg : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (activeId !== s.id) {
                    (e.currentTarget as HTMLDivElement).style.background = hoverBg;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeId !== s.id) {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }
                }}
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                  onClick={() => void loadSession(s.id)}
                >
                  <span
                    className="text-[12.5px] truncate leading-tight"
                    style={{ color: textSecondary }}
                  >
                    {s.title}
                  </span>
                </button>
                <button
                  type="button"
                  title="Удалить"
                  onClick={() => void deleteSession(s.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 transition-all shrink-0"
                  style={{ color: textMuted }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = textMuted;
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">

        {/* Top bar */}
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${borderColor}` }}
        >
          <ModelPicker
            models={models}
            value={selectedModel}
            onChange={setSelectedModel}
            disabled={streaming}
            dark={isDark}
          />

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] transition-colors"
            style={{ color: textSecondary, border: `1px solid transparent` }}
            aria-label="Закрыть"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
              (e.currentTarget as HTMLButtonElement).style.borderColor = borderColor;
              (e.currentTarget as HTMLButtonElement).style.color = textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
            }}
          >
            <X size={16} />
            <span className="hidden sm:inline">Закрыть</span>
          </button>
        </header>

        {/* Messages or welcome */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          {chatLoading ? (
            <div className="flex items-center justify-center h-full">
              <SectionSpinner dark={isDark} />
            </div>
          ) : messages.length === 0 ? (
            /* Welcome */
            <div className="flex flex-col items-center justify-center h-full px-6 pb-24">
              <h1
                className="text-3xl sm:text-4xl font-semibold mb-8 text-center tracking-tight"
                style={{ color: textPrimary }}
              >
                С чего начнём?
              </h1>

              <div className="flex flex-col gap-2.5 w-full max-w-lg">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl text-[13.5px] text-left transition-all"
                    style={{
                      background: suggestionBg,
                      border: `1px solid ${suggestionBorder}`,
                      color: textSecondary,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
                      (e.currentTarget as HTMLButtonElement).style.color = textPrimary;
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#2563eb40";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = suggestionBg;
                      (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
                      (e.currentTarget as HTMLButtonElement).style.borderColor = suggestionBorder;
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "#2563eb", opacity: 0.7 }}
                    />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Chat */
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={["flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}
                >
                  <div
                    className="max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                    style={
                      m.role === "user"
                        ? { background: msgUserBg, color: "#ffffff", borderRadius: "18px 18px 4px 18px" }
                        : { background: msgAiBg, border: `1px solid ${msgAiBorder}`, color: textPrimary, borderRadius: "18px 18px 18px 4px" }
                    }
                  >
                    {m.role === "user" && m._pendingFiles?.some((f) => f.kind === "image") && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {m._pendingFiles
                          .filter((f) => f.kind === "image" && f.url)
                          .map((f) => (
                            <img
                              key={f.fileId}
                              src={f.url!}
                              alt={f.fileName}
                              className="max-h-44 max-w-[260px] rounded-xl object-cover"
                            />
                          ))}
                      </div>
                    )}

                    {m.role === "user" && m._pendingFiles?.some((f) => f.kind === "document") && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {m._pendingFiles
                          .filter((f) => f.kind === "document")
                          .map((f) => (
                            <span
                              key={f.fileId}
                              className="inline-flex items-center gap-1 text-[11px] bg-white/20 rounded-lg px-2 py-0.5"
                            >
                              <FileText size={10} />
                              {f.fileName}
                            </span>
                          ))}
                      </div>
                    )}

                    {m.role === "assistant" && !m.content && streaming ? (
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ color: textSecondary }}
                      >
                        <Loader2 size={13} className="animate-spin" />
                        Думаю…
                      </span>
                    ) : m.content ? (
                      <span
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content, isDark) }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}

              {error && (
                <div
                  className="text-[12px] rounded-xl px-4 py-2.5"
                  style={{
                    color: "#ef4444",
                    background: isDark ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.06)",
                    border: `1px solid rgba(239,68,68,0.2)`,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 px-4 pb-5 pt-2">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            {/* Vision warning: image attached but model doesn't support it */}
            {pendingFiles.some((f) => f.kind === "image") &&
              !models.find((m) => m.id === selectedModel)?.supportsVision && (
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 text-[12px]"
                style={{
                  background: isDark ? "rgba(234,179,8,0.08)" : "rgba(234,179,8,0.08)",
                  border: "1px solid rgba(234,179,8,0.25)",
                  color: isDark ? "#fbbf24" : "#b45309",
                }}
              >
                <Eye size={13} style={{ flexShrink: 0 }} />
                Текущая модель не видит изображения. Выберите GPT-4o, Gemini или Claude для анализа скриншотов.
              </div>
            )}
            {/* Pending files */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 px-1">
                {pendingFiles.map((f) => (
                  <div key={f.fileId} className="relative group">
                    {f.kind === "image" && f.url ? (
                      <img
                        src={f.url}
                        alt={f.fileName}
                        className="h-14 w-14 rounded-xl object-cover"
                        style={{ border: `1px solid ${borderColor}` }}
                      />
                    ) : (
                      <div
                        className="h-14 px-2 rounded-xl flex items-center gap-1.5 max-w-[130px]"
                        style={{ background: inputBg, border: `1px solid ${borderColor}` }}
                      >
                        <FileText size={13} style={{ color: textMuted, flexShrink: 0 }} />
                        <span className="text-[11px] truncate" style={{ color: textSecondary }}>
                          {f.fileName}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((x) => x.fileId !== f.fileId))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input box */}
            <div
              className="flex items-end gap-2 rounded-2xl px-3 py-2.5 transition-colors"
              style={{
                background: inputBg,
                border: `1px solid ${inputBorder}`,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void handleFileUpload(e)}
              />

              {/* Attach button with dropdown */}
              <div ref={attachMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={uploading || streaming}
                  onClick={() => setAttachMenuOpen((p) => !p)}
                  className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
                  style={{ color: attachMenuOpen ? "#2563eb" : textSecondary }}
                  title="Прикрепить файл"
                  onMouseEnter={(e) => {
                    if (!attachMenuOpen)
                      (e.currentTarget as HTMLButtonElement).style.color = textPrimary;
                  }}
                  onMouseLeave={(e) => {
                    if (!attachMenuOpen)
                      (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
                  }}
                >
                  {uploading ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Paperclip size={17} />
                  )}
                </button>

                {attachMenuOpen && (
                  <div
                    className="absolute bottom-full mb-2 left-0 rounded-2xl shadow-xl z-50 overflow-hidden w-56"
                    style={{
                      background: dropdownBg,
                      border: `1px solid ${borderColor}`,
                    }}
                  >
                    {ATTACH_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleAttachSelect(opt.accept)}
                          className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                          style={{ color: textPrimary }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          }}
                        >
                          <Icon size={16} style={{ color: opt.color, flexShrink: 0, marginTop: 1 }} />
                          <div>
                            <div className="text-[13px] font-medium leading-tight">{opt.label}</div>
                            <div className="text-[11px] leading-tight mt-0.5" style={{ color: textMuted }}>
                              {opt.ext}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(input);
                  }
                }}
                placeholder="Напишите сообщение…"
                rows={1}
                disabled={streaming}
                className="flex-1 resize-none min-h-[28px] bg-transparent text-[14px] focus:outline-none leading-relaxed py-0.5"
                style={{
                  color: textPrimary,
                  overflowY: "hidden",
                  scrollbarWidth: "thin",
                }}
              />

              <button
                type="submit"
                disabled={(!input.trim() && pendingFiles.length === 0) || streaming}
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
                style={{
                  background: (input.trim() || pendingFiles.length > 0) && !streaming ? "#2563eb" : (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"),
                }}
              >
                <Send size={14} style={{ color: (input.trim() || pendingFiles.length > 0) && !streaming ? "#fff" : textMuted }} />
              </button>
            </div>

            <div className="flex items-center justify-between mt-1.5 px-0.5">
              {contextUsed && contextUsed.max > 0 ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="relative h-1 w-20 rounded-full overflow-hidden" style={{ background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.round(contextUsed.used / contextUsed.max * 100))}%`,
                        background: contextUsed.used / contextUsed.max > 0.85 ? "#f59e0b" : "#3b82f6",
                      }}
                    />
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: textMuted }}>
                    {Math.round(contextUsed.used / contextUsed.max * 100)}% контекста
                  </span>
                </div>
              ) : <span />}
              <p
                className="text-[11px]"
                style={{ color: textMuted }}
              >
                ИИ может допускать ошибки
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GlobalAiChatWidget;
