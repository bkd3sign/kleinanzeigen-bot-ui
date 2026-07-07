import fs from 'fs';
import path from 'path';
import { listConversations, getConversation, sendMessage } from './gateway';
import { sleep } from '@/lib/browser/cdp';
import { buildSystemPrompt, buildChatMessages, loadMessagingRules } from './prompts';
import { readMergedConfig, AI_DEFAULTS } from '@/lib/yaml/config';
import type { ConversationDetail } from '@/types/message';

const STATS_FILE = '.ai-stats.json';
const MAX_AI_SENT_LOG = 500;

interface AiSentEntry {
  conversationId: string;
  text: string;
  sentAt: number;
}

interface StatsData {
  aiSentCount: number;
  aiSentMessages: AiSentEntry[];
  adGenerations: number;
  adImageAnalyses: number;
  oooSentCount: number;
  // Start of the current out-of-office period (epoch ms). Anchors the per-conversation dedup so
  // it survives a server restart; reset to "now" each time the user newly switches OOO on.
  oooActivatedAt: number;
}

export function readAiStats(workspace: string): StatsData {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(workspace, STATS_FILE), 'utf-8'));
    return {
      aiSentCount: data.aiSentCount ?? data.sentCount ?? 0,
      aiSentMessages: data.aiSentMessages ?? [],
      adGenerations: data.adGenerations ?? 0,
      adImageAnalyses: data.adImageAnalyses ?? data.imageAnalyses ?? 0,
      oooSentCount: data.oooSentCount ?? 0,
      oooActivatedAt: data.oooActivatedAt ?? 0,
    };
  } catch { return { aiSentCount: 0, aiSentMessages: [], adGenerations: 0, adImageAnalyses: 0, oooSentCount: 0, oooActivatedAt: 0 }; }
}

/**
 * Conversations already notified at/after `since`, derived from the persisted send log.
 * Used to rebuild the out-of-office dedup set after a restart so each buyer still gets the note
 * only once per period. Pure — unit-tested.
 *
 * Note: the log is capped at MAX_AI_SENT_LOG entries, so a single period sending more than that
 * could re-notify the very oldest buyers after a restart. Not a concern for the private-seller
 * use case (hundreds of distinct buyers in one vacation is unrealistic).
 */
export function repliedConversationsSince(entries: AiSentEntry[], since: number): Set<string> {
  return new Set(entries.filter(m => m.sentAt >= since).map(m => m.conversationId));
}

/**
 * Mark the start of a new out-of-office period (a "new vacation"). Called when the user newly
 * switches into out-of-office mode. Persisted so the period — and the per-conversation dedup
 * anchored to it — survives a server restart, while a brand-new period re-notifies returning buyers.
 */
export function markOooActivated(workspace: string): void {
  const stats = readAiStats(workspace);
  stats.oooActivatedAt = Date.now();
  persistStats(workspace, stats);
}

function readSentCount(workspace: string): number {
  return readAiStats(workspace).aiSentCount;
}

function persistStats(workspace: string, stats: StatsData): void {
  try {
    const trimmed = { ...stats, aiSentMessages: stats.aiSentMessages.slice(-MAX_AI_SENT_LOG) };
    fs.writeFileSync(path.join(workspace, STATS_FILE), JSON.stringify(trimmed), 'utf-8');
  } catch { /* non-critical */ }
}

function trackAiSentMessage(workspace: string, state: ResponderState, conversationId: string, text: string): void {
  state.sentCount++;
  const stats = readAiStats(workspace);
  stats.aiSentCount = state.sentCount;
  stats.aiSentMessages.push({ conversationId, text, sentAt: Date.now() });
  persistStats(workspace, stats);
}

/**
 * Track an out-of-office note. Counted in its own counter (NOT aiSentCount),
 * but logged into the shared automated-message list so the chat renders it with
 * the same "automated" bubble as KI replies.
 */
function trackOooSentMessage(workspace: string, state: ResponderState, conversationId: string, text: string): void {
  state.oooSentCount++;
  const stats = readAiStats(workspace);
  stats.oooSentCount = state.oooSentCount;
  stats.aiSentMessages.push({ conversationId, text, sentAt: Date.now() });
  persistStats(workspace, stats);
}

