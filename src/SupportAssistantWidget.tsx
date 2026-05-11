"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bot,
  Send,
  X,
  RefreshCw,
  BookOpen,
  Loader2,
} from "lucide-react";

/**
 * Orinax Support Assistant Widget
 * --------------------------------
 * Плавающий чат-виджет, доступный с любой страницы экосистемы Orinax.
 *
 * Архитектура:
 *  - API живёт на `my.orinax.ai` (`/api/support-assistant`).
 *  - С прочих сабдоменов (`crm.orinax.ai`, `connector.orinax.ai`,
 *    `mail.orinax.ai`) виджет ходит туда напрямую через CORS+credentials.
 *  - Открывается событием `window.dispatchEvent(new Event("orinax:open-support"))`
 *    или императивно через `<SupportAssistantWidget defaultOpen />`.
 *
 * UX:
 *  - Кнопка "?" в `<GlobalHeader/>` диспатчит событие → виджет открывается.
 *  - История ответа — sessionStorage, очищается на закрытии вкладки.
 *  - Streaming-ответ через ReadableStream → плавная подача текста.
 */

const STORAGE_KEY = "orinax_support_history_v2";
/** Максимум сообщений в истории (5 обменов = достаточно контекста без раздувания) */
const MAX_HISTORY = 10;
/**
 * TTL контекста — 10 минут бездействия.
 * Согласовано с временем жизни prompt-кеша OpenAI/OpenRouter (~5 мин):
 * когда кеш протухает, платить за системный промпт всё равно полную цену,
 * поэтому держать старую историю смысла нет — лучше начать чисто.
 * savedAt обновляется при каждом новом сообщении, то есть это TTL бездействия.
 */
const SESSION_TTL_MS = 10 * 60 * 1000;

const ANALYTICS_HOSTS = new Set([
  "my.orinax.ai",
  "analytics.orinax.ai",
  "localhost",
  "127.0.0.1",
]);

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PageContext {
  hostname?: string;
  pathname?: string;
  href?: string;
  title?: string;
  hint?: string;
}

interface QuickPrompt {
  label: string;
  query: string;
}

export interface SupportAssistantWidgetProps {
  /** Override API URL (default: автоопределение по hostname). */
  apiUrl?: string;
  /** Открывать сразу при монтировании (для тестов / встроенного режима). */
  defaultOpen?: boolean;
}

function getApiUrl(override?: string): string {
  if (override) return override;
  if (typeof window === "undefined") return "/api/support-assistant";
  const host = window.location.hostname;
  if (ANALYTICS_HOSTS.has(host)) return "/api/support-assistant";
  return "https://my.orinax.ai/api/support-assistant";
}

function getPageContext(): PageContext {
  if (typeof window === "undefined") return {};
  return {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    href: window.location.href,
    title: document.title,
    hint: document.body?.dataset?.assistantHint || undefined,
  };
}

