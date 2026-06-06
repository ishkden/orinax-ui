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
  MessageSquare,
  FileText,
  ChevronDown,
  Check,
  Mic,
  Image,
  PenLine,
  Search,
} from "lucide-react";

const ANALYTICS_HOSTS = new Set([
  "my.orinax.ai",
  "analytics.orinax.ai",
  "localhost",
  "127.0.0.1",
]);

const MODULE = "global-ai-chat";

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

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <svg
        className="animate-spin text-zinc-500"
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

function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(
      /```([\s\S]*?)```/g,
      '<pre class="my-2 p-3 rounded-xl bg-black/30 text-xs overflow-x-auto border border-white/10"><code>$1</code></pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1 py-0.5 rounded bg-black/30 text-xs border border-white/10">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
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

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || models.length === 0}
        onClick={() => setDropOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-[13px] text-white/80 hover:text-white transition-colors disabled:opacity-40 border border-white/10"
      >
        <span className="truncate max-w-[180px]">
          {models.length === 0 ? "Загрузка…" : (current?.label ?? "Модель")}
        </span>
        <ChevronDown
          size={13}
          className={[
            "shrink-0 text-white/50 transition-transform",
            dropOpen ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {dropOpen && models.length > 0 && (
        <div className="absolute left-0 top-full mt-2 w-64 rounded-2xl border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden">
          <div className="py-1.5 max-h-72 overflow-y-auto">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setDropOpen(false); }}
                className={[
                  "w-full flex items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-left transition-colors",
                  m.id === value
                    ? "text-white bg-white/10"
                    : "text-white/70 hover:text-white hover:bg-white/5",
                ].join(" ")}
              >
                <span className="truncate">{m.label}</span>
                {m.id === value && (
                  <Check size={13} className="shrink-0 text-blue-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GlobalAiChatWidget() {
  const [open, setOpen] = useState(false);
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

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
    } catch {
      /* cross-origin or network error */
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("load_sessions_failed");
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
      if (!res.ok) throw new Error("load_session_failed");
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
    void loadModels();
    void loadSessions();
  }, [open, loadModels, loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

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
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const sessionId = await ensureSession();
      if (!sessionId) { setError("Не удалось создать чат"); return; }

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
      if (!res.ok) { setError(data.error ?? "upload_failed"); return; }
      if (data.file) {
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
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

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

    setInput("");
    setPendingFiles([]);
    setStreaming(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: trimmed,
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
            message: trimmed,
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
            if (event === "token" && typeof payload.content === "string") {
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
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handleQuickAction = (text: string) => {
    setInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  if (!open) return null;

  const hasMessages = messages.length > 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex"
      style={{
        background: "radial-gradient(ellipse at 20% 50%, #1a1a3e 0%, #0d0d1a 40%, #050508 100%)",
      }}
    >
      {/* Star particles */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        style={{
          backgroundImage: `
            radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,0.35) 0%, transparent 100%),
            radial-gradient(1px 1px at 25% 40%, rgba(255,255,255,0.2) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 40% 10%, rgba(255,255,255,0.3) 0%, transparent 100%),
            radial-gradient(1px 1px at 55% 70%, rgba(255,255,255,0.25) 0%, transparent 100%),
            radial-gradient(1px 1px at 65% 25%, rgba(255,255,255,0.2) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 75% 55%, rgba(255,255,255,0.3) 0%, transparent 100%),
            radial-gradient(1px 1px at 85% 15%, rgba(255,255,255,0.25) 0%, transparent 100%),
            radial-gradient(1px 1px at 90% 80%, rgba(255,255,255,0.2) 0%, transparent 100%),
            radial-gradient(1px 1px at 15% 85%, rgba(255,255,255,0.3) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 35% 60%, rgba(255,255,255,0.15) 0%, transparent 100%),
            radial-gradient(1px 1px at 50% 90%, rgba(255,255,255,0.25) 0%, transparent 100%),
            radial-gradient(1px 1px at 70% 45%, rgba(255,255,255,0.2) 0%, transparent 100%),
            radial-gradient(1px 1px at 80% 35%, rgba(255,255,255,0.3) 0%, transparent 100%),
            radial-gradient(1.5px 1.5px at 5% 55%, rgba(255,255,255,0.2) 0%, transparent 100%),
            radial-gradient(1px 1px at 95% 45%, rgba(255,255,255,0.25) 0%, transparent 100%)
          `,
        }}
      />

      {/* ── Left Sidebar ─────────────────────────────────────── */}
      <aside
        className="hidden sm:flex w-[260px] shrink-0 flex-col border-r min-h-0"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.3)",
        }}
      >
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              <MessageSquare size={14} className="text-white" />
            </div>
            <span className="text-white font-semibold text-[15px]">Orinax AI</span>
          </div>

          <button
            type="button"
            onClick={() => void createSession()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-white/70 hover:text-white hover:bg-white/10 transition-colors border border-white/10 hover:border-white/20"
          >
            <Plus size={14} />
            Новый чат
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0 space-y-px">
          {sessionsLoading ? (
            <SectionSpinner />
          ) : sessions.length === 0 ? (
            <p className="text-xs text-white/30 px-3 py-6 text-center">Нет чатов</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={[
                  "group flex items-center gap-1 rounded-xl px-2 py-2 cursor-pointer transition-colors",
                  activeId === s.id
                    ? "bg-white/15"
                    : "hover:bg-white/8",
                ].join(" ")}
                style={activeId !== s.id ? {} : {}}
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                  onClick={() => void loadSession(s.id)}
                >
                  <MessageSquare
                    size={12}
                    className="text-white/40 shrink-0"
                  />
                  <span className="text-[12.5px] text-white/75 truncate leading-tight">
                    {s.title}
                  </span>
                </button>
                <button
                  type="button"
                  title="Удалить"
                  onClick={() => void deleteSession(s.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 transition-all shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">

        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3.5 shrink-0">
          <ModelPicker
            models={models}
            value={selectedModel}
            onChange={setSelectedModel}
            disabled={streaming}
          />

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] text-white/50 hover:text-white hover:bg-white/10 transition-colors border border-transparent hover:border-white/10"
            aria-label="Закрыть"
          >
            <X size={16} />
            <span className="hidden sm:inline">Закрыть</span>
          </button>
        </header>

        {/* Messages or welcome screen */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-0"
        >
          {chatLoading ? (
            <div className="flex items-center justify-center h-full">
              <SectionSpinner />
            </div>
          ) : !hasMessages ? (
            /* ── Welcome Screen ── */
            <div className="flex flex-col items-center justify-center h-full px-6 pb-24">
              <h1 className="text-white text-3xl sm:text-4xl font-semibold mb-10 text-center tracking-tight">
                С чего начнём?
              </h1>

              {/* Quick action cards */}
              <div className="flex flex-wrap gap-3 justify-center max-w-xl">
                <button
                  type="button"
                  onClick={() => handleQuickAction("Создай изображение: ")}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-[13px] text-white/80 hover:text-white transition-all border border-white/10 hover:border-white/20 hover:bg-white/8 backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <Image size={15} className="text-purple-400 shrink-0" />
                  Создать изображение
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAction("Помоги написать или отредактировать: ")}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-[13px] text-white/80 hover:text-white transition-all border border-white/10 hover:border-white/20 hover:bg-white/8 backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <PenLine size={15} className="text-emerald-400 shrink-0" />
                  Напиши или отредактируй
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAction("Найди информацию о: ")}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-[13px] text-white/80 hover:text-white transition-all border border-white/10 hover:border-white/20 hover:bg-white/8 backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <Search size={15} className="text-blue-400 shrink-0" />
                  Найди что-то
                </button>
              </div>
            </div>
          ) : (
            /* ── Chat Messages ── */
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed",
                      m.role === "user"
                        ? "text-white rounded-br-md"
                        : "text-white/90 rounded-bl-md",
                    ].join(" ")}
                    style={
                      m.role === "user"
                        ? { background: "rgba(99,102,241,0.7)", backdropFilter: "blur(8px)" }
                        : { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }
                    }
                  >
                    {m.role === "user" &&
                      m._pendingFiles?.some((f) => f.kind === "image") && (
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

                    {m.role === "user" &&
                      m._pendingFiles?.some((f) => f.kind === "document") && (
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
                      <span className="inline-flex items-center gap-1.5 text-white/50">
                        <Loader2 size={13} className="animate-spin" />
                        Думаю…
                      </span>
                    ) : m.content ? (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(m.content),
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}

              {error && (
                <div className="text-[12px] text-red-400 bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-2.5">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Input Area ─────────────────────────────────────── */}
        <div className="shrink-0 px-4 pb-6 pt-2">
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto"
          >
            {/* Pending attachments */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 px-1">
                {pendingFiles.map((f) => (
                  <div key={f.fileId} className="relative group">
                    {f.kind === "image" && f.url ? (
                      <img
                        src={f.url}
                        alt={f.fileName}
                        className="h-14 w-14 rounded-xl object-cover ring-1 ring-white/20"
                      />
                    ) : (
                      <div
                        className="h-14 px-2 rounded-xl flex items-center gap-1.5 max-w-[130px] border border-white/10"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      >
                        <FileText size={13} className="text-white/40 shrink-0" />
                        <span className="text-[11px] text-white/60 truncate">
                          {f.fileName}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) =>
                          prev.filter((x) => x.fileId !== f.fileId),
                        )
                      }
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input box */}
            <div
              className="flex items-end gap-2 rounded-2xl px-3 py-2.5 border border-white/15 hover:border-white/25 transition-colors"
              style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(12px)" }}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp"
                onChange={(e) => void handleFileUpload(e)}
              />

              <button
                type="button"
                disabled={uploading || streaming}
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 p-1.5 rounded-lg text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
                title="Прикрепить файл"
              >
                {uploading ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Paperclip size={17} />
                )}
              </button>

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
                className="flex-1 resize-none max-h-40 min-h-[28px] bg-transparent text-[14px] text-white placeholder:text-white/30 focus:outline-none leading-relaxed py-0.5"
                style={{ scrollbarWidth: "none" }}
              />

              <button
                type="button"
                disabled={streaming}
                className="shrink-0 p-1.5 rounded-lg text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
                title="Голосовой ввод"
              >
                <Mic size={17} />
              </button>

              <button
                type="submit"
                disabled={!input.trim() || streaming}
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
                style={{
                  background: input.trim() && !streaming
                    ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                    : "rgba(255,255,255,0.15)",
                }}
              >
                <Send size={14} className="text-white" />
              </button>
            </div>

            <p className="text-center text-[11px] text-white/20 mt-2.5">
              ИИ может допускать ошибки. Проверяйте важную информацию.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GlobalAiChatWidget;
