# Thandiso Client UI - Design Document

**Date:** 2026-01-29
**Status:** Approved
**Task:** #161 - Build Thandiso Client UI

---

## 1. Overview

Thandiso is the AI assistant UI for Coppercoin. This design covers the client-side implementation that connects to the existing backend AI module (`server/modules/ai/`).

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entry point | Advice page only (`/advice`) | Simpler than floating bubble, consistent with nav |
| Layout | Single-panel | No persistent history in MVP, left rail would confuse |
| Consent flow | Inline on first visit | Smoother than modal, no extra clicks |
| AI responses | Card-based | Better for structured financial data (tables, progress) |
| Suggested prompts | 4-6 clickable chips | Compact, covers common use cases |
| Loading/error states | Simple inline | Minimal but clear, no over-engineering |
| Rate limit display | Subtle footer | Always visible but unobtrusive |
| Settings page | Dedicated `/settings/ai` | Room for future AI settings |
| Settings content | Toggle + usage + history | Full visibility into AI usage |
| Animations | Smooth transitions | Slide-in messages, pulsing dots, hover effects |
| Mobile layout | Full-width + sticky input | Native messaging app feel |
| State persistence | sessionStorage backup | Survives refresh, clears on tab close |
| Error handling | Inline retry button | Explicit user control |
| Content rendering | Markdown only | Simple, predictable, standard library |
| Disclaimer | First message system msg | Clean, shown once per conversation |
| Conversation ID | Client-generated UUID | Simple, immediate, no round-trip |
| New Chat | Header button | Clear control to start fresh |

---

## 2. Page Structure

The Thandiso UI is a single page at `/advice` using the existing app layout.

```
┌─────────────────────────────────────────────────┐
│  TopBar (breadcrumb: Advice)                    │
├─────────────────────────────────────────────────┤
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  Conversation Area (scrollable)         │   │
│   │                                         │   │
│   │  - Empty state: Thandiso intro +        │   │
│   │    suggested prompt chips               │   │
│   │                                         │   │
│   │  - Active state: Message cards          │   │
│   │    (user + AI responses)                │   │
│   │                                         │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  Input Bar + Send Button                │   │
│   │  "47 questions remaining today"         │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Responsive:** Full width on mobile, `max-w-7xl` container on desktop.

---

## 3. Consent Flow

Users without consent see an inline consent gate instead of the chat.

```
┌─────────────────────────────────────────────────┐
│                                                 │
│              Meet Thandiso                      │
│                                                 │
│   Your AI financial assistant. Ask questions   │
│   about your spending, budgets, goals, and     │
│   more in plain language.                      │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  How it works                            │   │
│   │                                         │   │
│   │  Thandiso uses Google Gemini to analyze │   │
│   │  your household's financial data. We    │   │
│   │  remove personal identifiers and limit  │   │
│   │  the data shared. You can disable this  │   │
│   │  anytime in Settings.                   │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
│        [ Enable Thandiso ]                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

**API Calls:**
- `GET /api/ai/consent` - Check consent status on page load
- `POST /api/ai/consent` - Grant consent when button clicked

**Revocation:** Via Settings page toggle (not from Advice page).

---

## 4. Message Cards

### User Message
- Right-aligned
- Muted background (`bg-muted`)
- Plain text, timestamp below

```
                          ┌────────────────────┐
                          │ How's my budget    │
                          │ doing this month?  │
                          └────────────────────┘
                                      You · 2:34p
```

### AI Response
- Left-aligned
- Card with border (`border rounded-lg`)
- Supports markdown, inline tables, progress indicators
- Thandiso avatar/name header

```
🦋 Thandiso · 2:34p
┌─────────────────────────────────────────────┐
│ Here's your budget status for January:      │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Category      Budget    Spent   Status  │ │
│ │ ─────────────────────────────────────── │ │
│ │ Groceries     K2,000    K1,850  ✓ 92%   │ │
│ │ Transport     K800      K920    ⚠ 115%  │ │
│ │ Entertainment K500      K200    ✓ 40%   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ You're over budget on Transport by K120.   │
└─────────────────────────────────────────────┘
```

