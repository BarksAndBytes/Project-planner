import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPasscode, checkPasscode, validRecord, MAX_TRIES, BLOCK_MS } from "../src/js/lock.js";

test("passcode hash verifies and never stores the passcode", async () => {
  const r = await hashPasscode("4410", { iterations: 10_000 });
  assert.ok(validRecord(r));
  assert.ok(!JSON.stringify(r).includes("4410"));
  assert.equal((await checkPasscode(r, "4410")).ok, true);
  assert.equal((await checkPasscode(r, "4411")).ok, false);
  await assert.rejects(hashPasscode("12"), /at least 4/);
});

test("five wrong tries block entry for five minutes", async () => {
  const r = await hashPasscode("2468", { iterations: 10_000 });
  let lockout = { fails: 0, until: 0 };
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_TRIES; i++) ({ lockout } = await checkPasscode(r, "0000", lockout, t0));
  assert.equal(lockout.until, t0 + BLOCK_MS);
  const blocked = await checkPasscode(r, "2468", lockout, t0 + 1000);
  assert.equal(blocked.ok, false, "even the right code is refused while blocked");
  assert.ok(blocked.wait > 0);
  assert.equal((await checkPasscode(r, "2468", lockout, t0 + BLOCK_MS + 1)).ok, true);
});
