import { describe, expect, it } from "vitest";
import { buildEmailHtml } from "../email";

const link = "https://app.example.test/verify-email?token=abc";

describe("buildEmailHtml", () => {
  it("keeps the notification button and preferences footer by default", () => {
    const html = buildEmailHtml("Title", "Body", link);

    expect(html).toContain("View Details");
    expect(html).toContain("notification preferences");
    expect(html).toContain("Manage preferences");
  });

  it("takes a button label and can omit the preferences footer", () => {
    const html = buildEmailHtml("Title", "Body", link, {
      buttonLabel: "Do the thing",
      showPreferencesFooter: false,
    });

    expect(html).toContain("Do the thing");
    expect(html).not.toContain("View Details");
    expect(html).not.toContain("notification preferences");
    expect(html).not.toContain("Manage preferences");
  });
});