---

## 5. Empty State & Suggested Prompts

When conversation is empty, show intro and 6 clickable prompt chips.

```
              🦋
         Hi, I'm Thandiso

   Ask me anything about your finances.
   Try one of these to get started:

   ┌──────────────────┐  ┌──────────────────┐
   │ How's my budget? │  │ Top spending     │
   └──────────────────┘  └──────────────────┘

   ┌──────────────────┐  ┌──────────────────┐
   │ Goal progress    │  │ Upcoming bills   │
   └──────────────────┘  └──────────────────┘

   ┌──────────────────┐  ┌──────────────────┐
   │ Monthly summary  │  │ Cash flow        │
   └──────────────────┘  └──────────────────┘
```

| Chip Label | Query Sent |
|------------|------------|
| How's my budget? | "What's my budget status this month?" |
| Top spending | "What are my top spending categories?" |
| Goal progress | "How are my savings goals doing?" |
| Upcoming bills | "What recurring payments are coming up?" |
| Monthly summary | "Give me a summary of this month" |
| Cash flow | "What's my cash flow look like?" |

**Behavior:** Click chip → auto-send query → chips disappear

---

## 6. Input Bar & States

### Input Bar
```
┌─────────────────────────────────────────┐ ┌─┐
│ Ask Thandiso anything...                │ │→│
└─────────────────────────────────────────┘ └─┘
          47 questions remaining today
```

- 1000 character limit
- Enter to send, Shift+Enter for newline
- Disabled while waiting for response

### Loading State
```
🦋 Thandiso
┌─────────────────────────────────────────────┐
│  ● ● ●  (animated dots)                     │
└─────────────────────────────────────────────┘
```

### Error States
| Error | Display |
|-------|---------|
| API error | Inline card: "Something went wrong. [Try again]" |
| Rate limit | Inline card: "Daily limit reached. Resets at midnight." |
| Network | Inline card: "Connection lost. [Retry]" |

### Rate Limit Footer
- "X questions remaining today" (muted text)
- Updates after each query
- At 0: "Daily limit reached. Resets in X hours."

---

## 7. File Structure

```
client/src/
├── pages/
│   └── Advice.tsx                    # Main page
├── components/
│   └── advice/
│       ├── ChatContainer.tsx         # Conversation state, scroll
│       ├── ConsentGate.tsx           # Inline consent disclosure
│       ├── MessageCard.tsx           # User/AI message display
│       ├── AIResponseContent.tsx     # Structured content renderer
│       ├── SuggestedPrompts.tsx      # Clickable prompt chips
│       ├── MessageInput.tsx          # Input + send + rate limit
│       └── LoadingIndicator.tsx      # Animated dots
├── hooks/
│   └── useAI.ts                      # API calls: chat, consent
└── lib/
    └── ai.ts                         # API client functions
```

---

## 8. Data Flow

1. **Page load** → `GET /api/ai/consent` → show ConsentGate or ChatContainer
2. **Send message** → `POST /api/ai/chat` → append to messages array
3. **Response** → parse `toolsUsed`, render appropriate cards
4. **Rate limit** → update footer from response `remainingQueries`

### State Management

```typescript
// In useAI hook
const [messages, setMessages] = useState<Message[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [remainingQueries, setRemainingQueries] = useState<number | null>(null);
const [error, setError] = useState<string | null>(null);
```

### Hook Interface

```typescript
const {
  messages,
  sendMessage,
  isLoading,
  error,
  remainingQueries,
  clearError
} = useAI();
```

---

## 9. API Integration

### Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/ai/consent` | Check consent status |
| `POST /api/ai/consent` | Grant/revoke consent |
| `POST /api/ai/chat` | Send message, get response |

### Chat Response Shape

```typescript
interface ChatResponse {
  reply: string;
  conversationId: string;
  toolsUsed: string[];
  tokenCount: number;
  remainingQueries: number;
}
```

### Error Response Shape

```typescript
interface ErrorResponse {
  error: {
    code: 'CONSENT_REQUIRED' | 'RATE_LIMIT_EXCEEDED' | 'INVALID_INPUT' | 'EXTERNAL_API_ERROR';
    message: string;
  }
}
```