/**
 * Get AI-sent messages for a specific conversation.
 */
export function getAiSentMessages(workspace: string, conversationId?: string): AiSentEntry[] {
  const { aiSentMessages } = readAiStats(workspace);
  if (conversationId) return aiSentMessages.filter(m => m.conversationId === conversationId);
  return aiSentMessages;
}

/**
 * Track an AI ad generation call.
 */
export function trackAdGeneration(workspace: string, imageCount: number): void {
  const stats = readAiStats(workspace);
  stats.adGenerations++;
  stats.adImageAnalyses += imageCount;
  persistStats(workspace, stats);
}

// Auto mode: slow polling + send delay for anti-bot detection
const AUTO_POLL_INTERVAL = 20_000; // 20s base
const AUTO_POLL_JITTER = 15_000; // +0-15s → effective 20-35s
const MIN_RESPONSE_DELAY = 30_000; // 30s minimum before sending
const MAX_RESPONSE_JITTER = 90_000; // +0-90s → effective 30-120s

// Review mode: fast polling, no send delay (user sends manually)
const REVIEW_POLL_INTERVAL = 5_000; // 5s base
const REVIEW_POLL_JITTER = 3_000; // +0-3s → effective 5-8s
const MAX_HANDLED_MESSAGES = 1000;

// Out-of-office mode: short randomized delay to avoid burst-sending identical notes
const OOO_MIN_DELAY = 5_000; // 5s minimum before sending
const OOO_MAX_JITTER = 15_000; // +0-15s → effective 5-20s

type ResponderMode = 'auto' | 'review' | 'off' | 'out_of_office';

/**
 * Decide whether the out-of-office note should be sent to a conversation.
 * Pure: depends on conversation/message shape, whether we already replied, and
 * whether the message arrived after the responder was activated.
 *
 * The activation-time check is critical: it prevents blasting the note to old,
 * unanswered threads the moment out-of-office is switched on — only messages
 * received after activation get a reply.
 */
export function shouldSendOoo(
  conv: { boundness: string; role: string; adStatus: string },
  lastMsg: { boundness: string; type: string },
  alreadyReplied: boolean,
  messageReceivedAt: number,
  activatedAt: number,
): boolean {
  if (alreadyReplied) return false;
  if (conv.boundness !== 'INBOUND') return false;
  if (conv.role !== 'Seller') return false;
  if (conv.adStatus !== 'ACTIVE') return false;
  if (lastMsg.boundness !== 'INBOUND' || lastMsg.type !== 'MESSAGE') return false;
  // Only reply to messages received after activation (NaN-safe: skip on unparseable date)
  if (!(messageReceivedAt >= activatedAt)) return false;
  return true;
}

interface PendingReply {
  conversationId: string;
  conversation: ConversationDetail;
  suggestedReply: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'error';
  error?: string;
}

interface ResponderState {
  mode: ResponderMode;
  running: boolean;
  startedAt: number;
  lastPoll: number;
  sentCount: number;
  oooSentCount: number;
  handledMessages: Set<string>;
  pendingReplies: Map<string, PendingReply>;
  // Conversations that already received the out-of-office note this period
  oooRepliedConversations: Set<string>;
  timeoutId?: ReturnType<typeof setTimeout>;
}

// Persist across HMR
const g = globalThis as unknown as { __responderStates?: Map<string, ResponderState> };
if (!g.__responderStates) g.__responderStates = new Map();

function getState(workspace: string): ResponderState {
  let state = g.__responderStates!.get(workspace);
  if (!state || !state.handledMessages) {
    state = {
      mode: state?.mode ?? 'off',
      running: state?.running ?? false,
      startedAt: state?.startedAt ?? 0,
      lastPoll: state?.lastPoll ?? 0,
      sentCount: state?.sentCount ?? readSentCount(workspace),
      oooSentCount: state?.oooSentCount ?? readAiStats(workspace).oooSentCount,
      handledMessages: new Set(),
      pendingReplies: state?.pendingReplies ?? new Map(),
      oooRepliedConversations: state?.oooRepliedConversations ?? new Set(),
    };
    g.__responderStates!.set(workspace, state);
  }
  return state;
}

