import assert from "node:assert/strict";
import { dedupeById, isStrongPassword, isValidEmail, isValidOtp, normalizeEmail, normalizeKenyanMpesaPhone, upsertById } from "../src/utils/validation.mjs";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("email normalization and validation", () => {
  assert.equal(normalizeEmail(" Purice@Example.COM "), "purice@example.com");
  assert.equal(isValidEmail("purice@example.com"), true);
  assert.equal(isValidEmail("purice@example"), false);
  assert.equal(isValidEmail("a@b.com OR 1=1"), false);
});

test("password policy requires mixed character classes and no spaces", () => {
  assert.equal(isStrongPassword("Strong@123"), true);
  assert.equal(isStrongPassword("weakpass"), false);
  assert.equal(isStrongPassword("NoSpecial123"), false);
  assert.equal(isStrongPassword("Has Space@1"), false);
});

test("OTP accepts exactly six digits", () => {
  assert.equal(isValidOtp("123456"), true);
  assert.equal(isValidOtp("12345"), false);
  assert.equal(isValidOtp("12345a"), false);
});

test("Kenyan M-Pesa numbers normalize safely", () => {
  assert.equal(normalizeKenyanMpesaPhone("0712 345 678"), "254712345678");
  assert.equal(normalizeKenyanMpesaPhone("712345678"), "254712345678");
  assert.equal(normalizeKenyanMpesaPhone("254112345678"), "254112345678");
  assert.equal(normalizeKenyanMpesaPhone("+1 202 555 0100"), null);
});

test("stable IDs prevent duplicate production records", () => {
  const original = [{ id: "payment-1", status: "Processing" }];
  const updated = upsertById(original, { id: "payment-1", status: "Confirmed", receipt: "ABC123" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, "Confirmed");
  assert.equal(dedupeById([{ id: "a" }, { id: "a" }, { id: "b" }]).length, 2);
});

for (const { name, run } of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`${tests.length} unit tests passed.`);
