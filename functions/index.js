const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

/* ✅ PERCENTAGES */
const PLANS = {
  150000: 0.15,
  500000: 0.25,
  1000000: 0.35,
  5000000: 0.45
};

const DAYS = 12;
const DAY_MS = 86400000;

/* INVEST */
exports.investPlan = functions.https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const uid = context.auth.uid;
  const amount = data.amount;

  if (!PLANS[amount]) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid plan");
  }

  const percent = PLANS[amount];
  const daily = amount * percent;
  const total = daily * DAYS;

  const userRef = db.ref("users/" + uid);
  const investRef = db.ref(`investments/${uid}/12days/${amount}`);

  return userRef.transaction(user => {

    if (!user) return user;

    if ((user.balance || 0) < amount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Insufficient balance,to up your account to invest in this plan"
      );
    }

    user.balance -= amount;
    user.lockedBalance = (user.lockedBalance || 0) + total;

    return user;

  }).then(async () => {

    const snap = await investRef.get();

    if (snap.exists()) {
      throw new functions.https.HttpsError(
        "already-exists",
        "You already invested in this plan"
      );
    }

    await investRef.set({
      amount,
      daily,
      total,
      remaining: total,
      startTime: Date.now(),
      lastClaim: 0,
      daysClaimed: 0,
      completed: false
    });

    return { success: true };
  });
});

/* CLAIM */
exports.claimEarnings = functions.https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const uid = context.auth.uid;
  const amount = data.amount;

  const investRef = db.ref(`investments/${uid}/12days/${amount}`);
  const userRef = db.ref("users/" + uid);

  let payout = 0;

  await investRef.transaction(inv => {

    if (!inv) {
      throw new functions.https.HttpsError("not-found", "No investment found");
    }

    const last = inv.lastClaim || inv.startTime;

    if (Date.now() < last + DAY_MS) {
      throw new functions.https.HttpsError("failed-precondition", "Not yet time");
    }

    payout = Math.floor(inv.daily);

    inv.lastClaim = Date.now();
    inv.daysClaimed += 1;
    inv.remaining -= payout;

    if (inv.daysClaimed >= DAYS) {
      inv.completed = true;
    }

    return inv;
  });

  await userRef.transaction(user => {
    if (!user) return user;

    user.balance += payout;
    user.lockedBalance -= payout;

    return user;
  });

  return { success: true, payout };
});