/** Контекстные подсказки от текущего раздела. */
function buildQuickPrompts(ctx: PageContext): QuickPrompt[] {
  const path = ctx.pathname || "";
  if (path.startsWith("/dashboard/telephony") || path.startsWith("/admin/telephony")) {
    return [
      { label: "Как купить номер?", query: "Как купить новый телефонный номер?" },
      { label: "Что такое KYC?", query: "Зачем нужна KYC-верификация для телефонии и как её пройти?" },
      { label: "Настроить IVR", query: "Как настроить IVR-меню для входящих звонков?" },
      { label: "Пополнить баланс", query: "Как пополнить баланс телефонии?" },
    ];
  }
  if (path.includes("/ai-calls") || path.includes("/ai-automation")) {
    return [
      { label: "Что такое AI-агент?", query: "Что такое AI-агент в Orinax и какие они бывают?" },
      { label: "Запустить AI-звонок", query: "Как запустить AI-звонок клиенту?" },
      { label: "Клонировать голос", query: "Как клонировать голос для AI-звонков?" },
      { label: "Workspace AI-агента", query: "Что такое workspace AI-агента и как его создать?" },
    ];
  }
  if (path.includes("/deals") || path.includes("/crm/deals")) {
    return [
      { label: "Создать сделку", query: "Как создать новую сделку?" },
      { label: "Канбан-доска", query: "Как пользоваться канбан-доской сделок?" },
      { label: "Кастомные поля", query: "Как добавить пользовательские поля для сделок?" },
      { label: "AI-чат по сделке", query: "Как использовать AI-чат внутри карточки сделки?" },
    ];
  }
  if (path.includes("/connector") || path.includes("/integrations")) {
    return [
      { label: "Подключить WhatsApp", query: "Как подключить WhatsApp через QR-код?" },
      { label: "Подключить Telegram", query: "Как подключить Telegram по номеру телефона?" },
      { label: "Каналы и линии", query: "Что такое каналы и линии в коннекторе?" },
    ];
  }
  if (path.startsWith("/mail")) {
    return [
      { label: "Подключить почту", query: "Как подключить ящик к Orinax Mail?" },
      { label: "Настроить домен", query: "Как настроить SPF/DKIM для своего домена?" },
    ];
  }
  // Default landing
  return [
    { label: "С чего начать?", query: "Я только зашёл в Orinax, с чего лучше начать?" },
    { label: "Что такое CRM?", query: "Что я могу делать в разделе CRM?" },
    { label: "AI-функции", query: "Какие AI-функции есть в Orinax?" },
    { label: "Подключить мессенджеры", query: "Как подключить мессенджеры к платформе?" },
  ];
}

interface StoredHistory {
  messages: ChatMessage[];
  savedAt: number;
}

function isHistoryExpired(savedAt: number): boolean {
  return Date.now() - savedAt > SESSION_TTL_MS;
}

function getInitialHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredHistory;
    if (!Array.isArray(stored.messages)) return [];
    if (isHistoryExpired(stored.savedAt ?? 0)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return stored.messages.slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredHistory = {
      messages: messages.slice(-MAX_HISTORY),
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

function clearHistory() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Минимальный markdown → HTML: ссылки, **bold**, `code`, переводы строк. */
function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const withCode = escaped.replace(
    /`([^`\n]+)`/g,
    '<code class="px-1 py-0.5 rounded bg-gray-100 text-[12px] font-mono text-gray-800">$1</code>',
  );

  const withBold = withCode.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const withLinks = withBold.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-700 underline underline-offset-2">$1</a>',
  );

  return withLinks.replace(/\n/g, "<br/>");
}

export function SupportAssistantWidget({
  apiUrl: apiUrlOverride,
  defaultOpen = false,
}: SupportAssistantWidgetProps = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<ChatMessage[]>(() => getInitialHistory());
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCtx, setPageCtx] = useState<PageContext>({});
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Открытие по custom event из GlobalHeader
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setOpen(true);
      setPageCtx(getPageContext());
      setTimeout(() => inputRef.current?.focus(), 100);
    };
    window.addEventListener("orinax:open-support", handler);
    return () => window.removeEventListener("orinax:open-support", handler);
  }, []);

  // Refresh page context whenever opened
  useEffect(() => {
    if (open) setPageCtx(getPageContext());
  }, [open]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Persist history
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-clear: проверяем TTL каждую минуту; очищаем без уведомления пользователя
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as StoredHistory;
        if (isHistoryExpired(stored.savedAt ?? 0)) {
          clearHistory();
          setMessages([]);
          setError(null);
        }
      } catch {
        /* ignore */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const sendQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || streaming) return;
      setError(null);
      const ctx = getPageContext();
      setPageCtx(ctx);

      const nextMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ];
      setMessages(nextMessages);
      setInput("");
      setStreaming(true);

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch(getApiUrl(apiUrlOverride), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.slice(0, -1).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            context: ctx,
          }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          let errText = `Ошибка ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) errText = j.error;
          } catch {
            /* ignore */
          }
          throw new Error(errText);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Стрим недоступен");

        const decoder = new TextDecoder();
        let acc = "";
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            acc += decoder.decode(value, { stream: true });
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: acc };
              return copy;
            });
          }
        }
        const tail = decoder.decode();
        if (tail) {
          acc += tail;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return copy;
          });
        }
      } catch (e) {
        const msg = (e as Error).name === "AbortError"
          ? "Запрос отменён"
          : (e as Error).message || "Что-то пошло не так";
        setError(msg);
        setMessages((prev) => {
          const copy = [...prev];
          // Заменим пустого ассистента на сообщение об ошибке
          if (copy.length && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy[copy.length - 1] = {
              role: "assistant",
              content: `_${msg}_. Попробуйте ещё раз или задайте вопрос иначе.`,
            };
          }
          return copy;
        });
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, apiUrlOverride],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendQuery(input);
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    clearHistory();
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const quickPrompts = buildQuickPrompts(pageCtx);
  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Drawer — открывается только событием `orinax:open-support`
          (кнопка "?" в GlobalHeader). Плавающую кнопку специально не
          рендерим, чтобы не дублировать вход. */}
      {open && (
        <div className="fixed bottom-0 right-0 sm:bottom-5 sm:right-5 z-[60] w-full sm:w-[420px] h-full sm:h-[640px] sm:max-h-[calc(100vh-2.5rem)] bg-white sm:rounded-2xl shadow-2xl shadow-zinc-300/40 ring-1 ring-zinc-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in-0 duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 bg-gradient-to-br from-blue-50 to-purple-50 shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">Помощник Orinax</p>
              <p className="text-[11px] text-zinc-500 truncate">
                Подскажу, как пользоваться платформой
              </p>
            </div>
            <button
              type="button"
              onClick={handleClear}
              title="Очистить переписку"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-white/70 transition-colors"
              disabled={isEmpty || streaming}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Закрыть"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-white/70 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-gradient-to-b from-white to-gray-50"
          >
            {isEmpty && (
              <div className="space-y-3">
                <div className="text-sm text-zinc-700 leading-relaxed bg-white border border-zinc-100 rounded-2xl px-4 py-3 shadow-sm">
                  Привет! Я помощник Orinax. Спросите что угодно про платформу — отвечу, опираясь на нашу базу знаний, и подскажу, что делать прямо на этой странице.
                  {pageCtx.pathname && (
                    <>
                      <br />
                      <span className="text-[12px] text-zinc-500 mt-1 inline-block">
                        Сейчас вы здесь:{" "}
                        <span className="font-mono text-blue-700">
                          {pageCtx.pathname}
                        </span>
                      </span>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {quickPrompts.map((p) => (
                    <button
                      type="button"
                      key={p.label}
                      onClick={() => void sendQuery(p.query)}
                      className="text-left text-[13px] px-3 py-2 rounded-xl border border-zinc-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 text-zinc-700 hover:text-zinc-900 transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
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
                      : "bg-white border border-zinc-100 text-zinc-800 rounded-bl-md",
                  ].join(" ")}
                >
                  {m.role === "assistant" && !m.content && streaming ? (
                    <span className="inline-flex items-center gap-1.5 text-zinc-500">
                      <Loader2 size={13} className="animate-spin" />
                      Думаю…
                    </span>
                  ) : (
                    <span
                      // Markdown сводится к чистым ссылкам/тегам, без user-input HTML.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                    />
                  )}
                </div>
              </div>
            ))}

            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Footer + form */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-zinc-100 bg-white px-3 py-2.5 shrink-0"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendQuery(input);
                  }
                }}
                placeholder="Спросите про любую функцию платформы…"
                rows={1}
                className="flex-1 resize-none max-h-32 min-h-[36px] rounded-xl border border-zinc-200 px-3 py-2 text-[13.5px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400"
                disabled={streaming}
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="shrink-0 w-9 h-9 rounded-xl bg-zinc-100 text-zinc-500 hover:bg-zinc-200 transition-colors flex items-center justify-center"
                  title="Остановить"
                >
                  <span className="block w-3 h-3 bg-zinc-500 rounded-sm" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-blue-500/30 transition-all flex items-center justify-center"
                  title="Отправить (Enter)"
                >
                  <Send size={15} />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 px-1">
              <a
                href="https://my.orinax.ai/knowledge"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-zinc-500 hover:text-blue-600 inline-flex items-center gap-1.5"
              >
                <BookOpen size={11} />
                База знаний
              </a>
              <span className="text-[10px] text-zinc-400">
                Enter — отправить · Shift+Enter — перенос
              </span>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export default SupportAssistantWidget;
