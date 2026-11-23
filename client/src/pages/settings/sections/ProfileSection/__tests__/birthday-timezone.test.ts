/**
 * Birthday round trip in a pinned zone. Runs in the client-tz-lusaka (UTC+2)
 * and client-tz-new-york (UTC-5/-4) projects of client/vitest.config.ts.
 *
 * Before the fix the save path used toISOString(), so 15 May picked in Lusaka
 * was sent as 1990-05-14T22:00:00.000Z and stored as 14 May; each further save
 * moved it back another day. The load path used new Date("YYYY-MM-DD") (UTC
 * midnight), which shows the previous day in UTC- zones.
 */
import { describe, expect, it } from "vitest";
import { transformApiToFormData, transformFormToApiData } from "../useProfileForm";

const apiProfile = { fullName: "Tz User", firstName: "Tz", lastName: "User", gender: "female" };

describe(`birthday round trip in ${process.env.TZ}`, () => {
  it("runs in a pinned non-UTC zone", () => {
    expect(["Africa/Lusaka", "America/New_York"]).toContain(process.env.TZ);
    expect(new Date(1990, 4, 15).getTimezoneOffset()).not.toBe(0);
  });

  it("saves the picked day, reloads it, and saves it again unchanged", () => {
    const form = transformApiToFormData(apiProfile);
    // The picker builds a local-midnight Date (BirthdayPicker.tsx).
    const picked = { ...form, birthday: new Date(1990, 4, 15) };

    const firstSave = transformFormToApiData(picked);
    expect(firstSave.birthday).toBe("1990-05-15");

    // The server stores and returns the date column as "YYYY-MM-DD".
    const reloaded = transformApiToFormData({ ...apiProfile, birthday: firstSave.birthday });
    expect(reloaded.birthday?.getFullYear()).toBe(1990);
    expect(reloaded.birthday?.getMonth()).toBe(4);
    expect(reloaded.birthday?.getDate()).toBe(15);

    const secondSave = transformFormToApiData(reloaded);
    expect(secondSave.birthday).toBe("1990-05-15");
  });

  it("keeps a year-end birthday on its own day", () => {
    const form = transformApiToFormData({ ...apiProfile, birthday: "1985-01-01" });
    expect(form.birthday?.getDate()).toBe(1);
    expect(transformFormToApiData(form).birthday).toBe("1985-01-01");
  });
});
