import { describe, expect, it } from "vitest";
import { checkTransferAmount } from "../components/transferAmount";

/** #245, Astra round 3: the typed amount is sent as typed, never rounded through a number. */
describe("checkTransferAmount", () => {
  it("sends a valid decimal string unchanged", () => {
    expect(["10", "10.5", "2.67", "0.01"].map((typed) => checkTransferAmount(typed).amount))
      .toEqual(["10", "10.5", "2.67", "0.01"]);
  });

  it("refuses a third decimal place instead of rounding 2.675 to 2.67", () => {
    expect(checkTransferAmount("2.675")).toEqual({ error: expect.stringContaining("at most 2 decimal places") });
  });

  it("refuses zero, a sign and non-numbers, and asks nothing of an empty field", () => {
    expect(["0", "0.00", "-5", "1e3", "abc"].map((typed) => checkTransferAmount(typed).amount))
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(checkTransferAmount("0.00").error).toBe("Enter an amount above zero.");
    expect(checkTransferAmount("")).toEqual({});
  });
});
