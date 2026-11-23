# UX-02 real-device and browser matrix: owner checklist (R18.1)

**Status:** ❌ NOT STARTED. This needs real phones and browsers, which no lane or CI runner has.
CI covers the same pages with Chromium phone emulation at 375 x 812 (project `phone` in
`playwright.completion.config.ts`). Emulation does not prove these items:

- real touch behaviour;
- the on-screen keyboard covering inputs;
- iOS Safari viewport units and safe areas;
- screen readers.

**How to record:** one row per device and browser. Fill in the result columns, add the date, and commit
this file or attach it to the release evidence. A failure needs a screenshot and the page, step and
what went wrong.

## Devices and browsers (minimum)

| # | Device (model, OS version) | Browser + version | Screen reader | Date | Result |
|---|---|---|---|---|---|
| 1 | Android phone, about 360-412 px wide (e.g. a Samsung A-series or Tecno) | Chrome | TalkBack | | |
| 2 | iPhone, 375-390 px wide (e.g. SE 3rd gen or iPhone 13/14) | Safari | VoiceOver | | |
| 3 | iPad or Android tablet, about 768 px | Safari / Chrome | none | | |
| 4 | Laptop at 1280 px | Chrome, Firefox, Edge (latest) | NVDA on one of them | | |
| 5 | Laptop at 1280 px | Safari (macOS, if available) | VoiceOver | | |

## Per-device steps

Use a **synthetic** household on staging, never real finance data. Each step lists its pass condition.

1. **Sign up and verify.** Create an account and open the verification e-mail link on the phone. Pass: you land on "Email Verified!" and can sign in.
2. **Create household.** Pass: the form fits the screen and the on-screen keyboard does not hide the submit button. The dashboard then shows "Get started with your household".
3. **Navigation drawer.** Tap the menu button (top left). Pass: the drawer opens over the content and focus moves into it. The back gesture or Escape closes it and focus returns to the menu button.
4. **No sideways scroll.** On Dashboard, Transactions, Accounts, Budget, Reports and Settings, try to scroll sideways. Pass: nothing moves sideways and no text or button is cut off at the right edge.
5. **Tap targets.** Pass: buttons and links can be hit with a thumb at the first try. Watch the icon buttons in the top bar and the transaction detail panel.
6. **Add account.** Add a cash account with an opening balance. Pass: the amount field opens a numeric keyboard and the account appears with the right balance.
7. **Add transaction.** Add an expense with a category. Pass: the Account and Category pickers open and scroll, the dialog closes on save and the row appears.
8. **Transfer.** Create a transfer between two accounts. Pass: one row reads "Transfer to <account>" and the other "Transfer from <account>".
9. **Budget.** Set a category budget amount. Pass: it saves on Enter or blur and survives a reload.
10. **Goal.** Create a goal through the wizard. Pass: each step fits the screen, and leaving a required field empty shows an error next to the field.
11. **Reports.** Open Reports and switch tabs. Pass: no sideways scroll, charts fit, and the tab bar can be reached.
12. **Zoom to 200 %** (desktop rows 4 and 5). Pass: content reflows with no sideways scroll and nothing is cut off.
13. **Screen reader.** On rows 1, 2 and 4, go through steps 6-8 with the screen reader. Pass: every control is announced with a name, dialogs announce their title, and errors are read out.
14. **Reduced motion.** Turn on "reduce motion" in the OS. Pass: dialogs and the drawer do not slide.

## Known gaps to watch (from the lane's report)

- Real phones have not been checked; only Chromium emulation has.
- Firefox and WebKit are not in CI (only Chromium is installed there).