/**
 * Prune a tracking set to its newest `max` entries, preventing unbounded growth.
 */
function pruneSet(set: Set<string>, max: number): void {
  if (set.size <= max) return;
  const entries = Array.from(set);
  for (const id of entries.slice(0, entries.length - max)) set.delete(id);
}

/**
 * Call OpenRouter LLM to generate a reply.
 */
async function generateReply(
  workspace: string,
  conv: ConversationDetail,
): Promise<string> {
  const config = readMergedConfig(workspace);
  const aiConfig = (config?.ai as Record<string, string>) ?? {};

  const apiKey = aiConfig.api_key ?? process.env.OPENROUTER_API_KEY ?? '';
  const baseUrl = aiConfig.base_url ?? AI_DEFAULTS.base_url;
  const model = aiConfig.model ?? AI_DEFAULTS.model;

  if (!apiKey) {
    throw new Error('Kein API-Key konfiguriert (ai.api_key in config.yaml)');
  }

  const systemPrompt = buildSystemPrompt(workspace, conv);
  const messages = buildChatMessages(conv, systemPrompt);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(aiConfig.referer ? { 'HTTP-Referer': String(aiConfig.referer) } : {}),
      ...(aiConfig.app_name ? { 'X-Title': String(aiConfig.app_name) } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`LLM API Fehler: ${response.status} — ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('LLM gab keine Antwort zurück');

  return reply;
}

/**
 * Check for new inbound messages and generate replies.
 */
async function pollAndRespond(workspace: string): Promise<void> {
  const state = getState(workspace);
  if (state.mode === 'off') return;

  state.lastPoll = Date.now();
  pruneSet(state.handledMessages, MAX_HANDLED_MESSAGES);
  pruneSet(state.oooRepliedConversations, MAX_HANDLED_MESSAGES);

  // Out-of-office mode sends a fixed note once per conversation — no LLM, no API key needed.
  // Coerce defensively: a hand-edited rules file may hold a non-string here, and .trim() on a
  // non-string would throw before the try-block below and silently abort every poll.
  const rawOoo = state.mode === 'out_of_office' ? loadMessagingRules(workspace).out_of_office_message : '';
  const oooMessage = typeof rawOoo === 'string' ? rawOoo.trim() : '';
  if (state.mode === 'out_of_office' && !oooMessage) return;

  try {
    const data = await listConversations(workspace, 0, 25);
    if (!data.conversations) return;

    for (const conv of data.conversations) {
      if (conv.boundness !== 'INBOUND') continue;
      if (conv.role !== 'Seller') continue;
      if (conv.adStatus !== 'ACTIVE') continue;
      if (state.pendingReplies.has(conv.id)) continue;

      const fullConv = await getConversation(workspace, conv.id);
      if (!fullConv.messages?.length) continue;

      const lastMsg = fullConv.messages[fullConv.messages.length - 1];
      if (lastMsg.boundness !== 'INBOUND' || lastMsg.type !== 'MESSAGE') continue;

      // Out-of-office: send the fixed note once per conversation, then skip AI logic
      if (state.mode === 'out_of_office') {
        const receivedAt = new Date(lastMsg.receivedDate).getTime();
        if (!shouldSendOoo(conv, lastMsg, state.oooRepliedConversations.has(conv.id), receivedAt, state.startedAt)) continue;
        // Mark BEFORE the delay/send so an overlapping poll can't double-send to the same buyer
        state.oooRepliedConversations.add(conv.id);
        await sleep(OOO_MIN_DELAY + Math.random() * OOO_MAX_JITTER);
        try {
          await sendMessage(workspace, conv.id, oooMessage);
          trackOooSentMessage(workspace, state, conv.id, oooMessage);
        } catch (err) {
          // Send failed → un-mark so the next poll retries instead of silently dropping the buyer
          state.oooRepliedConversations.delete(conv.id);
          console.warn(`[responder] OOO send failed: ${(err as Error).message}`);
        }
        continue;
      }

      if (state.handledMessages.has(lastMsg.messageId)) continue;

      // Mark ALL inbound messages as handled
      for (const msg of fullConv.messages) {
        if (msg.boundness === 'INBOUND') state.handledMessages.add(msg.messageId);
      }

      // Escalation check
      const rules = loadMessagingRules(workspace);
      // Defensive: a hand-edited rules file may hold a non-string here (Config = Source of Truth)
      const escalateStr = typeof rules.escalate_keywords === 'string' ? rules.escalate_keywords : '';
      const userKeywords = escalateStr.split(/[,\n]/).map(k => k.trim().toLowerCase()).filter(Boolean);
      const msgText = lastMsg.textShort.toLowerCase();

      const schedulePatterns = [
        /\b\d{1,2}\s*:\s*\d{2}\b/,
        /\b\d{1,2}\s*(uhr|h)\b/,
        /\b(morgen|übermorgen|heute)\b/,
        /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/,
        /\b\d{1,2}\.\d{1,2}\b/,
        /\b(abholen|abholung).{0,20}(wann|zeit|termin|uhr)/,
        /\b(wann|zeit|termin).{0,20}(abholen|abholung|kommen|vorbeikommen)/,
      ];
      const isSchedule = schedulePatterns.some(p => p.test(msgText));
      const isUserEscalated = userKeywords.some(kw => msgText.includes(kw));
      const availability = (rules.availability as Array<{ days: string; from: string; to: string }>) ?? [];

      if (isUserEscalated || (isSchedule && availability.length === 0)) {
        let suggestedReply: string;
        try { suggestedReply = await generateReply(workspace, fullConv); } catch { suggestedReply = ''; }
        state.pendingReplies.set(conv.id, {
          conversationId: conv.id, conversation: fullConv,
          suggestedReply: suggestedReply || '', createdAt: Date.now(), status: 'pending',
        });
        continue;
      }

      // Generate reply
      const reply = await generateReply(workspace, fullConv);

      if (state.mode === 'auto') {
        // Random delay: 30-120 seconds (anti-bot detection)
        const msgTime = new Date(lastMsg.receivedDate).getTime();
        const elapsed = Date.now() - msgTime;
        const targetDelay = MIN_RESPONSE_DELAY + Math.random() * MAX_RESPONSE_JITTER;
        if (elapsed < targetDelay) {
          await sleep(targetDelay - elapsed);
        }

        try {
          await sendMessage(workspace, conv.id, reply);
          state.handledMessages.add(lastMsg.messageId);
          trackAiSentMessage(workspace, state, conv.id, reply);
        } catch (err) {
          console.warn(`[responder] Send failed: ${(err as Error).message}`);
          state.pendingReplies.set(conv.id, {
            conversationId: conv.id, conversation: fullConv,
            suggestedReply: reply, createdAt: Date.now(), status: 'error',
            error: (err as Error).message,
          });
        }
      } else {
        // Review mode
        state.pendingReplies.set(conv.id, {
          conversationId: conv.id, conversation: fullConv,
          suggestedReply: reply, createdAt: Date.now(), status: 'pending',
        });
      }
    }
  } catch (err) {
    console.warn(`[responder] Poll error: ${(err as Error).message}`);
  }
}

/**
 * Schedule next poll with random jitter (anti-bot detection).
 */
function scheduleNextPoll(workspace: string): void {
  const state = getState(workspace);
  if (!state.running || state.mode === 'off') return;

  const base = state.mode === 'review' ? REVIEW_POLL_INTERVAL : AUTO_POLL_INTERVAL;
  const maxJitter = state.mode === 'review' ? REVIEW_POLL_JITTER : AUTO_POLL_JITTER;
  const jitter = base + Math.random() * maxJitter;
  state.timeoutId = setTimeout(async () => {
    await pollAndRespond(workspace).catch(() => {});
    scheduleNextPoll(workspace);
  }, jitter);
}

/**
 * Start the auto-responder for a workspace.
 */
export function startResponder(workspace: string, mode: 'auto' | 'review' | 'out_of_office'): void {
  const oldState = g.__responderStates!.get(workspace);
  if (oldState?.timeoutId) clearTimeout(oldState.timeoutId);

  const isOoo = mode === 'out_of_office';
  const stats = readAiStats(workspace);
  const continuingOoo = isOoo && oldState?.running === true && oldState.mode === mode;

  // Lazy-init the period anchor if missing (OOO enabled before this field shipped). Persisting it
  // now keeps the period start stable across later restarts instead of drifting to "now" each boot.
  if (isOoo && !stats.oooActivatedAt) {
    stats.oooActivatedAt = Date.now();
    persistStats(workspace, stats);
  }

  // Out-of-office runs in "periods": a period starts when the user switches OOO on (the config
  // route stamps oooActivatedAt) and only messages received at/after it get the note. Anchoring
  // startedAt to the persisted stamp makes the period — and its one-note-per-conversation dedup —
  // survive a server restart, while a brand-new period (new vacation) re-notifies returning buyers.
  const startedAt = isOoo ? stats.oooActivatedAt : Date.now();

  // Rebuild the per-period dedup set from the persisted send log. On a live re-save keep the richer
  // in-memory set (the log is capped); a fresh process/boot reconstructs it from disk.
  const oooRepliedConversations = !isOoo
    ? new Set<string>()
    : continuingOoo
      ? oldState!.oooRepliedConversations
      : repliedConversationsSince(stats.aiSentMessages, startedAt);

  const state: ResponderState = {
    mode,
    running: true,
    startedAt,
    lastPoll: 0,
    sentCount: oldState?.sentCount ?? stats.aiSentCount,
    oooSentCount: oldState?.oooSentCount ?? stats.oooSentCount,
    handledMessages: oldState?.handledMessages ?? new Set(),
    pendingReplies: new Map(),
    oooRepliedConversations,
  };
  g.__responderStates!.set(workspace, state);

  // Initial poll then schedule recurring with jitter
  pollAndRespond(workspace).catch(() => {});
  scheduleNextPoll(workspace);
}

/**
 * Stop the auto-responder.
 */
export function stopResponder(workspace: string): void {
  const state = getState(workspace);
  state.mode = 'off';
  state.running = false;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = undefined;
  }
}

/**
 * Get current responder status.
 */
export function getResponderStatus(workspace: string): {
  mode: ResponderMode;
  running: boolean;
  lastPoll: number;
  sentCount: number;
  oooSentCount: number;
  pendingCount: number;
  pendingReplies: Array<{
    conversationId: string;
    buyerName: string;
    adTitle: string | null;
    suggestedReply: string;
    status: string;
    createdAt: number;
  }>;
} {
  const state = getState(workspace);
  const pending = Array.from(state.pendingReplies.values()).map(p => ({
    conversationId: p.conversationId,
    buyerName: p.conversation.buyerName,
    adTitle: p.conversation.adTitle,
    suggestedReply: p.suggestedReply,
    status: p.status,
    createdAt: p.createdAt,
  }));

  return {
    mode: state.mode,
    running: state.running,
    lastPoll: state.lastPoll,
    sentCount: state.sentCount,
    oooSentCount: state.oooSentCount,
    pendingCount: pending.filter(p => p.status === 'pending').length,
    pendingReplies: pending,
  };
}

/**
 * Approve a pending reply (send it).
 */
export async function approvePendingReply(
  workspace: string,
  conversationId: string,
  editedMessage?: string,
): Promise<void> {
  const state = getState(workspace);
  const pending = state.pendingReplies.get(conversationId);
  if (!pending) throw new Error('Keine ausstehende Antwort für diese Konversation');

  const message = editedMessage?.trim() || pending.suggestedReply;

  try {
    await sendMessage(workspace, conversationId, message);
    pending.status = 'sent';
    trackAiSentMessage(workspace, state, conversationId, message);
    state.pendingReplies.delete(conversationId);
  } catch (err) {
    pending.status = 'error';
    pending.error = (err as Error).message;
    throw err;
  }
}

/**
 * Reject a pending reply (don't send, mark as handled).
 */
export function rejectPendingReply(workspace: string, conversationId: string): void {
  const state = getState(workspace);
  state.pendingReplies.delete(conversationId);
}