---

## 10. Accessibility

- Keyboard navigation: Tab through prompts, Enter to send
- ARIA labels on all interactive elements
- Focus management when messages appear
- High contrast for error states
- Screen reader announcements for loading/new messages

---

## 11. Implementation Notes

### Dependencies
- Existing shadcn/ui components (Card, Button, Input)
- `react-markdown` for AI response rendering (if not already installed)
- Existing `useToast` for non-blocking notifications

### Styling
- Follow existing Tailwind patterns
- Use CSS variables from theme (`bg-muted`, `text-muted-foreground`)
- Match existing card/input styles

### Testing
- Unit tests for useAI hook
- Component tests for ConsentGate, MessageCard
- Integration test for full chat flow

---

## 12. Settings Page (`/settings/ai`)

Dedicated AI settings page with consent toggle, usage stats, and recent activity.

```
┌─────────────────────────────────────────────────┐
│  AI Assistant Settings                          │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   │
│  │  Enable Thandiso              [toggle]  │   │
│  │  Consent granted: Jan 29, 2026          │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Usage Today                            │   │
│  │  12 of 50 questions used                │   │
│  │  Resets at midnight                     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Recent Activity (last 5 queries)       │   │
│  │  "How's my budget?" · 2 hours ago       │   │
│  │  "Top spending" · 3 hours ago           │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 13. Animations & Transitions

| Element | Animation |
|---------|-----------|
| New messages | Slide in from bottom, fade in |
| Typing indicator | Pulsing dots |
| Prompt chips | Hover lift effect |
| Send button | Subtle scale on hover |

Use `prefers-reduced-motion` to disable for accessibility.

---

## 14. Mobile Responsiveness

- Full-width conversation area
- Input bar sticky to bottom of viewport
- Suggested prompts: 2x3 grid (stacked)
- Touch-friendly targets (min 44px)

---

## 15. State Management Details

```typescript
// sessionStorage backup for session persistence
useEffect(() => {
  sessionStorage.setItem('thandiso_messages', JSON.stringify(messages));
  sessionStorage.setItem('thandiso_conversation_id', conversationId);
}, [messages, conversationId]);

// Restore on mount
useEffect(() => {
  const saved = sessionStorage.getItem('thandiso_messages');
  if (saved) setMessages(JSON.parse(saved));
}, []);
```

- Survives page refresh within same tab
- Clears on tab close (session-only)

---

## 16. Conversation Management

- **conversationId**: UUID generated client-side on first message
- **New Chat**: Button in header clears state + sessionStorage
- **Disclaimer**: System message at conversation start

---

## 17. Testing Strategy

**Unit Tests:**
- `useAI` hook: API calls, state, sessionStorage
- `ConsentGate`: consent flow
- `MessageInput`: validation, submit states

**Integration Tests:**
- Consent → chat flow
- Send → loading → response
- Error → retry flow
- Rate limit blocking

---

## 18. Updated File Structure

```
client/src/
├── pages/
│   ├── Advice.tsx
│   └── settings/
│       └── AISettings.tsx            # New
├── components/
│   └── advice/
│       ├── ChatContainer.tsx
│       ├── ConsentGate.tsx
│       ├── MessageCard.tsx
│       ├── AIResponseContent.tsx
│       ├── SuggestedPrompts.tsx
│       ├── MessageInput.tsx
│       ├── LoadingIndicator.tsx
│       ├── SystemMessage.tsx         # New - disclaimer
│       └── NewChatButton.tsx         # New - header button
├── hooks/
│   └── useAI.ts
└── lib/
    └── ai.ts
```

---

## 19. Out of Scope (MVP)

- Persistent conversation history (database)
- Streaming responses
- Floating chat bubble
- Multi-conversation management
- Export/share conversations
- Voice input
- Auto-retry with backoff

---

## References

- Backend: `server/modules/ai/`
- Requirements: `docs/ai-integration/specifications/ai-assistant-master-requirements.md`
- API Spec: `docs/ai-integration/specifications/ai-assistant-api-spec.md`
