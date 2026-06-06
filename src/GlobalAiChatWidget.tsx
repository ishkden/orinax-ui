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
  /** Display-only attachment previews (not persisted). */
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
        className="animate-spin text-slate-400"
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
      '<pre class="my-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-xs overflow-x-auto"><code>$1</code></pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
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
  const [contextUsed, setContextUsed] = useState(0);
  const [contextMax, setContextMax] = useState(128000);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setContextUsed(data.session.contextUsedTokens ?? 0);
      setContextMax(data.session.contextMaxTokens ?? 128000);
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
    setContextUsed(0);
    void loadModels();
    void loadSessions();
  }, [open, loadModels, loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

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

  const handleAttachClick = () => {
    fileInputRef.current?.click();
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
            } else if (event === "meta") {
              if (typeof payload.contextUsedTokens === "number")
                setContextUsed(payload.contextUsedTokens);
              if (typeof payload.contextMaxTokens === "number")
                setContextMax(payload.contextMaxTokens);
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

  const contextPct =
    contextMax > 0 ? Math.min(100, Math.round((contextUsed / contextMax) * 100)) : 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Закрыть"
        onClick={() => setOpen(false)}
      />

      <div className="relative w-full max-w-[1100px] h-[min(88vh,820px)] bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 flex min-h-0">

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside className="hidden sm:flex w-[220px] shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#111113] min-h-0 overflow-hidden rounded-l-2xl">
          <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void createSession()}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <Plus size={13} />
              Новый чат
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-px">
            {sessionsLoading ? (
              <SectionSpinner />
            ) : sessions.length === 0 ? (
              <p className="text-xs text-zinc-400 px-2 py-4 text-center">Нет чатов</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={[
                    "group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition-colors",
                    activeId === s.id
                      ? "bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700"
                      : "hover:bg-white/70 dark:hover:bg-zinc-800/50",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left flex items-center gap-1.5"
                    onClick={() => void loadSession(s.id)}
                  >
                    <MessageSquare
                      size={11}
                      className="text-zinc-400 shrink-0"
                    />
                    <span className="text-[12.5px] text-zinc-700 dark:text-zinc-200 truncate leading-tight">
                      {s.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Удалить"
                    onClick={() => void deleteSession(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── Main pane ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

          {/* Header */}
          <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="flex-1" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 max-w-[200px] shrink-0 text-zinc-700 dark:text-zinc-300"
              disabled={streaming || models.length === 0}
            >
              {models.length === 0 ? (
                <option value="">Загрузка…</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))
              )}
            </select>

            {/* Context mini-bar */}
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <div className="w-14 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={[
                    "h-full rounded-full transition-all",
                    contextPct > 85 ? "bg-amber-500" : "bg-blue-500",
                  ].join(" ")}
                  style={{ width: `${Math.max(contextPct, 1)}%` }}
                />
              </div>
              <span className="text-[11px] text-zinc-400 tabular-nums w-7">
                {contextPct}%
              </span>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </header>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
          >
            {chatLoading ? (
              <SectionSpinner />
            ) : messages.length === 0 ? (
              <div className="text-center py-14 text-zinc-400 text-sm">
                Выберите модель и начните беседу
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-br-md"
                        : "bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-bl-md",
                    ].join(" ")}
                  >
                    {/* Image attachments in user bubble */}
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

                    {/* Document attachments in user bubble */}
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

                    {/* Message content */}
                    {m.role === "assistant" && !m.content && streaming ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-500">
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
              ))
            )}

            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Input area */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2.5 shrink-0"
          >
            {/* Pending attachments preview */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingFiles.map((f) => (
                  <div key={f.fileId} className="relative group">
                    {f.kind === "image" && f.url ? (
                      <img
                        src={f.url}
                        alt={f.fileName}
                        className="h-14 w-14 rounded-xl object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
                      />
                    ) : (
                      <div className="h-14 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 flex items-center gap-1.5 max-w-[130px]">
                        <FileText size={13} className="text-zinc-400 shrink-0" />
                        <span className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
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
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900/75 dark:bg-zinc-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
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
                onClick={handleAttachClick}
                className="shrink-0 w-8 h-8 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center disabled:opacity-40 transition-colors"
                title="Прикрепить файл"
              >
                {uploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Paperclip size={14} />
                )}
              </button>

              <textarea
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
                className="flex-1 resize-none max-h-32 min-h-[36px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-[13.5px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />

              <button
                type="submit"
                disabled={!input.trim() || streaming}
                className="shrink-0 w-8 h-8 rounded-xl bg-blue-600 text-white disabled:opacity-40 flex items-center justify-center hover:bg-blue-700 transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GlobalAiChatWidget;
