import { Money } from "./server/core/money";
import Decimal from "decimal.js";

console.log("Checking Money behavior...");

const m1 = new Money(100);
console.log(`Money(100).isPositive(): ${m1.isPositive()}`); // Should be true

const m2 = new Money(0);
console.log(`Money(0).isPositive(): ${m2.isPositive()}`); // Decimal.js 0 is positive?

const m3 = new Money(-100);
console.log(`Money(-100).isPositive(): ${m3.isPositive()}`); // Should be false

console.log("Decimal checks:");
console.log(`Decimal(0).isPositive(): ${new Decimal(0).isPositive()}`);
console.log(`Decimal(-0).isPositive(): ${new Decimal(-0).isPositive()}`);
console.log(`Decimal(-100).isPositive(): ${new Decimal(-100).isPositive()}`);
