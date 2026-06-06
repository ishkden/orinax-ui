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
  Sparkles,
  Trash2,
  MessageSquare,
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

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  metadata?: { attachmentFileIds?: string[] } | null;
}

interface ChatFile {
  id: string;
  fileName: string;
  kind: string;
  status: string;
  publicUrl: string | null;
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
    .replace(/```([\s\S]*?)```/g, "<pre class=\"my-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-xs overflow-x-auto\"><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code class=\"px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs\">$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

export function GlobalAiChatWidget() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [contextUsed, setContextUsed] = useState(0);
  const [contextMax, setContextMax] = useState(128000);
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
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
    const res = await fetch(apiUrl(`/api/ai-models?module=${MODULE}`), {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { models: ModelOption[] };
    setModels(data.models ?? []);
    if (data.models?.[0] && !selectedModel) {
      setSelectedModel(data.models[0].id);
    }
  }, [selectedModel]);

  const loadBalance = useCallback(async () => {
    const res = await fetch(apiUrl("/api/global-ai-chat/balance"), {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { balance: number };
    setBalance(data.balance);
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
        files: ChatFile[];
      };
      setActiveId(id);
      setMessages(data.messages ?? []);
      setFiles(data.files ?? []);
      setSelectedModel(data.session.model ?? selectedModel);
      setContextUsed(data.session.contextUsedTokens ?? 0);
      setContextMax(data.session.contextMaxTokens ?? 128000);
    } catch {
      setError("Не удалось загрузить чат");
    } finally {
      setChatLoading(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (!open) return;
    void loadModels();
    void loadBalance();
    void loadSessions();
  }, [open, loadModels, loadBalance, loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const createSession = async () => {
    setError(null);
    const res = await fetch(apiUrl("/api/global-ai-chat/sessions"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel || undefined }),
    });
    if (!res.ok) {
      setError("Не удалось создать чат");
      return;
    }
    const data = (await res.json()) as { session: ChatSession };
    setSessions((prev) => [data.session, ...prev]);
    setActiveId(data.session.id);
    setMessages([]);
    setFiles([]);
    setPendingAttachments([]);
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
      setFiles([]);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeId) return;

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl(`/api/global-ai-chat/sessions/${activeId}/files`), {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = (await res.json()) as { file?: ChatFile; error?: string };
      if (!res.ok) {
        setError(data.error ?? "upload_failed");
        return;
      }
      if (data.file) {
        setFiles((prev) => [data.file as ChatFile, ...prev]);
        if (data.file.kind === "image") {
          setPendingAttachments((prev) => [...prev, data.file!.id]);
        }
      }
      await loadSession(activeId);
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
      if (!res.ok) {
        setError("Не удалось создать чат");
        return;
      }
      const data = (await res.json()) as { session: ChatSession };
      sessionId = data.session.id;
      setActiveId(sessionId);
      setSessions((prev) => [data.session, ...prev]);
    }

    setInput("");
    setStreaming(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: trimmed,
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
            attachmentFileIds: pendingAttachments.length ? pendingAttachments : undefined,
          }),
          signal: abortRef.current.signal,
        },
      );

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (err.error === "insufficient_balance") {
          setError("Недостаточно Credits. Пополните баланс в личном кабинете.");
        } else {
          setError(err.error ?? "request_failed");
        }
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
              if (typeof payload.contextUsedTokens === "number") {
                setContextUsed(payload.contextUsedTokens);
              }
              if (typeof payload.contextMaxTokens === "number") {
                setContextMax(payload.contextMaxTokens);
              }
            } else if (event === "error") {
              setError(String(payload.error ?? "stream_error"));
            } else if (event === "done") {
              void loadSessions();
              void loadBalance();
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }

      setPendingAttachments([]);
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

  const contextPct = contextMax > 0 ? Math.min(100, Math.round((contextUsed / contextMax) * 100)) : 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Закрыть"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-[1100px] h-[min(88vh,820px)] bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden sm:flex w-[260px] shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#111113]">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void createSession()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              Новый чат
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessionsLoading ? (
              <SectionSpinner />
            ) : sessions.length === 0 ? (
              <p className="text-xs text-zinc-500 px-2 py-4 text-center">Пока нет чатов</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={[
                    "group flex items-start gap-1 rounded-lg px-2 py-2 cursor-pointer transition-colors",
                    activeId === s.id
                      ? "bg-white dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700"
                      : "hover:bg-white/80 dark:hover:bg-zinc-800/60",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => void loadSession(s.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <MessageSquare size={13} className="text-zinc-400 shrink-0" />
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100 truncate">
                        {s.title}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 mt-0.5 block truncate">
                      {new Date(s.updatedAt).toLocaleString("ru-RU")}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Удалить"
                    onClick={() => void deleteSession(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0">
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">AI Чат</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {balance != null ? `${balance.toLocaleString("ru-RU")} Credits` : "…"}
                {" · "}
                контекст {contextPct}%
              </p>
            </div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 max-w-[180px] truncate"
              disabled={streaming}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X size={18} />
            </button>
          </header>

          {/* Context bar */}
          <div className="px-4 py-1.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  contextPct > 85 ? "bg-amber-500" : "bg-violet-500",
                ].join(" ")}
                style={{ width: `${contextPct}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              ~{contextUsed.toLocaleString("ru-RU")} / {contextMax.toLocaleString("ru-RU")} токенов
            </p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {chatLoading ? (
              <SectionSpinner />
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-sm">
                Начните беседу — выберите модель и напишите сообщение
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={["flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-violet-600 text-white rounded-br-md"
                        : "bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-bl-md",
                    ].join(" ")}
                  >
                    {m.role === "assistant" && !m.content && streaming ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-500">
                        <Loader2 size={13} className="animate-spin" />
                        Думаю…
                      </span>
                    ) : (
                      <span
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                      />
                    )}
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

          {files.length > 0 && (
            <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-2 shrink-0">
              {files.slice(0, 8).map((f) => (
                <span
                  key={f.id}
                  className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  title={f.status}
                >
                  {f.fileName}
                  {f.status === "indexing" ? " …" : ""}
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2.5 shrink-0"
          >
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
                disabled={!activeId || uploading}
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 w-9 h-9 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center disabled:opacity-40"
                title="Прикрепить файл"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
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
                className="flex-1 resize-none max-h-32 min-h-[36px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-[13.5px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
              />
              <button
                type="submit"
                disabled={!input.trim() || streaming}
                className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 text-white disabled:opacity-40 flex items-center justify-center"
              >
                <Send size={15} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GlobalAiChatWidget;
