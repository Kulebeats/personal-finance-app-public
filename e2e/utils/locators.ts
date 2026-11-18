import type { Locator, Page } from "@playwright/test";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Opens a Radix/shadcn `<Select>` via its trigger and clicks the option with
 * the given accessible name. The app has no native `<select>` elements, so
 * `page.selectOption()` never applies here: the trigger renders with
 * `role="combobox"` and, once opened, Radix portals a listbox of
 * `role="option"` items to the end of `<body>`.
 */
export async function selectRadixOption(
  page: Page,
  trigger: Locator,
  optionName: string | RegExp,
): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: optionName }).click();
}

export async function pickVisible(
  ...locators: Locator[]
): Promise<Locator | null> {
  const timeoutMs = 5000;
  const pollMs = 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const candidate = locator.first();
      try {
        if (await candidate.isVisible()) {
          return candidate;
        }
      } catch {
        // Ignore strict-mode and detached-node errors, try next candidate.
      }
    }

    await sleep(pollMs);
  }

  return null;
}
